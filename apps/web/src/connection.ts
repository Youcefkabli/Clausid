import { contractViewSchema } from '@clausid/contracts'
import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { createEncoder, writeVarString, writeVarUint, toUint8Array } from 'lib0/encoding'
import type { ServerMessage } from '@clausid/contracts'
import { request, ApiError, ProtocolError } from './response.ts'
import { toBase64 } from './base64.ts'
import { parseServerFrame } from './protocol.ts'

export type ConnectionState = { ready: boolean; pending: number; error: string; ended: boolean; retryable: boolean }
const remote = Symbol('server')

export function connectContract(
  id: string,
  doc: Y.Doc,
  awareness: Awareness,
  receive: (message: ServerMessage) => void,
  setState: (status: ConnectionState) => void,
) {
  let socket: WebSocket
  let disposed = false
  let timer: ReturnType<typeof setTimeout>
  let retry = 400
  let ready = false
  let writable = false
  let present = false
  let ended = false
  let error = ''
  let protocolFailed = false
  const pending = new Map<string, string>()
  const status = () => setState({ ready, pending: pending.size, error, ended, retryable: protocolFailed })
  const send = (value: object) => {
    if (ready && socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(value))
    }
  }
  let presenceClock = 0
  function presence() {
    if (!present) {
      return
    }
    send({ type: 'presence', clientId: doc.clientID, clock: (presenceClock += 2), cursor: awareness['getLocalState']()?.['cursor'] ?? null })
  }
  function clearPresence() {
    const others = [...awareness.meta.keys()].filter((key) => key !== doc.clientID)
    removeAwarenessStates(awareness, others, remote)
    for (const key of others) {
      awareness.meta.delete(key)
    }
  }
  function update(bytes: Uint8Array, origin: unknown) {
    if (origin === remote || !writable) {
      return
    }
    const updateId = crypto.randomUUID()
    pending.set(updateId, toBase64(bytes))
    send({ type: 'edit', id: updateId, update: pending.get(updateId) })
    status()
  }
  function protocolFailure() {
    protocolFailed = true
    ready = false
    writable = false
    present = false
    clearTimeout(timer)
    error = 'The server sent an invalid document message. Your unsaved changes are still in this tab. Retry the connection.'
    status()
    socket.close(4002, 'Invalid server message')
  }
  function open() {
    const url = new URL('/api/contracts/' + id + '/socket', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    const current = socket
    socket.onmessage = (event) => {
      if (disposed || protocolFailed || socket !== current) {
        return
      }
      let frame
      try {
        frame = parseServerFrame(event.data, doc)
      } catch {
        protocolFailure()
        return
      }
      const { message } = frame
      if (message.type === 'state') {
        if (frame.update) {
          Y.applyUpdate(doc, frame.update, remote)
        }
        present = message.contract.status === 'Draft' && message.contract.role !== 'signer'
        writable = message.contract.status === 'Draft' && !message.contract.sourcePdf
        if (!ready) {
          ready = true
          retry = 400
          presence()
          if (writable) {
            for (const [id, update] of pending) {
              send({ type: 'edit', id, update })
            }
          } else if (pending.size) {
            error = 'The contract was frozen before all of your changes were saved.'
          }
        }
        if (message.contract.status !== 'Draft' && pending.size) {
          error = 'Some local changes were not saved before freezing.'
        }
      } else if (message.type === 'edit') {
        if (frame.update) {
          Y.applyUpdate(doc, frame.update, remote)
        }
      } else if (message.type === 'ack') {
        pending.delete(message.id)
      } else if (message.type === 'presence') {
        const encoder = createEncoder()
        writeVarUint(encoder, 1)
        writeVarUint(encoder, message.clientId)
        writeVarUint(encoder, message.clock)
        writeVarString(encoder, JSON.stringify(message.state))
        applyAwarenessUpdate(awareness, toUint8Array(encoder), remote)
      } else {
        error = message.message
      }
      receive(message)
      status()
    }
    socket.onclose = (event) => {
      if (disposed || protocolFailed || socket !== current) {
        return
      }
      clearPresence()
      ready = false
      const deny = () => {
        ended = true
        clearTimeout(timer)
        error = pending.size ? 'Access ended before your local changes were saved.' : 'Access to this contract ended.'
        status()
      }
      if (event.code === 4003) {
        deny()
        return
      }
      status()
      const reconnect = async () => {
        try {
          await request(contractViewSchema, '/api/contracts/' + id)
        } catch (reason) {
          if (disposed) {
            return
          }
          if (reason instanceof ProtocolError) {
            protocolFailure()
            return
          }
          if (reason instanceof ApiError && (reason.status === 401 || reason.status === 404)) {
            deny()
            return
          }
        }
        if (!disposed && !protocolFailed && socket === current) {
          open()
        }
      }
      timer = setTimeout(
        () => {
          void reconnect()
        },
        event.code === 4012 ? 0 : retry,
      )
      retry = Math.min(retry * 2, 5_000)
    }
  }
  doc.on('update', update)
  const awarenessUpdate = (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== remote && [...changes.added, ...changes.updated, ...changes.removed].includes(doc.clientID)) {
      presence()
    }
  }
  awareness.on('update', awarenessUpdate)
  open()
  return {
    retry() {
      if (disposed || ended || !protocolFailed) {
        return
      }
      protocolFailed = false
      error = ''
      open()
      status()
    },
    dispose() {
      disposed = true
      clearTimeout(timer)
      socket.close()
      doc.off('update', update)
      awareness.off('update', awarenessUpdate)
    },
  }
}
