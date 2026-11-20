import { z } from 'zod'

// Content colors are fixed PDF ink values, independent of the surrounding UI theme.
export const nativeTextColors = [
  { name: 'Gray', value: '#5f6368' },
  { name: 'Red', value: '#b91c1c' },
  { name: 'Amber', value: '#92400e' },
  { name: 'Green', value: '#166534' },
  { name: 'Blue', value: '#1d4ed8' },
  { name: 'Purple', value: '#6d28d9' },
] as const
export const nativeColorSchema = z.enum(['#5f6368', '#b91c1c', '#92400e', '#166534', '#1d4ed8', '#6d28d9'])
export const nativeLinkSchema = z.string().refine((value) => {
  try {
    const url = new URL(value)
    return (
      ['https:', 'http:', 'mailto:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !Array.from(value).some((character) => character.charCodeAt(0) <= 32)
    )
  } catch {
    return false
  }
}, 'Enter an absolute http, https or mailto link.')
export const nativeLinkOptions = {
  autolink: false,
  linkOnPaste: false,
  openOnClick: false,
  HTMLAttributes: { target: '_blank', rel: 'noopener noreferrer' },
  isAllowedUri: (url: string) => nativeLinkSchema.safeParse(url).success,
}

export type ResponseSchema<T> = Pick<z.ZodType<T>, 'safeParse'>

export const identifier = z.uuid()
export const emailAddress = z
  .email()
  .max(254)
  .transform((value) => value.toLowerCase())
export const titleInput = z.string().trim().min(1).max(160)
export const createContract = z.object({ title: titleInput, requestId: identifier, workspaceId: identifier.optional() })
export const workspaceSlug = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/)
  .refine((slug) => !['admin', 'app', 'api', 'northwind', 'support'].includes(slug))
export const workspaceDocumentLimit = 1024 * 1024
export const workspaceDocument = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .regex(/\.pdf$/i),
  data: z
    .string()
    .min(1)
    .max(4 * Math.ceil(workspaceDocumentLimit / 3))
    .regex(/^[a-zA-Z0-9+/]+={0,2}$/),
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
  team: z
    .array(emailAddress)
    .min(1)
    .max(39)
    .transform((emails) => [...new Set(emails)]),
})
export const workspaceStatuses = ['Draft', 'Review', 'Negotiation', 'Signature', 'Active', 'Expiring', 'On hold', 'Closed', 'Completed'] as const
export const customizeWorkspace = z
  .object({
    name: titleInput,
    description: z.string().trim().max(500),
    project: workspaceProject,
    status: z.enum(workspaceStatuses),
    assigneeId: z.string().min(1).max(100),
    label: z.string().trim().min(1).max(40),
  })
  .partial()
  .refine((fields) => Object.keys(fields).length > 0, 'Change at least one workspace setting.')
export type Workspace = z.infer<typeof workspaceSchema>
export type WorkspaceParties = z.infer<typeof workspacePartiesSchema>

export const inviteEditor = z.object({ email: emailAddress })
export const redeemInvite = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
export const previewContract = z
  .object({
    revision: z.number().int().nonnegative(),
    signers: z.array(emailAddress).min(1).max(20),
  })
  .refine(({ signers }) => new Set(signers).size === signers.length, 'Enter each signer once.')
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
const relativeIdSchema = z.object({ client: z.number().int().nonnegative().max(0xffffffff), clock: z.number().int().nonnegative() })
export const relativePositionSchema = z
  .object({
    type: relativeIdSchema.nullable().optional(),
    tname: z.string().nullable().optional(),
    item: relativeIdSchema.nullable().optional(),
    assoc: z.number().int().optional(),
  })
  .refine((position) => Boolean(position.type || position.tname || position.item), 'Invalid relative position.')
export const cursorSchema = z.object({ anchor: relativePositionSchema, head: relativePositionSchema }).nullable()
export const clientMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('edit'), id: identifier, update: encoded }),
  z.object({
    type: z.literal('presence'),
    clientId: z.number().int().nonnegative().max(0xffffffff),
    clock: z.number().int().nonnegative().max(0xffffffff),
    cursor: cursorSchema,
  }),
])

export type Status = z.infer<typeof statusSchema>
export type Role = z.infer<typeof roleSchema>
export type ContractParty = z.infer<typeof partySchema>
export type Summary = z.infer<typeof summarySchema>
export const assignContract = z.object({ assigneeId: z.string().min(1).max(100).nullable() })
export type Signature = z.infer<typeof signatureSchema>
const pdfReplacement = z
  .object({
    block: z.number().int().nonnegative(),
    expected: z.string().min(1).max(800),
    replacement: z.string().max(800),
  })
  .refine((edit) => edit.expected !== edit.replacement, 'Enter different replacement text.')
export type PdfTextBlock = z.infer<typeof pdfTextBlockSchema>
export type PdfTextEdit = z.infer<typeof pdfReplacement> & { page: number; offset: number }

export const pdfMarkup = z.object({
  tool: z.enum(['pen', 'brush', 'highlight', 'underline', 'strikethrough']),
  points: z
    .array(z.object({ x: z.number().min(0).max(1), y: z.number().min(0).max(1) }))
    .min(2)
    .max(256),
})
export type PdfMarkup = z.infer<typeof pdfMarkup>

const quote = z.string().min(1).max(800)
const pdfLocation = z.object({ x: z.number().finite(), y: z.number().finite(), offset: z.number().int().nonnegative().max(100_000) })
export type PdfLocation = z.infer<typeof pdfLocation>
const relativePosition = z.base64().min(1).max(256)
const nativeAnchor = z.object({ start: relativePosition, end: relativePosition, quote })
export type NativeAnchor = z.infer<typeof nativeAnchor>
export const reviewAction = z.discriminatedUnion('action', [
  z
    .object({ action: z.literal('add'), anchor: nativeAnchor, text: z.string().trim().max(800), replacement: z.string().max(800).optional() })
    .refine((v) => (v.replacement === undefined ? !!v.text : v.replacement !== v.anchor.quote)),
  z.object({ action: z.literal('reply'), id: identifier, text: quote }),
  z.object({ action: z.literal('decide'), id: identifier, decision: z.enum(['Approved', 'Rejected', 'Resolved', 'Reopened']) }),
  z.object({
    action: z.literal('outline'),
    key: z.string().min(1).max(512),
    title: z.string().trim().min(1).max(180),
    level: z.number().int().min(1).max(6),
    hidden: z.boolean(),
  }),
])
export type ReviewChange = z.infer<typeof reviewAction>
export type OutlineCorrection = Extract<z.infer<typeof reviewAction>, { action: 'outline' }>
export type NativeThread = z.infer<typeof nativeThreadSchema>
export const reviewRequest = z.object({ requestId: z.uuid(), change: reviewAction })
export const pdfAnnotationAction = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('add'),
      page: z.number().int().positive(),
      text: z.string().trim().max(800),
      quote: quote.optional(),
      location: pdfLocation.optional(),
      displayedDigest: z
        .string()
        .regex(/^[a-f0-9]{64}$/)
        .optional(),
      requestId: z.uuid().optional(),
      replacement: pdfReplacement.optional(),
      markup: pdfMarkup.optional(),
    })
    .refine((change) => change.text || change.replacement || change.markup, 'Enter an annotation or a replacement.'),
  z.object({ action: z.literal('visibility'), id: identifier, withdrawn: z.boolean() }),
  z.object({ action: z.literal('reply'), id: identifier, text: z.string().trim().min(1).max(800) }),
  z.object({ action: z.literal('decide'), id: identifier, decision: z.enum(['Approved', 'Rejected']) }),
])
export type PdfAnnotationChange = z.input<typeof pdfAnnotationAction>
export type PdfAnnotation = z.infer<typeof pdfAnnotationSchema>
export type ContractView = z.infer<typeof contractViewSchema>
export type ServerMessage = z.infer<typeof serverMessageSchema>
export type Preview = z.infer<typeof previewSchema>

// Output schemas parse producer data without input normalizers or coercion. Account IDs are
// opaque strings; nullable and omitted legacy metadata remain distinct valid representations.
const outputId = z.string().min(1).max(100)
const outputEmail = z.email().max(254)
const timestamp = z.string().min(1)
const integer = z.number().int().nonnegative()
export const digestSchema = z.string().regex(/^[a-f0-9]{64}$/)
export const partySchema = z.object({ id: outputId, email: outputEmail, name: z.string().max(80).optional() })
export const presenceUserSchema = z.object({ id: outputId, email: outputEmail, name: z.string().min(1).max(254), color: z.string().regex(/^#[a-f0-9]{6}$/) })
export type PresenceUser = z.infer<typeof presenceUserSchema>
// Account identity, rather than a Yjs session ID, keeps colors stable in every tab and workspace.
// Dark channels keep white cursor labels readable; labels also identify people with similar colors.
export function presenceColor(accountId: string): string {
  let hash = 2166136261
  for (const character of accountId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }
  return '#' + [0, 8, 16].map((shift) => (40 + ((hash >>> shift) % 73)).toString(16).padStart(2, '0')).join('')
}
export const participantSchema = presenceUserSchema.extend({
  status: z.union([z.literal('Online'), z.literal('Editing'), z.literal('Away'), z.literal('Offline')]),
  working: z.boolean(),
  documents: z.array(z.object({ id: outputId, title: z.string() })),
})
export type Participant = z.infer<typeof participantSchema>
export const workspaceActivitySchema = z.object({
  type: z.literal('activity'),
  status: z.union([z.literal('Online'), z.literal('Editing'), z.literal('Away')]),
  contractId: identifier.nullable(),
})
export const workspacePresenceSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('participants'), participants: z.array(participantSchema) }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export const statusSchema = z.enum(['Draft', 'Awaiting signatures', 'Signed', 'Voided'])
export const roleSchema = z.enum(['owner', 'editor', 'signer'])
export const workspaceSchema = z.object({
  id: outputId,
  name: z.string(),
  description: z.string(),
  slug: z.string().nullable().optional(),
  role: z.enum(['owner', 'member']).optional(),
  documentName: z.string().nullable().optional(),
  firstContractId: outputId.nullable().optional(),
  project: z.string().nullable().optional(),
  createdAt: integer.optional(),
  updatedAt: integer.optional(),
  status: z.enum(workspaceStatuses).optional(),
  assignee: partySchema.optional(),
  labels: z.array(z.string()).optional(),
})
export const workspacesSchema = z.array(workspaceSchema)
export const workspacePartiesSchema = z.object({
  role: z.enum(['owner', 'member']),
  parties: z.array(partySchema),
  invitations: z.array(outputEmail),
})
export const summarySchema = z.object({
  id: outputId,
  title: z.string(),
  status: statusSchema,
  role: roleSchema,
  workspaceId: outputId.optional(),
  owner: partySchema.optional(),
  assignee: partySchema.optional(),
  team: z.array(partySchema).optional(),
  createdAt: integer.optional(),
  updatedAt: integer.optional(),
  hasSignatures: z.boolean().optional(),
})
export const summariesSchema = z.array(summarySchema)
export const signatureSchema = z.object({
  versionId: outputId,
  digest: digestSchema,
  accountId: outputId,
  email: outputEmail,
  name: z.string(),
  signedAt: timestamp,
  consentVersion: z.literal(consentVersion),
})
export const pdfTextBlockSchema = z.object({
  page: integer,
  block: integer,
  text: z.string(),
  baseline: z.tuple([z.number().finite(), z.number().finite()]),
  font_size: z.number().finite().optional(),
})
export const pdfTextBlocksSchema = z.array(pdfTextBlockSchema)
const replySchema = z.object({ id: outputId, text: z.string(), author: outputEmail, createdAt: timestamp })
const decisionSchema = z.object({ status: z.enum(['Approved', 'Rejected']), author: outputEmail, at: timestamp })
export const pdfAnnotationSchema = z.object({
  id: outputId,
  page: z.number().int().positive(),
  text: z.string(),
  author: outputEmail,
  createdAt: timestamp,
  quote: z.string().optional(),
  location: pdfLocation.optional(),
  markup: pdfMarkup.optional(),
  withdrawn: z.boolean().optional(),
  edit: pdfReplacement.safeExtend({ page: integer, offset: integer }).optional(),
  replies: z.array(replySchema),
  decision: decisionSchema.optional(),
})
export const nativeThreadSchema = z.object({
  id: outputId,
  author: outputEmail,
  createdAt: timestamp,
  anchor: nativeAnchor,
  text: z.string(),
  replacement: z.string().optional(),
  replies: z.array(replySchema),
  decision: z.object({ status: z.enum(['Approved', 'Rejected', 'Resolved']), author: outputEmail, at: timestamp }).optional(),
})
const outlineSchema = z.object({
  action: z.literal('outline'),
  key: z.string(),
  title: z.string(),
  level: z.number().int().min(1).max(6),
  hidden: z.boolean(),
})
export const contractViewSchema = summarySchema.extend({
  revision: integer,
  sourcePdf: z.object({ name: z.string(), pages: z.number().int().positive(), digest: digestSchema }).optional(),
  threads: z.array(nativeThreadSchema).optional(),
  outline: z.array(outlineSchema).optional(),
  negotiatedPdf: z.object({ digest: digestSchema }).optional(),
  annotations: z.array(pdfAnnotationSchema).optional(),
  editors: z.array(partySchema),
  invites: z.array(partySchema),
  version: z
    .object({
      id: outputId,
      digest: digestSchema,
      canSign: z.boolean(),
      signers: z.array(z.object({ email: outputEmail, signedAt: timestamp.nullable() })),
    })
    .nullable(),
})
export const serverMessageSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('state'), contract: contractViewSchema, draft: z.base64().optional(), self: presenceUserSchema.optional() }),
  z.object({ type: z.literal('edit'), id: outputId, revision: integer, update: z.base64() }),
  z.object({ type: z.literal('ack'), id: outputId, revision: integer }),
  z.object({
    type: z.literal('presence'),
    clientId: z.number().int().nonnegative().max(0xffffffff),
    clock: z.number().int().nonnegative().max(0xffffffff),
    state: z.object({ user: presenceUserSchema.extend({ id: outputId.optional() }), cursor: cursorSchema.optional() }).nullable(),
  }),
  z.object({ type: z.literal('error'), message: z.string() }),
])
export const previewSchema = z.object({ id: outputId, digest: digestSchema })
export const workspaceAccessSchema = z.object({ workspaceId: outputId.optional(), canManage: z.boolean(), canViewParticipants: z.boolean().optional() })
export const invitationAckSchema = z.object({ email: outputEmail })
export const emptySchema = z.undefined()
export const errorResponseSchema = z.object({ error: z.string().min(1).max(1000) })

export const ValidationError = z.ZodError
