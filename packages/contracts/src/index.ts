import { z } from 'zod'

export const identifier = z.uuid()
export const emailAddress = z.email().max(254).transform((value) => value.toLowerCase())
export const titleInput = z.string().trim().min(1).max(160)
export const createContract = z.object({ title: titleInput, requestId: identifier })
export const inviteEditor = z.object({ email: emailAddress })
export const redeemInvite = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
export const previewContract = z.object({
  revision: z.number().int().nonnegative(),
  signers: z.array(emailAddress).min(1).max(20),
}).refine(({ signers }) => new Set(signers).size === signers.length, 'Enter each signer once.')
export const freezeContract = z.object({ previewId: identifier })
export const consentVersion = '1'
export const consentText = 'I have reviewed this document and agree to sign it electronically.'
export const signContract = z.object({
  versionId: identifier,
  digest: z.string().regex(/^[a-f0-9]{64}$/),
  name: z.string().trim().min(1).max(120),
  consent: z.literal(true),
  consentVersion: z.literal(consentVersion),
})
const encoded = z.base64().max(350_000)
export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), id: identifier, update: encoded }),
  z.object({ type: z.literal('presence'), clientId: z.number().int().nonnegative().max(0xffffffff),
    clock: z.number().int().nonnegative().max(0xffffffff), cursor: z.json().nullable() }),
])

export type Status = 'Draft' | 'Awaiting signatures' | 'Signed' | 'Voided'
export type Role = 'owner' | 'editor' | 'signer'
export type Summary = { id: string; title: string; status: Status; role: Role }
export type Signature = {
  versionId: string
  digest: string
  accountId: string
  email: string
  name: string
  signedAt: string
  consentVersion: typeof consentVersion
}
export type ContractView = Summary & {
  revision: number
  editors: { id: string; email: string }[]
  invites: { id: string; email: string }[]
  version: { id: string; digest: string; canSign: boolean; signers: { email: string; signedAt: string | null }[] } | null
}
export type ServerMessage =
  | { type: 'state'; contract: ContractView; draft?: string }
  | { type: 'edit'; id: string; revision: number; update: string }
  | { type: 'ack'; id: string; revision: number }
  | { type: 'presence'; clientId: number; clock: number; state: Record<string, unknown> | null }
  | { type: 'error'; message: string }
export type Preview = { id: string; digest: string }

export const ValidationError = z.ZodError
