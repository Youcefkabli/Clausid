import { z } from 'zod'

export const identifier = z.uuid()
export const emailAddress = z.email().max(254).transform((value) => value.toLowerCase())
export const titleInput = z.string().trim().min(1).max(160)
export const createContract = z.object({ title: titleInput, requestId: identifier, workspaceId: identifier.optional() })
export const workspaceSlug = z.string().min(1).max(63).regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
  .refine((slug) => !['admin', 'app', 'api', 'northwind', 'support'].includes(slug))
export const workspaceDocumentLimit = 1024 * 1024
export const workspaceDocument = z.object({
  name: z.string().min(1).max(255).regex(/\.pdf$/i),
  data: z.string().min(1).max(4 * Math.ceil(workspaceDocumentLimit / 3)).regex(/^[a-zA-Z0-9+/]+={0,2}$/),
})
export const workspaceProject = z.string().trim().max(160)
export const createWorkspace = z.object({
  requestId: identifier,
  name: titleInput,
  slug: workspaceSlug.optional(),
  project: workspaceProject.optional(),
  description: z.string().trim().max(500).default(''),
})
export const setupWorkspace = createWorkspace.extend({
  document: workspaceDocument.optional(),
  team: z.array(emailAddress).min(1).max(39).transform(emails => [...new Set(emails)]),
})
export const workspaceStatuses = ['Draft', 'Review', 'Negotiation', 'Signature', 'Active', 'Expiring', 'On hold', 'Closed', 'Completed'] as const
export const customizeWorkspace = z.object({
  name: titleInput,
  description: z.string().trim().max(500),
  project: workspaceProject,
  status: z.enum(workspaceStatuses),
  assigneeId: z.string().min(1).max(100),
  label: z.string().trim().min(1).max(40),
}).partial().refine((fields) => Object.keys(fields).length > 0, 'Change at least one workspace setting.')
export type Workspace = {
  id: string; name: string; description: string; slug?: string | null; role?: 'owner' | 'member'
  documentName?: string | null; firstContractId?: string | null; project?: string | null; createdAt?: number; updatedAt?: number; status?: typeof workspaceStatuses[number]
  assignee?: { id: string; email: string }; labels?: string[]
}

export type WorkspaceParties = {
  role: 'owner' | 'member'
  parties: { id: string; email: string }[]
  invitations: string[]
}

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
export type ContractParty = { id: string; email: string }
export type Summary = {
  id: string; title: string; status: Status; role: Role; workspaceId?: string
  owner?: ContractParty; assignee?: ContractParty; team?: ContractParty[]
  createdAt?: number; updatedAt?: number; hasSignatures?: boolean
}
export const assignContract = z.object({ assigneeId: z.string().min(1).max(100).nullable() })
export type Signature = {
  versionId: string
  digest: string
  accountId: string
  email: string
  name: string
  signedAt: string
  consentVersion: typeof consentVersion
}
const pdfReplacement = z.object({
  block: z.number().int().nonnegative(),
  expected: z.string().min(1).max(800),
  replacement: z.string().max(800),
}).refine(edit => edit.expected !== edit.replacement, 'Enter different replacement text.')
export type PdfTextBlock = { page: number; block: number; text: string; baseline: [number, number] }
export type PdfTextEdit = z.infer<typeof pdfReplacement> & { page: number; offset: number }

export const pdfMarkup = z.object({
  tool: z.enum(['pen', 'brush', 'highlight', 'underline', 'strikethrough']),
  points: z.array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) })).min(2).max(256),
})
export type PdfMarkup = z.infer<typeof pdfMarkup>

const quote = z.string().min(1).max(800)
const pdfLocation = z.object({ x: z.number().finite(), y: z.number().finite(), offset: z.number().int().nonnegative().max(100_000) })
export type PdfLocation = z.infer<typeof pdfLocation>
const relativePosition = z.base64().min(1).max(256)
const nativeAnchor = z.object({ start: relativePosition, end: relativePosition, quote })
export type NativeAnchor = z.infer<typeof nativeAnchor>
export const reviewAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), anchor: nativeAnchor, text: z.string().trim().max(800),
    replacement: z.string().max(800).optional() }).refine(v => v.replacement === undefined ? !!v.text : v.replacement !== v.anchor.quote),
  z.object({ action: z.literal('reply'), id: identifier, text: quote }),
  z.object({ action: z.literal('decide'), id: identifier, decision: z.enum(['Approved', 'Rejected', 'Resolved', 'Reopened']) }),
  z.object({ action: z.literal('outline'), key: z.string().min(1).max(512), title: z.string().trim().min(1).max(180),
    level: z.number().int().min(1).max(6), hidden: z.boolean() }),
])
export type ReviewChange = z.infer<typeof reviewAction>
export type OutlineCorrection = Extract<z.infer<typeof reviewAction>, { action: 'outline' }>
export type NativeThread = {
  id: string; author: string; createdAt: string; anchor: NativeAnchor; text: string; replacement?: string
  replies: PdfAnnotation['replies']; decision?: { status: 'Approved' | 'Rejected' | 'Resolved'; author: string; at: string }
}
export const reviewRequest = z.object({ requestId: z.uuid(), change: reviewAction })
export const pdfAnnotationAction = z.discriminatedUnion('action', [
  z.object({ action: z.literal('add'), page: z.number().int().positive(), text: z.string().trim().max(800),
    quote: quote.optional(), location: pdfLocation.optional(), displayedDigest: z.string().regex(/^[a-f0-9]{64}$/).optional(), requestId: z.uuid().optional(), replacement: pdfReplacement.optional(), markup: pdfMarkup.optional() }).refine(change => change.text || change.replacement || change.markup, 'Enter an annotation or a replacement.'),
  z.object({ action: z.literal('visibility'), id: identifier, withdrawn: z.boolean() }),
  z.object({ action: z.literal('reply'), id: identifier, text: z.string().trim().min(1).max(800) }),
  z.object({ action: z.literal('decide'), id: identifier, decision: z.enum(['Approved', 'Rejected']) }),
])
export type PdfAnnotationChange = z.input<typeof pdfAnnotationAction>
export type PdfAnnotation = {
  id: string; page: number; text: string; author: string; createdAt: string
  quote?: string
  location?: PdfLocation
  markup?: PdfMarkup
  withdrawn?: boolean
  edit?: PdfTextEdit
  replies: { id: string; text: string; author: string; createdAt: string }[]
  decision?: { status: 'Approved' | 'Rejected'; author: string; at: string }
}
export type ContractView = Summary & {
  revision: number
  sourcePdf?: { name: string; pages: number; digest: string }
  threads?: NativeThread[]
  outline?: OutlineCorrection[]
  negotiatedPdf?: { digest: string }
  annotations?: PdfAnnotation[]
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
