import { describe, expect, it } from 'vite-plus/test'
import { consentVersion, previewContract, signContract } from '../packages/contracts/src/index.ts'

describe('contract workflow inputs', () => {
  it('normalizes emails and rejects duplicate signers', () => {
    expect(previewContract.parse({ revision: 1, signers: ['Signer@Example.com'] }).signers).toEqual(['signer@example.com'])
    expect(previewContract.safeParse({ revision: 1, signers: ['Signer@Example.com', 'signer@example.com'] }).success).toBe(false)
  })

  it('binds explicit consent and a signature to a version and digest', () => {
    const signature = { versionId: crypto.randomUUID(), digest: 'f'.repeat(64), name: 'Pat Lee', consent: true, consentVersion }
    expect(signContract.safeParse(signature).success).toBe(true)
    expect(signContract.safeParse({ ...signature, consent: false }).success).toBe(false)
    expect(signContract.safeParse({ ...signature, consentVersion: '0' }).success).toBe(false)
    expect(signContract.safeParse({ ...signature, digest: 'stale' }).success).toBe(false)
  })
})
