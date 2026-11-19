// Private persisted/service records: keep legacy optional fields and unknown stored extensions without exporting them to the browser.
import { z } from 'zod'
import {
  contractViewSchema,
  digestSchema,
  nativeThreadSchema,
  partySchema,
  pdfAnnotationSchema,
  signatureSchema,
  statusSchema,
  workspaceSchema,
} from '@clausid/contracts'
import type { ResponseSchema } from '@clausid/contracts'

const id = z.string().min(1).max(100)
const email = z.email().max(254)
const time = z.number().finite().nonnegative()
export const accountSchema = z.object({ id, email, name: z.string(), createdAt: time, expires: time }).passthrough()
export type Account = z.infer<typeof accountSchema>
const memberSchema = partySchema.passthrough()
const inviteSchema = z.object({ id, digest: digestSchema, email, expires: time, role: z.enum(['editor', 'signer']) }).passthrough()
const mailSchema = z.object({ id, email, token: z.string(), role: z.enum(['editor', 'signer']) }).passthrough()
const previewSchema = z.object({ id, revision: z.number().int().nonnegative(), signers: z.array(email), digest: digestSchema, expires: time }).passthrough()
const versionSchema = z.object({ id, digest: digestSchema, signers: z.array(email), frozenAt: z.string() }).passthrough()
export const recordStateSchema = z
  .object({
    id,
    title: z.string(),
    owner: memberSchema,
    editors: z.array(memberSchema),
    signers: z.array(memberSchema),
    createdAt: time.optional(),
    updatedAt: time.optional(),
    assigneeId: id.nullable().optional(),
    deletion: z
      .object({ workspaceId: id.optional(), accounts: z.array(id).optional() })
      .passthrough()
      .optional(),
    workspaceJoins: z.array(id).optional(),
    status: statusSchema,
    revision: z.number().int().nonnegative(),
    invites: z.array(inviteSchema),
    preview: previewSchema.nullable(),
    sourcePdf: contractViewSchema.shape.sourcePdf,
    annotations: z.array(pdfAnnotationSchema).optional(),
    outline: contractViewSchema.shape.outline,
    threads: z.array(nativeThreadSchema).optional(),
    negotiatedPdf: contractViewSchema.shape.negotiatedPdf,
    version: versionSchema.nullable(),
    signatures: z.array(signatureSchema),
    outbox: z.array(mailSchema),
    voidedAt: z.string().optional(),
  })
  .passthrough()
export type RecordState = z.infer<typeof recordStateSchema>
export const attachmentSchema = z
  .object({
    account: accountSchema,
    clientId: z.number().int().nonnegative().max(0xffffffff).optional(),
    clock: z.number().int().nonnegative().optional(),
    cursor: z.unknown().optional(),
  })
  .passthrough()
export type Attachment = z.infer<typeof attachmentSchema>
export type Member = z.infer<typeof memberSchema>
export type Invite = z.infer<typeof inviteSchema>
export type Mail = z.infer<typeof mailSchema>
export type Version = z.infer<typeof versionSchema>

const sharingPartySchema = memberSchema.extend({ redeemedDigest: digestSchema.optional() }).passthrough()
export const sharingSchema = z
  .object({
    setup: z.object({ documentDigest: digestSchema.optional() }).passthrough().optional(),
    setupOutbox: z.array(z.object({ email, token: z.string() }).passthrough()).optional(),
    deleting: z.boolean().optional(),
    workspace: workspaceSchema.passthrough(),
    owner: sharingPartySchema,
    parties: z.array(sharingPartySchema),
    invites: z.array(z.object({ email, digest: digestSchema, expires: time }).passthrough()),
  })
  .passthrough()
export type Sharing = z.infer<typeof sharingSchema>
export type Party = z.infer<typeof sharingPartySchema>
export const initializeWorkspaceSchema = z.union([
  z.object({ workspace: workspaceSchema, team: z.array(email), documentDigest: digestSchema.optional() }),
  workspaceSchema,
])
export const optionalWorkspaceSchema = z.object({ workspaceId: id.optional() })
export const workspaceIdSchema = z.object({ workspaceId: id })
export const workspaceContractSchema = workspaceIdSchema.nullable()
export const directoryEntriesSchema = z.array(z.object({ id, workspaceId: id.nullable(), createdAt: time }))
export const reservationSchema = z.object({ workspace: workspaceSchema, pending: z.boolean() })
export const createBodySchema = z.object({ title: z.unknown().optional(), draft: z.base64().optional() })
export const pdfHeaderSchema = z.object({ title: z.string(), name: z.string(), pages: z.number().int().positive() })
export const copySourceSchema = z.object({ title: z.string().optional(), draft: z.base64(), pdf: z.boolean().optional() })
export const shareWorkspaceSchema = z.object({ workspaceId: id, members: z.array(partySchema) })
export const forgetContractSchema = z.object({ contractId: id })
export const restoreBookmarkSchema = z.object({ bookmark: z.string().regex(/^[\da-f-]+$/i) })
export const snapshotSchema = z.object({
  tables: z.record(z.string(), z.array(z.array(z.union([z.string(), z.number().finite()])))),
  sharing: z.unknown().optional(),
})
export const snapshotSharingSchema = z.object({ setupOutbox: z.array(z.unknown()).optional() }).passthrough()
export const assetManifestSchema = z.array(z.string())
export const wasmErrorSchema = z.object({ message: z.string().optional() })
export type PdfNode = {
  type: string
  text?: string | undefined
  attrs?: Record<string, unknown> | undefined
  marks?: { type: string }[] | undefined
  content?: PdfNode[] | undefined
}
export const pdfNodeSchema: z.ZodType<PdfNode> = z.lazy(() =>
  z.object({
    type: z.string(),
    text: z.string().optional(),
    attrs: z.record(z.string(), z.unknown()).optional(),
    marks: z.array(z.object({ type: z.string() })).optional(),
    content: z.array(pdfNodeSchema).optional(),
  }),
)

// Schema failures in stored state are infrastructure failures, not malformed user input. Never reset the bytes.
function sameKnownValues(parsed: unknown, original: unknown): boolean {
  if (Object.is(parsed, original)) {
    return true
  }
  if (Array.isArray(parsed)) {
    return (
      Array.isArray(original) && parsed.length === original.length && parsed.every((value: unknown, index: number) => sameKnownValues(value, original[index]))
    )
  }
  if (parsed !== null && typeof parsed === 'object') {
    if (original === null || typeof original !== 'object' || Array.isArray(original)) {
      return false
    }
    return Object.entries(parsed).every(([key, value]: [string, unknown]) => Object.hasOwn(original, key) && sameKnownValues(value, Reflect.get(original, key)))
  }
  return false
}
export function storedRecord<T>(schema: ResponseSchema<T>, value: unknown): T {
  const result = schema.safeParse(value)
  if (!result.success || !sameKnownValues(result.data, value)) {
    throw new Error('Stored Clausid record is invalid.')
  }
  // Validated adapter: every parsed field equals the original; keep unknown nested extensions
  // so a read followed by a save cannot silently strip future/legacy stored metadata.
  return value as T
}
function identityFromRequest<T>(request: Request, schema: ResponseSchema<T>): T {
  const header = request.headers.get('x-clausid-account')
  if (!header) {
    throw new Error('Internal identity is missing.')
  }
  const value: unknown = JSON.parse(decodeURIComponent(header))
  return storedRecord(schema, value)
}
export function accountFromRequest(request: Request): Account {
  return identityFromRequest(request, accountSchema)
}
// Background contract cleanup forwards the stored owner party, never a fabricated session.
export function cleanupPartyFromRequest(request: Request): Member {
  return identityFromRequest(request, memberSchema)
}
export async function readSharing(storage: { get(key: string): Promise<unknown> }): Promise<Sharing | undefined> {
  const value = await storage.get('workspace-sharing')
  return value === undefined ? undefined : storedRecord(sharingSchema, value)
}
