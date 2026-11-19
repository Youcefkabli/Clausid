// Verify producer compatibility and reject malformed external data before HTTP/projection/Yjs consumers publish it.
import { afterEach, describe, expect, it, vi } from 'vite-plus/test'
import * as Y from 'yjs'
import {
  contractViewSchema,
  emptySchema,
  invitationAckSchema,
  pdfTextBlocksSchema,
  previewSchema,
  serverMessageSchema,
  summariesSchema,
  workspaceAccessSchema,
  workspacePartiesSchema,
  workspaceSchema,
  workspacesSchema,
} from '../packages/contracts/src/index.ts'
import { ApiError, parseResponse, ProtocolError, request } from '../apps/web/src/response.ts'
import { parseProjection } from '../apps/web/src/projection.ts'
import { parseServerFrame } from '../apps/web/src/protocol.ts'
import { toBase64 } from '../apps/web/src/base64.ts'
import { accountFixture, contractFixture, digestFixture, workspaceFixture } from './fixtures/contracts.ts'

const documents: Y.Doc[] = []
function document() {
  const value = new Y.Doc()
  documents.push(value)
  return value
}
afterEach(() => {
  vi.unstubAllGlobals()
  for (const doc of documents.splice(0)) {
    doc.destroy()
  }
})

describe('public response contracts', () => {
  it('accepts producer shapes, opaque account IDs and legitimate old optional/null representations', () => {
    expect(contractViewSchema.parse(contractFixture()).version).toBeNull()
    expect(workspaceSchema.parse(workspaceFixture)).toEqual(workspaceFixture)
    expect(workspacesSchema.parse([workspaceFixture])).toHaveLength(1)
    expect(summariesSchema.parse([contractFixture()])).toHaveLength(1)
    expect(workspacePartiesSchema.parse({ role: 'owner', parties: [accountFixture], invitations: [] }).parties).toHaveLength(1)
    expect(previewSchema.parse({ id: 'preview', digest: digestFixture }).digest).toBe(digestFixture)
    expect(workspaceAccessSchema.parse({ canManage: false })).toEqual({ canManage: false })
    expect(invitationAckSchema.parse({ email: accountFixture.email }).email).toBe(accountFixture.email)
    expect(pdfTextBlocksSchema.parse([{ page: 0, block: 0, text: 'Services', baseline: [72, 600], font_size: 10 }])).toHaveLength(1)
  })

  it('ignores additive fields without normalizing server values and rejects malformed consumed fields', () => {
    expect(workspaceSchema.parse({ ...workspaceFixture, name: ' Services ', futureField: 1 }).name).toBe(' Services ')
    expect(workspaceSchema.parse({ ...workspaceFixture, futureField: 1 })).not.toHaveProperty('futureField')
    for (const invalid of [
      { ...contractFixture(), version: undefined },
      { ...contractFixture(), revision: '1' },
      { ...contractFixture(), status: 'Active' },
      { ...contractFixture(), editors: [{ id: 'a', email: 1 }] },
    ]) {
      expect(contractViewSchema.safeParse(invalid).success).toBe(false)
    }
    expect(workspaceSchema.safeParse({ ...workspaceFixture, firstContractId: 3 }).success).toBe(false)
  })

  it('accepts every server variant and rejects unknown variants, wrong fields and invalid base64', () => {
    const variants = [
      { type: 'state', contract: contractFixture() },
      { type: 'edit', id: 'update', revision: 1, update: 'AAA=' },
      { type: 'ack', id: 'update', revision: 1 },
      { type: 'presence', clientId: 1, clock: 2, state: null },
      { type: 'error', message: 'Unavailable' },
    ]
    for (const variant of variants) {
      expect(serverMessageSchema.safeParse(variant).success).toBe(true)
    }
    for (const invalid of [
      { type: 'future' },
      { type: 'ack', id: 'update', revision: '1' },
      { type: 'edit', id: 'update', revision: 1, update: 'not-base64' },
      { type: 'presence', clientId: -1, clock: 0, state: {} },
    ]) {
      expect(serverMessageSchema.safeParse(invalid).success).toBe(false)
    }
  })
})

describe('HTTP and projection boundaries', () => {
  it('handles valid JSON and explicit empty results while rejecting bad successful responses', async () => {
    expect(await parseResponse(Response.json(contractFixture()), contractViewSchema)).toEqual(contractFixture())
    expect(await parseResponse(new Response(null, { status: 204 }), emptySchema)).toBeUndefined()
    await expect(parseResponse(new Response(null, { status: 204 }), contractViewSchema)).rejects.toBeInstanceOf(ProtocolError)
    await expect(parseResponse(Response.json({ id: 'wrong' }), contractViewSchema)).rejects.toBeInstanceOf(ProtocolError)
    await expect(parseResponse(new Response('invalid JSON'), contractViewSchema)).rejects.toBeInstanceOf(ProtocolError)
  })

  it('preserves HTTP status, uses safe fallback errors and propagates body cancellation', async () => {
    await expect(parseResponse(Response.json({ error: 'Access ended' }, { status: 401 }), contractViewSchema)).rejects.toMatchObject({
      status: 401,
      message: 'Access ended',
    })
    await expect(parseResponse(new Response('private payload', { status: 503 }), contractViewSchema)).rejects.toMatchObject({
      status: 503,
      message: 'The request failed. Please try again.',
    })
    const response = Response.json({})
    vi.spyOn(response, 'json').mockRejectedValue(new DOMException('Cancelled', 'AbortError'))
    await expect(parseResponse(response, contractViewSchema)).rejects.toHaveProperty('name', 'AbortError')
    expect(new ApiError(404, 'Unavailable').status).toBe(404)
  })

  it('preserves request method/body and cancellation without an unchecked generic result', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(contractFixture()))
    vi.stubGlobal('fetch', fetch)
    const controller = new AbortController()
    await request(contractViewSchema, '/api/contracts/a', { action: 'edit' }, controller.signal)
    expect(fetch).toHaveBeenCalledWith('/api/contracts/a', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{"action":"edit"}',
      signal: controller.signal,
    })
    fetch.mockResolvedValue(Response.json(contractFixture()))
    await request(contractViewSchema, '/api/contracts/a')
    expect(fetch).toHaveBeenLastCalledWith('/api/contracts/a', {})
  })

  it('distinguishes missing, valid and invalid projections without trusting JSON casts', () => {
    expect(parseProjection(undefined, contractViewSchema).kind).toBe('missing')
    expect(parseProjection(JSON.stringify(contractFixture()), contractViewSchema)).toEqual({ kind: 'ready', data: contractFixture() })
    expect(parseProjection('bad document bytes', contractViewSchema)).toMatchObject({ kind: 'invalid' })
    expect(parseProjection('{"version":3}', contractViewSchema)).toMatchObject({ kind: 'invalid' })
    expect(JSON.stringify(parseProjection('private document bytes', contractViewSchema))).not.toContain('private document bytes')
  })
})

describe('staged Yjs frame validation', () => {
  it('does not change the live document while validating a valid candidate', () => {
    const live = document(),
      source = document()
    source.getText('test').insert(0, 'Approved')
    const frame = parseServerFrame(JSON.stringify({ type: 'state', contract: contractFixture(), draft: toBase64(Y.encodeStateAsUpdate(source)) }), live)
    expect(live.getText('test').toJSON()).toBe('')
    if (!frame.update) {
      throw new Error('Expected staged update')
    }
    Y.applyUpdate(live, frame.update)
    expect(live.getText('test').toJSON()).toBe('Approved')
  })

  it('rejects an invalid envelope or binary update without changing existing local work', () => {
    const live = document()
    live.getText('test').insert(0, 'Unsaved')
    const before = Y.encodeStateAsUpdate(live)
    for (const raw of [
      '{',
      JSON.stringify({ type: 'future' }),
      JSON.stringify({ type: 'edit', id: 'x', revision: 1, update: 'AA==' }),
      JSON.stringify({ type: 'state', contract: { ...contractFixture(), version: undefined }, draft: 'AA==' }),
    ]) {
      expect(() => parseServerFrame(raw, live)).toThrow(ProtocolError)
      expect(Y.encodeStateAsUpdate(live)).toEqual(before)
    }
  })

  it('rejects a dependent update whose predecessor is absent instead of leaving pending Yjs structures', () => {
    const live = document(),
      source = document()
    source.getText('test').insert(0, 'A')
    const previous = Y.encodeStateVector(source)
    source.getText('test').insert(1, 'B')
    const update = Y.encodeStateAsUpdate(source, previous)
    expect(() => parseServerFrame(JSON.stringify({ type: 'edit', id: 'x', revision: 2, update: toBase64(update) }), live)).toThrow(ProtocolError)
    expect(live.store.pendingStructs).toBeNull()
  })
})
