import * as Y from 'yjs'
import { Awareness, applyAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import { createEncoder, writeVarString, writeVarUint, toUint8Array } from 'lib0/encoding'
import type { ServerMessage } from '@clausid/contracts'
import { api, ApiError } from './api.ts'

export type ConnectionState = { ready: boolean; pending: number; error: string; ended: boolean }
const remote = Symbol('server')
const fromBase64 = (value: string) => Uint8Array.from(atob(value), (character) => character.charCodeAt(0))
function toBase64(value: Uint8Array) {
  let text = ''
  for (let index = 0; index < value.length; index += 8192) text += String.fromCharCode(...value.subarray(index, index + 8192))
  return btoa(text)
}

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
  let ended = false
  let error = ''
  const pending = new Map<string, string>()
  const status = () => setState({ ready, pending: pending.size, error, ended })
  const send = (value: object) => {
    if (ready && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value))
  }
  let presenceClock = 0
  function presence() {
    send({ type: 'presence', clientId: doc.clientID, clock: (presenceClock += 2), cursor: awareness.getLocalState()?.cursor ?? null })
  }
  function clearPresence() {
    const others = [...awareness.meta.keys()].filter((key) => key !== doc.clientID)
    removeAwarenessStates(awareness, others, remote)
    for (const key of others) awareness.meta.delete(key)
  }
  function update(bytes: Uint8Array, origin: unknown) {
    if (origin === remote) return
    const updateId = crypto.randomUUID()
    pending.set(updateId, toBase64(bytes))
    send({ type: 'edit', id: updateId, update: pending.get(updateId) })
    status()
  }
  function open() {
    const url = new URL('/api/contracts/' + id + '/socket', location.href)
    url.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
    socket = new WebSocket(url)
    socket.onmessage = (event) => {
      const message = JSON.parse(String(event.data)) as ServerMessage
      if (message.type === 'state') {
        if (message.draft !== undefined) Y.applyUpdate(doc, fromBase64(message.draft), remote)
        if (!ready) {
          ready = true
          retry = 400
          if (message.contract.status === 'Draft') {
            for (const [id, update] of pending) send({ type: 'edit', id, update })
            presence()
          } else if (pending.size) {
            error = 'The contract was frozen before all of your changes were saved.'
          }
        }
        if (message.contract.status !== 'Draft' && pending.size) error = 'Some local changes were not saved before freezing.'
      } else if (message.type === 'edit') {
        Y.applyUpdate(doc, fromBase64(message.update), remote)
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
      if (disposed) return
      clearPresence()
      ready = false
      const deny = () => {
        ended = true
        clearTimeout(timer)
        error = pending.size ? 'Access ended before your local changes were saved.' : 'Access to this contract ended.'
        status()
      }
      if (event.code === 4003) { deny(); return }
      status()
      const reconnect = async () => {
        try { await api('/' + id) } catch (reason) {
          if (disposed) return
          if (reason instanceof ApiError && (reason.status === 401 || reason.status === 404)) { deny(); return }
        }
        if (!disposed) open()
      }
      timer = setTimeout(() => { void reconnect() }, event.code === 4012 ? 0 : retry)
      retry = Math.min(retry * 2, 5_000)
    }
  }
  doc.on('update', update)
  awareness.on('update', (changes: { added: number[]; updated: number[]; removed: number[] }, origin: unknown) => {
    if (origin !== remote && [...changes.added, ...changes.updated, ...changes.removed].includes(doc.clientID)) presence()
  })
  open()
  return () => {
    disposed = true
    clearTimeout(timer)
    socket.close()
    doc.off('update', update)
  }
}
