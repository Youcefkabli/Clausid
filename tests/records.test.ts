// Preserve valid old/private record bytes and reject corrupt or normalizing parsers before persistence can change.
import { expect, it } from 'vite-plus/test'
import { z } from 'zod'
import { accountFromRequest, cleanupPartyFromRequest, recordStateSchema, sharingSchema, storedRecord } from '../apps/worker/src/records.ts'
import { accountFixture, workspaceFixture } from './fixtures/contracts.ts'

it('preserves old omitted fields and unknown nested extensions through validated record reads', () => {
  const original = {
    id: 'old-contract',
    title: '',
    owner: { ...accountFixture, futureMemberField: 'keep' },
    editors: [],
    signers: [],
    status: 'Draft',
    revision: 0,
    invites: [],
    preview: null,
    version: null,
    signatures: [],
    outbox: [],
    futureVersionField: { nested: ['keep this'] },
  }
  const parsed = storedRecord(recordStateSchema, original)
  expect(parsed).toBe(original)
  expect(parsed.owner['futureMemberField']).toBe('keep')
  expect(parsed['futureVersionField']).toEqual({ nested: ['keep this'] })
  expect(parsed).not.toHaveProperty('createdAt')
  expect(
    storedRecord(sharingSchema, {
      workspace: { ...workspaceFixture, futureWorkspaceField: true },
      owner: accountFixture,
      parties: [],
      invites: [],
    }).workspace,
  ).toHaveProperty('futureWorkspaceField', true)
})

it('rejects malformed records and schemas that would transform/default known values', () => {
  expect(() => storedRecord(recordStateSchema, { id: 'broken' })).toThrow('Stored Clausid record is invalid')
  const data = { value: '  exact stored value  ' }
  expect(() => storedRecord(z.object({ value: z.string().trim() }), data)).toThrow('Stored Clausid record is invalid')
  expect(data.value).toBe('  exact stored value  ')
  expect(() => storedRecord(z.object({ value: z.string().default('invented') }), {})).toThrow('Stored Clausid record is invalid')
  expect(storedRecord(z.object({ value: z.string() }), data)).toBe(data)
})

it('accepts a stored owner party only for cleanup without inventing a fresh authenticated session', () => {
  const request = new Request('https://directory/sharing/forget-contract', {
    headers: { 'x-clausid-account': encodeURIComponent(JSON.stringify(accountFixture)) },
  })
  expect(cleanupPartyFromRequest(request)).toEqual(accountFixture)
  expect(() => accountFromRequest(request)).toThrow('Stored Clausid record is invalid')
  expect(() => cleanupPartyFromRequest(new Request('https://directory/'))).toThrow('Internal identity is missing')
  const session = { ...accountFixture, name: 'Owner', createdAt: 1, expires: 2 }
  expect(accountFromRequest(new Request('https://directory/', { headers: { 'x-clausid-account': encodeURIComponent(JSON.stringify(session)) } }))).toEqual(
    session,
  )
})
