import { contractViewSchema, workspaceActivitySchema } from '@clausid/contracts'
import type { ContractView, Participant } from '@clausid/contracts'
import { accountFromRequest, readSharing, storedRecord, workspaceContractSchema, workspaceSessionSchema } from './records.ts'
import type { Account, WorkspaceSession as Session } from './records.ts'
import { HttpError, serviceResponse } from './http.ts'
import type { Env } from './http.ts'

import { aggregateStatus, isWorkspaceMember, participantIdentity, presenceLease } from './presence-state.ts'

// Attachments survive hibernation; no activity is written to workspace history or signing data.
export class WorkspacePresence {
  #queue: Promise<unknown> = Promise.resolve()
  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {}
  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.#queue.then(operation)
    this.#queue = next.catch(() => undefined)
    return next
  }
  connect(request: Request) {
    return this.#serial(async () => {
      const account = accountFromRequest(request)
      const state = await readSharing(this.ctx.storage)
      if (this.env.OPS_KEY || !state || !isWorkspaceMember(state, account) || account.expires <= Date.now()) {
        throw new HttpError(404, 'Workspace unavailable.')
      }
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') {
        throw new HttpError(426, 'WebSocket required.')
      }
      const name = participantIdentity(account).name.slice(0, 80)
      await this.ctx.storage.transaction(async (tx) => {
        const current = await readSharing(tx)
        if (!current || !isWorkspaceMember(current, account)) {
          throw new HttpError(404, 'Workspace unavailable.')
        }
        await tx.put('workspace-sharing', {
          ...current,
          owner: current.owner.id === account.id ? { ...current.owner, name } : current.owner,
          parties: current.parties.map((party) => (party.id === account.id ? { ...party, name } : party)),
        })
      })
      const pair = new WebSocketPair()
      const client = pair[0],
        socket = pair[1]
      if (!client || !socket) {
        throw new Error('Missing workspace socket pair.')
      }
      this.ctx.acceptWebSocket(socket)
      socket.serializeAttachment({ account, updatedAt: Date.now(), status: 'Online', contractId: null } satisfies Session)
      await this.#publish()
      return new Response(null, { status: 101, webSocket: client })
    })
  }
  message(socket: WebSocket, raw: string | ArrayBuffer) {
    return this.#serial(async () => {
      try {
        const session = storedRecord(workspaceSessionSchema, socket.deserializeAttachment())
        const state = await readSharing(this.ctx.storage)
        if (!state || !isWorkspaceMember(state, session.account)) {
          socket.close(4003, 'Access ended')
          await this.#publish(socket)
          return
        }
        if (session.account.expires <= Date.now() || this.env.OPS_KEY) {
          socket.close(this.env.OPS_KEY ? 1012 : 4012, 'Refresh session')
          await this.#publish(socket)
          return
        }
        if (typeof raw !== 'string' || raw.length > 1_024) {
          throw new Error('Invalid activity')
        }
        const incoming = workspaceActivitySchema.parse(JSON.parse(raw))
        let contractId: string | null = null
        let status = incoming.status
        if (incoming.contractId) {
          const view = await this.#document(incoming.contractId, session.account)
          const directory = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(view?.owner?.id ?? session.account.id))
          const source = await directory.fetch('https://directory/workspace-contract/' + incoming.contractId)
          if (!source.ok) {
            throw new Error('Document directory unavailable')
          }
          const entry = await serviceResponse(source, workspaceContractSchema)
          if (entry?.workspaceId === state.workspace.id) {
            if (view) {
              contractId = incoming.contractId
              if (view.status !== 'Draft' || view.sourcePdf || view.role === 'signer') {
                status = status === 'Editing' ? 'Online' : status
              }
            }
          }
        }
        if (!contractId && status === 'Editing') {
          status = 'Online'
        }
        socket.serializeAttachment({ ...session, updatedAt: Date.now(), status, contractId } satisfies Session)
        await this.#publish()
      } catch {
        this.#send(socket, { type: 'error', message: 'Workspace presence is temporarily unavailable.' })
      }
    })
  }
  close(socket: WebSocket) {
    return this.#serial(() => this.#publish(socket))
  }
  alarm() {
    return this.#serial(() => this.#publish())
  }
  async #document(id: string, account: Account) {
    const response = await this.env.CONTRACTS.get(this.env.CONTRACTS.idFromName(id)).fetch('https://contract/view', {
      headers: { 'x-clausid-account': encodeURIComponent(JSON.stringify(account)), 'x-clausid-contract': id },
    })
    if (response.status === 404 || response.status === 403) {
      return null
    }
    if (!response.ok) {
      throw new Error('Document access check unavailable')
    }
    return serviceResponse(response, contractViewSchema)
  }
  #send(socket: WebSocket, message: object) {
    try {
      socket.send(JSON.stringify(message))
    } catch {
      // Cleanup on close/lease expiry removes a disappearing tab.
    }
  }
  async #publish(excluded?: WebSocket) {
    const state = await readSharing(this.ctx.storage)
    const now = Date.now()
    const live: { socket: WebSocket; session: Session }[] = []
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === excluded) {
        continue
      }
      const session = storedRecord(workspaceSessionSchema, socket.deserializeAttachment())
      if (!state || !isWorkspaceMember(state, session.account)) {
        socket.close(4003, 'Access ended')
      } else if (this.env.OPS_KEY || session.account.expires <= now) {
        socket.close(this.env.OPS_KEY ? 1012 : 4012, 'Refresh session')
      } else if (session.updatedAt + presenceLease <= now) {
        socket.close(4000, 'Presence expired')
      } else {
        live.push({ socket, session })
      }
    }
    if (!state || !live.length) {
      return
    }
    // Cache only inside this publication: authorization is checked again on every update.
    const views = new Map<string, Promise<ContractView | null>>()
    const document = (id: string, account: Account) => {
      const key = JSON.stringify([id, account.id])
      let result = views.get(key)
      if (!result) {
        result = this.#document(id, account)
        views.set(key, result)
      }
      return result
    }
    for (const receiver of live) {
      const participants: Participant[] = []
      for (const party of [state.owner, ...state.parties]) {
        const sessions = live.filter(({ session }) => session.account.id === party.id).map(({ session }) => session)
        const visible = new Map<string, { id: string; title: string }>()
        let working = false
        for (const session of sessions) {
          if (session.contractId && (await document(session.contractId, session.account))) {
            working = true
            const view = await document(session.contractId, receiver.session.account)
            if (view) {
              visible.set(view.id, { id: view.id, title: view.title })
            }
          }
        }
        participants.push({
          ...participantIdentity(sessions[0]?.account ?? party),
          status: aggregateStatus(sessions, now),
          working,
          documents: [...visible.values()],
        })
      }
      this.#send(receiver.socket, { type: 'participants', participants })
    }
    const deadline = Math.min(
      now + 30_000,
      ...live.map(({ session }) =>
        session.status === 'Editing' && session.updatedAt + 2_000 > now ? session.updatedAt + 2_000 : session.updatedAt + presenceLease,
      ),
    )
    const alarm = await this.ctx.storage.getAlarm()
    if (alarm === null || alarm > deadline) {
      await this.ctx.storage.setAlarm(deadline)
    }
  }
}
