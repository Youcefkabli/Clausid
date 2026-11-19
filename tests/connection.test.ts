// Drive a real Y.Doc/Awareness connection with a fake transport to prove pending edits survive protocol failure and retry.
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import * as Y from 'yjs'
import { Awareness } from 'y-protocols/awareness'
import { connectContract } from '../apps/web/src/connection.ts'
import type { ConnectionState } from '../apps/web/src/connection.ts'
import { clientMessage } from '../packages/contracts/src/index.ts'
import { contractFixture } from './fixtures/contracts.ts'
import { toBase64 } from '../apps/web/src/base64.ts'

class Socket {
  static OPEN = 1
  readyState = 1
  onmessage?: (event: { data: unknown }) => void
  onclose?: (event: { code: number }) => void
  readonly sent: string[] = []
  closedCode?: number
  constructor(readonly url: URL) {
    sockets.push(this)
  }
  send(data: string) {
    this.sent.push(data)
  }
  close(code = 1000) {
    this.closedCode = code
    this.readyState = 3
    this.onclose?.({ code })
  }
  message(data: unknown) {
    this.onmessage?.({ data: typeof data === 'string' ? data : JSON.stringify(data) })
  }
}
const sockets: Socket[] = []
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal('location', { href: 'http://127.0.0.1:5173/contracts/test' })
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json(contractFixture())),
  )
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  sockets.splice(0)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function socket(index = 0) {
  const result = sockets.at(index)
  if (!result) {
    throw new Error('Expected socket')
  }
  return result
}
function setup() {
  const doc = new Y.Doc(),
    awareness = new Awareness(doc),
    remote = new Y.Doc()
  const states: ConnectionState[] = []
  const received: unknown[] = []
  const handle = connectContract(
    'test',
    doc,
    awareness,
    (value) => received.push(value),
    (state) => states.push(state),
  )
  cleanups.push(() => {
    handle.dispose()
    awareness.destroy()
    doc.destroy()
    remote.destroy()
  })
  function state() {
    const result = states.at(-1)
    if (!result) {
      throw new Error('Expected state')
    }
    return result
  }
  function initialize(target = socket()) {
    target.message({ type: 'state', contract: contractFixture(), draft: toBase64(Y.encodeStateAsUpdate(remote)) })
  }
  return { doc, awareness, remote, states, received, handle, state, initialize }
}

it('retains local document, awareness and pending IDs on malformed data; only explicit retry reconnects', async () => {
  const room = setup()
  room.initialize()
  room.doc.getText('default').insert(0, 'unsaved')
  const edit = socket()
    .sent.map((value) => clientMessage.parse(JSON.parse(value)))
    .find((value) => value.type === 'edit')
  if (!edit) {
    throw new Error('Expected a pending edit')
  }
  const bytes = Y.encodeStateAsUpdate(room.doc)
  const awareness = [...room.awareness.getStates()]
  const published = room.received.length
  socket().message({ type: 'ack', id: edit.id, revision: 'not a number' })
  expect(room.state()).toMatchObject({ ready: false, pending: 1, retryable: true, ended: false })
  expect(socket().closedCode).toBe(4002)
  expect(room.received).toHaveLength(published)
  expect(Y.encodeStateAsUpdate(room.doc)).toEqual(bytes)
  expect([...room.awareness.getStates()]).toEqual(awareness)
  await vi.advanceTimersByTimeAsync(5000)
  expect(sockets).toHaveLength(1)
  room.handle.retry()
  expect(sockets).toHaveLength(2)
  room.initialize(socket(1))
  expect(socket(1).sent).toContain(JSON.stringify(edit))
  expect(room.state()).toMatchObject({ ready: true, pending: 1, retryable: false })
  socket(1).message({ type: 'ack', id: edit.id, revision: 1 })
  expect(room.state().pending).toBe(0)
  expect(room.doc.getText('default').toJSON()).toBe('unsaved')
})

it('stages state and draft together and refuses an invalid initial binary snapshot', () => {
  const room = setup()
  socket().message({ type: 'state', contract: contractFixture(), draft: 'AA==' })
  expect(room.received).toHaveLength(0)
  expect(room.doc.getText('default').toJSON()).toBe('')
  expect(room.state().retryable).toBe(true)
})

it('preserves ordinary reconnect and resends existing update IDs', async () => {
  const room = setup()
  room.initialize()
  room.doc.getText('default').insert(0, 'queued')
  const edits = socket().sent.filter((value) => clientMessage.parse(JSON.parse(value)).type === 'edit')
  socket().close(1006)
  await vi.advanceTimersByTimeAsync(400)
  expect(sockets).toHaveLength(2)
  room.initialize(socket(1))
  for (const edit of edits) {
    expect(socket(1).sent).toContain(edit)
  }
  expect(room.state().pending).toBe(1)
})

it('ends revoked access, retains pending data and does not expose protocol retry', async () => {
  const room = setup()
  room.initialize()
  room.doc.getText('default').insert(0, 'queued')
  socket().close(4003)
  expect(room.state()).toMatchObject({ ended: true, pending: 1, retryable: false })
  room.handle.retry()
  await vi.advanceTimersByTimeAsync(5000)
  expect(sockets).toHaveLength(1)
})

it('ignores late frames from the replaced socket and detaches local listeners on disposal', () => {
  const room = setup()
  room.initialize()
  socket().message('{')
  room.handle.retry()
  const count = room.received.length
  socket().message({ type: 'error', message: 'late old transport' })
  expect(room.received).toHaveLength(count)
  room.handle.dispose()
  const sent = socket(1).sent.length
  room.doc.getText('default').insert(0, 'after disposal')
  expect(socket(1).sent).toHaveLength(sent)
})
