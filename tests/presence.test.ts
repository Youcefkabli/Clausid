// Exercise actual awareness positions and transport lifecycles, including leases and protocol failure.
import { afterEach, beforeEach, expect, it, vi } from 'vite-plus/test'
import * as Y from 'yjs'
import { clientMessage, cursorSchema, presenceColor, workspaceActivitySchema, workspacePresenceSchema } from '../packages/contracts/src/index.ts'
import { aggregateStatus, isWorkspaceMember, participantIdentity, presenceLease } from '../apps/worker/src/presence-state.ts'
import { sharingSchema } from '../apps/worker/src/records.ts'
import { connectWorkspacePresence } from '../apps/web/src/workspace-connection.ts'
import type { WorkspacePresenceState } from '../apps/web/src/workspace-connection.ts'
import { workspaceFixture } from './fixtures/contracts.ts'

const account = { id: 'owner', email: 'owner@example.com', name: 'Owner', createdAt: 1, expires: 1_000_000 }
const session = { account, updatedAt: 10_000, status: 'Online' as const, contractId: null }
it('aggregates live tabs without a stale tab keeping a member online', () => {
  expect(aggregateStatus([], 10_000)).toBe('Offline')
  expect(aggregateStatus([{ ...session, status: 'Away' }, session], 10_000)).toBe('Online')
  expect(aggregateStatus([{ ...session, status: 'Away' }], 10_000)).toBe('Away')
  expect(aggregateStatus([{ ...session, status: 'Editing' }], 11_999)).toBe('Editing')
  expect(aggregateStatus([{ ...session, status: 'Editing' }], 12_000)).toBe('Online')
  expect(aggregateStatus([session], session.updatedAt + presenceLease)).toBe('Offline')
  expect(aggregateStatus([{ ...session, account: { ...account, expires: 10_000 } }], 10_000)).toBe('Offline')
})
it('uses verified identity and preserves compatible rosters while checking both member ID and email', () => {
  const state = sharingSchema.parse({ workspace: workspaceFixture, owner: account, parties: [], invites: [] })
  expect(isWorkspaceMember(state, account)).toBe(true)
  expect(isWorkspaceMember(state, { ...account, email: 'other@example.com' })).toBe(false)
  expect(isWorkspaceMember({ ...state, deleting: true }, account)).toBe(false)
  expect(isWorkspaceMember(state, { ...account, id: 'other' })).toBe(false)
  expect(participantIdentity(account).name).toBe('Owner')
  expect(participantIdentity({ ...account, name: '   ' }).name).toBe(account.email)
  expect(participantIdentity({ ...account, name: 'n'.repeat(100) }).name).toHaveLength(80)
  expect(participantIdentity(account).color).toBe(presenceColor(account.id))
  expect(participantIdentity({ ...account, name: 'Renamed' }).color).toBe(participantIdentity(account).color)
  expect(presenceColor('other')).not.toBe(presenceColor('owner'))
})
it('accepts Yjs cursor positions and rejects malformed cursor structures before awareness sees them', () => {
  const doc = new Y.Doc()
  try {
    const text = doc.getText('default')
    text.insert(0, 'Example')
    const anchor: unknown = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 1))
    const head: unknown = Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(text, 4))
    expect(cursorSchema.safeParse({ anchor, head }).success).toBe(true)
    expect(clientMessage.safeParse({ type: 'presence', clientId: doc.clientID, clock: 2, cursor: { anchor, head } }).success).toBe(true)
    for (const cursor of [{}, { anchor: 3, head: {} }, { anchor: { type: 'bad' }, head }, { anchor: { item: { client: -1, clock: 0 } }, head }]) {
      expect(cursorSchema.safeParse(cursor).success).toBe(false)
    }
    expect(cursorSchema.parse(null)).toBeNull()
    expect(workspaceActivitySchema.safeParse({ type: 'activity', status: 'Editing', contractId: 'not-a-uuid' }).success).toBe(false)
    expect(workspacePresenceSchema.safeParse({ type: 'participants', participants: [{ ...participantIdentity(account), status: 'Watching' }] }).success).toBe(
      false,
    )
  } finally {
    doc.destroy()
  }
})

class Socket {
  static OPEN = 1
  readyState = 1
  onmessage?: (event: { data: string }) => void
  onclose?: (event: { code: number }) => void
  readonly sent: string[] = []
  constructor(readonly url: URL) {
    sockets.push(this)
  }
  send(raw: string) {
    this.sent.push(raw)
  }
  close(code = 1000) {
    this.readyState = 3
    this.onclose?.({ code })
  }
  message(value: unknown) {
    this.onmessage?.({ data: JSON.stringify(value) })
  }
}
const sockets: Socket[] = []
const cleanups: (() => void)[] = []
beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(10_000)
  vi.stubGlobal('WebSocket', Socket)
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ role: 'owner', parties: [], invitations: [] })),
  )
  vi.stubGlobal('location', { href: 'http://localhost/contracts/abc', protocol: 'http:' })
  vi.stubGlobal('document', Object.assign(new EventTarget(), { hidden: false }))
})
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) {
    cleanup()
  }
  sockets.splice(0)
  vi.unstubAllGlobals()
  vi.useRealTimers()
})
function latestSocket() {
  const socket = sockets.at(-1)
  if (!socket) {
    throw new Error('Missing socket')
  }
  return socket
}
function setup() {
  const doc = new Y.Doc()
  const states: WorkspacePresenceState[] = []
  const handle = connectWorkspacePresence(workspaceFixture.id, (state) => states.push(state), null, doc)
  const participant = { ...participantIdentity(account), status: 'Online', working: false, documents: [] }
  latestSocket().message({ type: 'participants', participants: [participant] })
  cleanups.push(() => {
    handle.dispose()
    doc.destroy()
  })
  return { doc, states, handle, participant }
}
it('sends editing only for local changes, clears it after two seconds, and reports idle and hidden tabs as Away', async () => {
  const { doc } = setup()
  const socket = latestSocket()
  doc.transact(() => doc.getText('default').insert(0, 'Remote'), Symbol('server'))
  await vi.advanceTimersByTimeAsync(100)
  expect(socket.sent).toHaveLength(1)
  doc.getText('default').insert(0, 'Local')
  await vi.advanceTimersByTimeAsync(100)
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Editing' })
  await vi.advanceTimersByTimeAsync(2_000)
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Online' })
  await vi.advanceTimersByTimeAsync(60_000)
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Away' })
  document.dispatchEvent(new Event('pointermove'))
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Online' })
  Object.defineProperty(document, 'hidden', { value: true, configurable: true })
  document.dispatchEvent(new Event('visibilitychange'))
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Away' })
})
it('isolates malformed presence, clears stale members, and reconnects only after explicit retry', async () => {
  const { doc, states, handle } = setup()
  doc.getText('default').insert(0, 'Keep local text')
  latestSocket().message({ type: 'participants', participants: [{ id: 'broken' }] })
  expect(states.at(-1)).toMatchObject({ participants: [], ready: false, retryable: true })
  await vi.advanceTimersByTimeAsync(100_000)
  expect(sockets).toHaveLength(1)
  expect(doc.getText('default').toJSON()).toBe('Keep local text')
  handle.retry()
  expect(sockets).toHaveLength(2)
})
it('refreshes expired sessions, removes disconnected members, and cleans up timers on dispose', async () => {
  const { states, handle } = setup()
  latestSocket().close(4012)
  expect(states.at(-1)?.participants).toEqual([])
  await vi.advanceTimersByTimeAsync(1)
  expect(sockets).toHaveLength(2)
  handle.dispose()
  expect(vi.getTimerCount()).toBe(0)
})

it('stops reconnecting when the authoritative workspace access check refuses the account', async () => {
  const { states } = setup()
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Workspace unavailable.' }, { status: 404 })),
  )
  latestSocket().close(4000)
  await vi.advanceTimersByTimeAsync(100_000)
  expect(sockets).toHaveLength(1)
  expect(states.at(-1)).toMatchObject({ ready: false, participants: [], error: 'Workspace access ended.', retryable: true })
})

it('announces editing on the first keystroke and refreshes it during uninterrupted typing', async () => {
  const { doc } = setup()
  const socket = latestSocket()
  doc.getText('default').insert(0, 'Start')
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Editing' })
  for (let index = 0; index < 60; index++) {
    await vi.advanceTimersByTimeAsync(50)
    doc.getText('default').insert(0, 'a')
  }
  expect(socket.sent.length).toBeGreaterThanOrEqual(4)
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Editing' })
  await vi.advanceTimersByTimeAsync(2_100)
  expect(JSON.parse(socket.sent.at(-1) ?? '')).toMatchObject({ status: 'Online' })
})
