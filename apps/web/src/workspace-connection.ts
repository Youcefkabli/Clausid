import { ApiError, ProtocolError, request } from './response.ts'
import { workspacePresenceSchema, workspacePartiesSchema } from '@clausid/contracts'
import type { Participant } from '@clausid/contracts'
import type { Doc } from 'yjs'

export type WorkspacePresenceState = { participants: Participant[]; ready: boolean; error: string; retryable: boolean }
export function connectWorkspacePresence(workspaceId: string, receive: (state: WorkspacePresenceState) => void, contractId: string | null, draft?: Doc) {
  let socket: WebSocket
  let disposed = false
  let failed = false
  let ready = false
  let delay = 400
  let reconnect: ReturnType<typeof setTimeout> | undefined
  let activityTimer: ReturnType<typeof setTimeout> | undefined
  let lastInteraction = Date.now()
  let editedAt = 0
  const abort = new AbortController()
  let participants: Participant[] = []
  let lastStatus: string | undefined
  let lastSentAt = 0
  const report = (error = '') => receive({ participants, ready, error, retryable: failed })
  const send = (force = false) => {
    if (socket.readyState !== WebSocket.OPEN || !ready || failed) {
      return
    }
    const status = document.hidden || Date.now() - lastInteraction >= 60_000 ? 'Away' : Date.now() - editedAt < 2_000 ? 'Editing' : 'Online'
    if (!force && lastStatus === status) {
      return
    }
    lastStatus = status
    lastSentAt = Date.now()
    socket.send(JSON.stringify({ type: 'activity', status, contractId }))
  }
  const scheduleActivity = () => {
    clearTimeout(activityTimer)
    activityTimer = setTimeout(() => {
      send(true)
      activityTimer = setTimeout(send, 2_000)
    }, 100)
  }
  const interaction = () => {
    const wasAway = Date.now() - lastInteraction >= 60_000
    lastInteraction = Date.now()
    if (wasAway) {
      send()
    }
  }
  const edit = (_update: Uint8Array, origin: unknown) => {
    // connectContract tags incoming updates with a symbol; they are not this person's activity.
    if (typeof origin !== 'symbol') {
      editedAt = Date.now()
      lastInteraction = editedAt
      send(Date.now() - lastSentAt >= 1_000)
      scheduleActivity()
    }
  }
  const visibility = () => {
    lastInteraction = Date.now()
    send()
  }
  function open() {
    const url = new URL('/api/workspaces/' + workspaceId + '/socket', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    const current = new WebSocket(url)
    socket = current
    socket.onmessage = (event) => {
      if (disposed || failed || socket !== current) {
        return
      }
      let result
      try {
        const value: unknown = JSON.parse(typeof event.data === 'string' ? event.data : '')
        result = workspacePresenceSchema.parse(value)
      } catch {
        failed = true
        ready = false
        participants = []
        report('Workspace presence needs retry.')
        socket.close(4002, 'Invalid presence message')
        return
      }
      if (result.type === 'error') {
        ready = false
        participants = []
        report(result.message)
        socket.close(4000, 'Presence unavailable')
        return
      }
      participants = result.participants
      const first = !ready
      ready = true
      delay = 400
      report()
      if (first) {
        send(true)
      }
    }
    socket.onclose = (event) => {
      if (disposed || failed || socket !== current) {
        return
      }
      ready = false
      participants = []
      if (event.code === 4003) {
        failed = true
        report('Workspace access ended.')
        return
      }
      report('Workspace presence reconnecting…')
      const retryOpen = async () => {
        try {
          await request(workspacePartiesSchema, '/api/workspaces/' + workspaceId + '/parties', undefined, abort.signal)
        } catch (reason) {
          if (disposed) {
            return
          }
          if (reason instanceof ProtocolError || (reason instanceof ApiError && (reason.status === 401 || reason.status === 404))) {
            failed = true
            report(reason instanceof ProtocolError ? 'Workspace presence needs retry.' : 'Workspace access ended.')
            return
          }
        }
        if (!disposed && !failed && socket === current) {
          open()
        }
      }
      reconnect = setTimeout(
        () => {
          void retryOpen()
        },
        event.code === 4012 ? 0 : delay,
      )
      delay = Math.min(delay * 2, 5_000)
    }
  }
  const heartbeat = setInterval(() => send(true), 25_000)
  const idle = setInterval(() => {
    if (Date.now() - lastInteraction >= 60_000) {
      send()
    }
  }, 1_000)
  document.addEventListener('visibilitychange', visibility)
  for (const event of ['pointerdown', 'pointermove', 'keydown', 'focusin']) {
    document.addEventListener(event, interaction, { passive: true })
  }
  draft?.on('update', edit)
  open()
  return {
    retry() {
      if (!disposed && failed) {
        failed = false
        participants = []
        report()
        open()
      }
    },
    dispose() {
      disposed = true
      abort.abort()
      clearTimeout(reconnect)
      clearTimeout(activityTimer)
      clearInterval(heartbeat)
      clearInterval(idle)
      draft?.off('update', edit)
      document.removeEventListener('visibilitychange', visibility)
      for (const event of ['pointerdown', 'pointermove', 'keydown', 'focusin']) {
        document.removeEventListener(event, interaction)
      }
      socket.close()
    },
  }
}
