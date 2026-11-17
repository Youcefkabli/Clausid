import { DurableObject } from 'cloudflare:workers'
import * as Y from 'yjs'
import { strToU8, zipSync } from 'fflate'
import {
  clientMessage, consentText, consentVersion, freezeContract, inviteEditor, pdfAnnotationAction, previewContract,
  redeemInvite, signContract, titleInput,
} from '@clausid/contracts'
import type { ContractView, PdfAnnotation, PdfTextBlock, Role, ServerMessage, Signature, Status } from '@clausid/contracts'
import type { Account, Env } from './http.ts'
import { artifact, decode, encode, hex, HttpError, internal, readJson, safeResponse, sha256 } from './http.ts'
import { validateDraft } from './draft.ts'
import { renderPdf } from './pdf.ts'
import { inspectPdf, planPdfEdit, rewritePdf } from './pdf-rewrite.ts'

type Member = { id: string; email: string }
type Invite = { id: string; digest: string; email: string; expires: number; role: 'editor' | 'signer' }
type Preview = { id: string; revision: number; signers: string[]; digest: string; expires: number }
type Version = { id: string; digest: string; signers: string[]; frozenAt: string }
type Mail = { id: string; email: string; token: string; role: Invite['role'] }
type RecordState = {
  id: string; title: string; owner: Member; editors: Member[]; signers: Member[]
  deletion?: { accounts?: string[] }
  status: Status; revision: number; invites: Invite[]; preview: Preview | null
  sourcePdf?: NonNullable<ContractView['sourcePdf']> & { digest: string }; annotations?: PdfAnnotation[]
  negotiatedPdf?: { digest: string }
  version: Version | null; signatures: Signature[]; outbox: Mail[]; voidedAt?: string
}
type Attachment = { account: Account; clientId?: number; clock?: number; cursor?: unknown }
const absent = () => new HttpError(404, 'Contract unavailable.')
const day = 86_400_000

export class Contract extends DurableObject<Env> {
  #state: RecordState | undefined
  #draft = new Y.Doc()
  #textBlocks?: PdfTextBlock[]
  #queue: Promise<unknown> = Promise.resolve()

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS state (id TEXT PRIMARY KEY, value TEXT NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS files (id TEXT PRIMARY KEY, data BLOB NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS edits (id TEXT PRIMARY KEY, revision INTEGER NOT NULL)')
    const record = ctx.storage.sql.exec<{ value: string }>("SELECT value FROM state WHERE id = 'contract'").toArray()[0]
    this.#state = record ? JSON.parse(record.value) : undefined
    const draft = this.#file('draft')
    if (draft) Y.applyUpdate(this.#draft, draft)
  }

  #serial<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#queue.then(operation)
    this.#queue = result.catch(() => undefined)
    return result
  }
  #file(id: string) {
    const row = this.ctx.storage.sql.exec<{ data: ArrayBuffer }>('SELECT data FROM files WHERE id = ?', id).toArray()[0]
    return row ? new Uint8Array(new Uint8Array(row.data)) : undefined
  }
  #getSourcePdf() {
    const bytes = this.#file('source')
    if (!bytes) throw absent()
    return bytes
  }
  #getTextBlocks() {
    return this.#textBlocks ??= inspectPdf(this.#getSourcePdf())
  }
  #writeFile(id: string, bytes: Uint8Array) {
    this.ctx.storage.sql.exec('INSERT OR REPLACE INTO files VALUES (?, ?)', id, bytes)
  }
  #save(state: RecordState, files?: () => void) {
    this.ctx.storage.transactionSync(() => {
      this.ctx.storage.sql.exec("INSERT OR REPLACE INTO state VALUES ('contract', ?)", JSON.stringify(state))
      files?.()
    })
    this.#state = state
  }
  #role(state: RecordState, actor: Account): Role | undefined {
    if (state.deletion) return
    if (actor.id === state.owner.id) return 'owner'
    if ((state.status === 'Draft' || state.sourcePdf) && state.editors.some((member) => member.id === actor.id)) return 'editor'
    if (state.signers.some((member) => member.id === actor.id && member.email === actor.email)) return 'signer'
  }
  #view(state: RecordState, account: Account): ContractView {
    const role = this.#role(state, account)
    if (!role) throw absent()
    return {
      hasSignatures: state.signatures.length > 0 || state.status === 'Signed',
      id: state.id, title: state.title, status: state.status, revision: state.revision, role,
      sourcePdf: state.sourcePdf && { name: state.sourcePdf.name, pages: state.sourcePdf.pages },
      negotiatedPdf: state.negotiatedPdf,
      annotations: role === 'signer' ? undefined : state.annotations,
      editors: role === 'signer' ? [] : [state.owner, ...state.editors],
      invites: role === 'owner' && state.status === 'Draft'
        ? state.invites.filter(({ expires }) => expires > Date.now()).map(({ id, email }) => ({ id, email }))
        : [],
      version: state.version && {
        id: state.version.id, digest: state.version.digest,
        canSign: state.status === 'Awaiting signatures' && state.version.signers.includes(account.email)
          && (role === 'owner' || state.signers.some(member => member.id === account.id && member.email === account.email))
          && !state.signatures.some(({ email }) => email === account.email),
        signers: state.version.signers.map((email) => ({
          email, signedAt: state.signatures.find((entry) => entry.email === email)?.signedAt ?? null,
        })),
      },
    }
  }
  #send(socket: WebSocket, message: ServerMessage) {
    try { socket.send(JSON.stringify(message)) } catch { /* A closing socket reconnects from persisted state. */ }
  }
  #publish(state: RecordState) {
    for (const socket of this.ctx.getWebSockets()) {
      const { account } = socket.deserializeAttachment() as Attachment
      if (!this.#role(state, account)) socket.close(4003, 'Access ended')
      else if (account.expires <= Date.now()) socket.close(4012, 'Refresh session')
      else this.#send(socket, { type: 'state', contract: this.#view(state, account) })
    }
  }
  #presence(attachment: Attachment, gone = false): ServerMessage | undefined {
    if (attachment.clientId === undefined || attachment.clock === undefined) return
    const colors = ['#1d6494', '#9b3e62', '#47661f', '#7c4b99', '#9b501b']
    return {
      type: 'presence', clientId: attachment.clientId, clock: attachment.clock + Number(gone),
      state: gone ? null : {
        user: { name: attachment.account.name.slice(0, 80), color: colors[attachment.clientId % colors.length] },
        cursor: attachment.cursor,
      },
    }
  }
  #broadcast(message: ServerMessage, sender: WebSocket) {
    for (const socket of this.ctx.getWebSockets()) {
      if (socket === sender) continue
      const { account } = socket.deserializeAttachment() as Attachment
      if (account.expires > Date.now() && this.#state?.status === 'Draft' && this.#role(this.#state, account)) {
        this.#send(socket, message)
      }
    }
  }

  fetch(request: Request) {
    return this.#serial(() => safeResponse(() => this.#route(request)))
  }

  async #finishDeletion(state: RecordState) {
    const pending = state.deletion
    if (!pending?.accounts?.length) return
    await this.ctx.storage.setAlarm(Date.now() + 60_000)
    try {
      const responses = await Promise.all(pending.accounts.map(id =>
        this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(id))
          .fetch('https://directory/' + state.id, { method: 'DELETE' })))
      if (responses.some(response => !response.ok)) throw new Error('Directory cleanup failed')
      this.#save({ ...state, deletion: {} })
    } catch {
      console.error('Contract directory cleanup will retry')
    }
  }

  async #route(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url)
    const account: Account = JSON.parse(decodeURIComponent(request.headers.get('x-clausid-account')!))
    const contractId = request.headers.get('x-clausid-contract')!
    const action = pathname.slice(1)
    let state = this.#state
    if (action === 'delete') {
      if (!state) throw absent()
      if (state.owner.id !== account.id) throw new HttpError(403, 'Only the contract owner can delete this contract.')
      if (state.signatures.length || state.status === 'Signed') {
        throw new HttpError(409, 'A contract with a recorded signature cannot be deleted.')
      }
      if (!state.deletion) {
        const accounts = [...new Set([state.owner, ...state.editors, ...state.signers].map(({ id }) => id))]
        await this.ctx.storage.setAlarm(Date.now() + 60_000)
        state = {
          id: state.id, title: '', owner: state.owner, editors: [], signers: [], status: state.status,
          revision: state.revision, invites: [], preview: null, version: null, signatures: [], outbox: [],
          deletion: { accounts },
        }
        this.#save(state, () => {
          this.ctx.storage.sql.exec('DELETE FROM files')
          this.ctx.storage.sql.exec('DELETE FROM edits')
        })
        this.#draft.destroy()
        this.#draft = new Y.Doc()
        this.#textBlocks = undefined
        this.#publish(state)
      }
      await this.#finishDeletion(state)
      return new Response(null, { status: 204 })
    }
    if (state?.deletion) {
      if (state.owner.id === account.id && ['create', 'create-pdf', 'create-copy'].includes(action)) {
        throw new HttpError(410, 'This contract was deleted.')
      }
      throw absent()
    }
    if (action === 'create-pdf') {
      const { title, name, pages } = JSON.parse(decodeURIComponent(request.headers.get('x-clausid-pdf')!)) as
        { title: string; name: string; pages: number }
      const bytes = new Uint8Array(await request.arrayBuffer())
      const digest = await sha256(bytes)
      if (state) {
        if (state.owner.id !== account.id) throw absent()
        if (state.sourcePdf?.digest !== digest || state.sourcePdf.name !== name) {
          throw new HttpError(409, 'Retry with the original PDF selected for this workspace.')
        }
        return Response.json(this.#view(state, account))
      }
      const owner = { id: account.id, email: account.email }
      state = { id: contractId, title, owner, status: 'Draft', editors: [], signers: [],
        sourcePdf: { name, pages, digest }, annotations: [], revision: 0, invites: [],
        preview: null, version: null, signatures: [], outbox: [] }
      this.#save(state, () => this.#writeFile('source', bytes))
      return Response.json(this.#view(state, account), { status: 201 })
    }
    if (action === 'create' || action === 'create-copy') {
      if (state) {
        if (state.owner.id !== account.id) throw absent()
        return Response.json(this.#view(state, account))
      }
      const body = await readJson(request, action === 'create-copy' ? 750_000 : 16_384) as { title?: unknown; draft?: string }
      const title = titleInput.parse(body.title)
      const owner = { id: account.id, email: account.email }
      state = { id: contractId, title, owner, status: 'Draft', editors: [], signers: [],
        revision: 0, invites: [], preview: null, version: null, signatures: [], outbox: [] }
      if (action === 'create-copy' && body.draft) Y.applyUpdate(this.#draft, decode(body.draft))
      else this.#draft.getXmlFragment('default').insert(0, [new Y.XmlElement('paragraph')])
      this.#save(state, () => this.#writeFile('draft', Y.encodeStateAsUpdate(this.#draft)))
      return Response.json(this.#view(state, account), { status: 201 })
    }
    if (!state) throw absent()
    if (action === 'redeem') {
      const { token } = redeemInvite.parse(await readJson(request))
      const digest = await sha256(new TextEncoder().encode(token))
      const invite = state.invites.find((item) => item.digest === digest && item.email === account.email && item.expires > Date.now())
      if (!invite || state.status !== (invite.role === 'editor' ? 'Draft' : 'Awaiting signatures')) {
        throw new HttpError(404, 'This invitation is unavailable for your verified email.')
      }
      const directory = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(account.id))
      const registered = await directory.fetch('https://directory/' + state.id, { method: 'PUT' })
      if (!registered.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
      const members = invite.role === 'editor' ? 'editors' : 'signers'
      const member = { id: account.id, email: account.email }
      this.#save({ ...state, [members]: [...state[members].filter(({ id }) => id !== account.id), member],
        invites: state.invites.filter(({ id }) => id !== invite.id),
        outbox: state.outbox.filter(({ id }) => id !== invite.id) })
      this.#publish(this.#state!)
      return Response.json(this.#view(this.#state!, account))
    }

    const view = this.#view(state, account)
    if (action === 'view') return Response.json(view)
    if ((action === 'source-pdf' || action === 'source-download') && state.sourcePdf) {
      const bytes = this.#file('source')
      if (!bytes) throw absent()
      return artifact(bytes, 'application/pdf', 'original-contract.pdf', action === 'source-download')
    }
    if (action.startsWith('negotiated-pdf/')) {
      if (action.slice('negotiated-pdf/'.length) !== state.negotiatedPdf?.digest) throw absent()
      const bytes = this.#file('negotiated')
      if (!bytes) throw absent()
      return artifact(bytes, 'application/pdf', 'negotiated-contract.pdf', false)
    }
    if (action === 'text-blocks') {
      if (!state.sourcePdf || state.status !== 'Draft' || view.role === 'signer') throw absent()
      const page = Number(new URL(request.url).searchParams.get('page'))
      if (!Number.isInteger(page) || page < 1 || page > state.sourcePdf.pages) {
        throw new HttpError(422, 'Choose a page in this PDF.')
      }
      return Response.json(this.#getTextBlocks().filter(block => block.page === page - 1))
    }
    if (action === 'annotation') {
      if (!state.sourcePdf || view.role === 'signer') throw absent()
      if (state.status !== 'Draft') throw new HttpError(409, 'This contract is no longer a draft.')
      const change = pdfAnnotationAction.parse(await readJson(request))
      const annotations = state.annotations ?? []
      const createdAt = new Date().toISOString()
      let next: PdfAnnotation[]
      let negotiated: Uint8Array | undefined
      if (change.action === 'add') {
        if (change.page > state.sourcePdf.pages) throw new HttpError(422, 'Choose a page in this PDF.')
        if (annotations.length >= 60) throw new HttpError(422, 'This contract has reached its annotation limit.')
        const annotation: PdfAnnotation = {
          id: crypto.randomUUID(), page: change.page, text: change.text, author: account.email, createdAt, replies: [],
        }
        if (change.replacement) {
          const page = change.page - 1
          const { block, expected, replacement } = change.replacement
          const line = this.#getTextBlocks().find(item => item.page === page && item.block === block)?.text
          const at = line?.indexOf(expected) ?? -1
          if (line === undefined || at < 0) throw new HttpError(422, 'The selected line must contain the exact text to replace.')
          if (line.indexOf(expected, at + 1) >= 0) throw new HttpError(422, 'Choose a longer text range that appears once on the selected line.')
          annotation.edit = { page, block, offset: Array.from(line.slice(0, at)).length, expected, replacement }
          planPdfEdit(this.#getSourcePdf(), annotation.id, annotation.edit)
        }
        next = [...annotations, annotation]
      } else {
        const annotation = annotations.find(item => item.id === change.id)
        if (!annotation || annotation.decision) throw new HttpError(409, 'This annotation is no longer open.')
        let updated: PdfAnnotation
        if (change.action === 'reply') {
          if (annotations.reduce((total, item) => total + item.replies.length, 0) >= 120) {
            throw new HttpError(422, 'This contract has reached its reply limit.')
          }
          updated = { ...annotation, replies: [...annotation.replies, { id: crypto.randomUUID(),
            text: change.text, author: account.email, createdAt }] }
        } else {
          if (view.role !== 'owner') throw new HttpError(403, 'Only the contract owner can decide annotations.')
          updated = { ...annotation, decision: { status: change.decision, author: account.email, at: createdAt } }
        }
        next = annotations.map(item => item.id === updated.id ? updated : item)
        if (change.action === 'decide' && change.decision === 'Approved' && updated.edit) {
          negotiated = rewritePdf(this.#getSourcePdf(), next.flatMap(item =>
            item.decision?.status === 'Approved' && item.edit ? [{ id: item.id, edit: item.edit }] : []))
          if (negotiated.length > 1_900_000) throw new HttpError(422, 'The negotiated PDF is too large to store.')
        }
      }
      const negotiatedPdf = negotiated ? { digest: await sha256(negotiated) } : state.negotiatedPdf
      this.#save({ ...state, annotations: next, negotiatedPdf, revision: state.revision + 1, preview: null }, () => {
        if (negotiated) this.#writeFile('negotiated', negotiated)
        this.ctx.storage.sql.exec("DELETE FROM files WHERE id = 'preview'")
      })
      this.#publish(this.#state!)
      return Response.json(this.#view(this.#state!, account))
    }
    if (action === 'socket') {
      if (request.headers.get('Upgrade')?.toLowerCase() !== 'websocket') throw new HttpError(426, 'WebSocket required.')
      const pair = new WebSocketPair()
      const [client, socket] = Object.values(pair)
      this.ctx.acceptWebSocket(socket)
      socket.serializeAttachment({ account } satisfies Attachment)
      this.#send(socket, { type: 'state', contract: view,
        draft: state.status === 'Draft' && !state.sourcePdf ? encode(Y.encodeStateAsUpdate(this.#draft)) : undefined })
      if (state.status === 'Draft') {
        for (const other of this.ctx.getWebSockets()) {
          if (other === socket) continue
          const attachment = other.deserializeAttachment() as Attachment
          if (attachment.account.expires <= Date.now() || !this.#role(state, attachment.account)) continue
          const presence = this.#presence(attachment)
          if (presence) this.#send(socket, presence)
        }
      }
      await this.#schedule()
      return new Response(null, { status: 101, webSocket: client })
    }
    if (action === 'pdf' && state.version) {
      return artifact(this.#file('frozen')!, 'application/pdf', 'contract.pdf', false)
    }
    if (action === 'evidence' && state.status === 'Signed' && state.version) {
      const manifest = {
        contractId: state.id, title: state.title, versionId: state.version.id, sha256: state.version.digest,
        frozenAt: state.version.frozenAt, requiredSigners: state.version.signers,
        consent: { version: consentVersion, text: consentText }, signatures: state.signatures,
      }
      return artifact(new Uint8Array(zipSync({
        'contract.pdf': this.#file('frozen')!,
        'signing-evidence.json': strToU8(JSON.stringify(manifest, null, 2)),
      })), 'application/zip', 'clausid-signing-evidence.zip', true)
    }
    if (action === 'sign') {
      const body = signContract.parse(await readJson(request))
      if (!state.version || body.versionId !== state.version.id || body.digest !== state.version.digest) {
        throw new HttpError(409, 'Refresh and review the frozen version.')
      }
      const previous = state.signatures.find(({ email }) => email === account.email)
      if (previous?.accountId === account.id && previous.name === body.name) return Response.json(view)
      if (!view.version?.canSign) throw new HttpError(409, 'This signature is unavailable.')
      if (Date.now() - account.createdAt > 10 * 60_000) throw new HttpError(428, 'Sign out and sign back in before signing.')
      const signature: Signature = {
        accountId: account.id, email: account.email, name: body.name, versionId: body.versionId,
        digest: body.digest, signedAt: new Date().toISOString(), consentVersion,
      }
      const signatures = [...state.signatures, signature]
      this.#save({ ...state, signatures, status: signatures.length === state.version.signers.length ? 'Signed' : state.status })
      this.#publish(this.#state!)
      return Response.json(this.#view(this.#state!, account))
    }
    if (view.role !== 'owner') throw absent()
    if (action === 'copy-pdf' && state.status === 'Voided' && state.sourcePdf) {
      const source = this.#file('source')
      if (!source) throw absent()
      return new Response(source.slice().buffer, { headers: {
        'Content-Type': 'application/pdf',
        'x-clausid-pdf': encodeURIComponent(JSON.stringify({ name: state.sourcePdf.name, pages: state.sourcePdf.pages })),
      } })
    }
    if (action === 'copy-source' && state.status === 'Voided') {
      return Response.json({ title: state.title, pdf: Boolean(state.sourcePdf), draft: encode(Y.encodeStateAsUpdate(this.#draft)) })
    }
    if (action === 'void' && state.status === 'Awaiting signatures') {
      this.#save({ ...state, status: 'Voided', invites: [], outbox: [], voidedAt: new Date().toISOString() })
      this.#publish(this.#state!)
      return Response.json(this.#view(this.#state!, account))
    }
    if (state.status !== 'Draft') throw new HttpError(409, 'This contract is no longer a draft.')
    if (action === 'share-workspace') {
      const { workspaceId, members } = await readJson(request) as {
        workspaceId: string; members: Member[];
      }
      const additions = members.filter(({ id }) => id !== account.id && !state.editors.some((editor) => editor.id === id))
      if (members.every(({ id }) => id === account.id)) throw new HttpError(409, 'Invite a party to the workspace first.')
      const invites = state.invites.filter(({ email, expires }) => expires > Date.now()
        && !additions.some((member) => member.email === email))
      if (state.editors.length + additions.length + invites.length > 40) {
        throw new HttpError(409, 'The collaborator limit is 40.')
      }
      for (const member of members.filter(({ id }) => id !== account.id)) {
        const target = this.env.DIRECTORY.get(this.env.DIRECTORY.idFromName(member.id))
        const register = new URL('https://directory/' + state.id)
        register.searchParams.set('workspace', workspaceId)
        register.searchParams.set('attach', '1')
        const result = await target.fetch(register, { method: 'PUT' })
        if (!result.ok) throw new HttpError(503, 'A party’s contract directory is temporarily unavailable.')
      }
      this.#save({ ...state, editors: [...state.editors, ...additions], invites,
        outbox: state.outbox.filter(({ email }) => !additions.some((member) => member.email === email)) })
      this.#publish(this.#state!)
      return Response.json(this.#view(this.#state!, account))
    }
    if (action === 'invite') {
      const { email } = inviteEditor.parse(await readJson(request))
      if ([state.owner, ...state.editors].some((member) => member.email === email)) {
        throw new HttpError(409, 'This person already has access.')
      }
      const invites = state.invites.filter((item) => item.email !== email && item.expires > Date.now())
      if (invites.length + state.editors.length >= 40) throw new HttpError(409, 'The collaborator limit is 40.')
      const { invite, mail } = await this.#makeInvite(email, 'editor')
      await this.ctx.storage.setAlarm(Date.now() + 100)
      this.#save({ ...state, invites: [...invites, invite],
        outbox: [...state.outbox.filter((item) => item.email !== email), mail] })
    } else if (action.startsWith('revoke/')) {
      const id = action.slice('revoke/'.length)
      this.#save({ ...state, editors: state.editors.filter((item) => item.id !== id),
        invites: state.invites.filter((item) => item.id !== id), outbox: state.outbox.filter((item) => item.id !== id) })
    } else if (action === 'preview') {
      const { revision, signers } = previewContract.parse(await readJson(request))
      if (revision !== state.revision) throw new HttpError(409, 'The draft changed. Review the latest version.')
      if (state.annotations?.some(annotation => !annotation.decision)) {
        throw new HttpError(409, 'Resolve all PDF annotations before preparing for signature.')
      }
      const bytes = state.negotiatedPdf ? this.#file('negotiated')
        : state.sourcePdf ? this.#getSourcePdf() : await renderPdf(state.title, this.#draft)
      if (!bytes) throw absent()
      const preview = { id: crypto.randomUUID(), revision, signers, digest: await sha256(bytes), expires: Date.now() + 15 * 60_000 }
      this.#save({ ...state, preview }, () => this.#writeFile('preview', bytes))
      return Response.json({ id: preview.id, digest: preview.digest })
    } else if (action.startsWith('preview/')) {
      if (state.preview?.id !== action.slice('preview/'.length) || state.preview.expires <= Date.now()
        || state.preview.revision !== state.revision) throw new HttpError(409, 'Generate a new preview.')
      return artifact(this.#file('preview')!, 'application/pdf', 'contract-preview.pdf', false)
    } else if (action === 'freeze') {
      const { previewId } = freezeContract.parse(await readJson(request))
      const preview = state.preview
      if (!preview || preview.id !== previewId || preview.revision !== state.revision || preview.expires <= Date.now()) {
        throw new HttpError(409, 'The draft or preview changed. Generate and review a new preview.')
      }
      const bytes = this.#file('preview')!
      const recipients = await Promise.all(preview.signers.filter((email) => email !== state.owner.email)
        .map((email) => this.#makeInvite(email, 'signer')))
      if (recipients.length) await this.ctx.storage.setAlarm(Date.now() + 100)
      const version = { id: previewId, digest: preview.digest, signers: preview.signers, frozenAt: new Date().toISOString() }
      this.#save({ ...state, preview: null, version, status: 'Awaiting signatures',
        invites: recipients.map(({ invite }) => invite), outbox: recipients.map(({ mail }) => mail) }, () => {
        this.#writeFile('frozen', bytes)
        this.ctx.storage.sql.exec("DELETE FROM files WHERE id = 'preview'")
      })
    } else {
      throw absent()
    }
    this.#publish(this.#state!)
    return Response.json(this.#view(this.#state!, account))
  }

  async #makeInvite(email: string, role: Invite['role']) {
    const token = hex(crypto.getRandomValues(new Uint8Array(32)))
    const id = crypto.randomUUID()
    const expires = Date.now() + 7 * day
    const digest = await sha256(new TextEncoder().encode(token))
    return { invite: { id, email, digest, expires, role }, mail: { id, email, token, role } }
  }
  async #schedule() {
    const now = Date.now()
    const wake = this.#state?.outbox.length ? now + 60_000 : Infinity
    const expiryCheck = this.ctx.getWebSockets().length ? now + 30_000 : Infinity
    const next = Math.min(wake, expiryCheck)
    const existing = await this.ctx.storage.getAlarm()
    if (Number.isFinite(next) && (existing === null || existing > next)) await this.ctx.storage.setAlarm(next)
  }
  alarm() {
    return this.#serial(async () => {
      if (this.#state?.deletion) {
        await this.#finishDeletion(this.#state)
        return
      }
      for (const socket of this.ctx.getWebSockets()) {
        const { account } = socket.deserializeAttachment() as Attachment
        if (account.expires <= Date.now()) socket.close(4012, 'Refresh session')
      }
      let state = this.#state
      for (const mail of state?.outbox ?? []) {
        if (!state) break
        const invite = state.invites.find(({ id }) => id === mail.id)
        if (invite && invite.expires > Date.now()) {
          try {
            const response = await internal(this.env, '/internal/invite', {
              method: 'POST', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ ...mail, contractId: state.id }),
            })
            if (!response.ok) throw new Error('Mail rejected')
          } catch {
            console.error('Contract invitation delivery failed')
            continue
          }
        }
        state = { ...state, outbox: state.outbox.filter(({ id }) => id !== mail.id) }
        this.#save(state)
      }
      await this.#schedule()
    })
  }
  webSocketMessage(socket: WebSocket, message: string | ArrayBuffer) {
    return this.#serial(async () => {
      const attachment = socket.deserializeAttachment() as Attachment
      const state = this.#state
      if (!state || !this.#role(state, attachment.account)) {
        socket.close(4003, 'Access ended')
        return
      }
      if (attachment.account.expires <= Date.now()) {
        socket.close(4012, 'Refresh session')
        return
      }
      if (state.status !== 'Draft' || typeof message !== 'string' || message.length > 360_000) {
        this.#send(socket, { type: 'error', message: 'The draft is unavailable or the update is too large.' })
        return
      }
      try {
        const incoming = clientMessage.parse(JSON.parse(message))
        if (incoming.type === 'presence') {
          if ((attachment.clientId !== undefined && attachment.clientId !== incoming.clientId)
            || (attachment.clock ?? -1) >= incoming.clock
            || JSON.stringify(incoming.cursor).length > 1_200) return
          if (this.ctx.getWebSockets().some((other) => other !== socket
            && (other.deserializeAttachment() as Attachment).clientId === incoming.clientId)) return
          Object.assign(attachment, { clientId: incoming.clientId, clock: incoming.clock, cursor: incoming.cursor })
          socket.serializeAttachment(attachment)
          this.#broadcast(this.#presence(attachment)!, socket)
          return
        }
        if (state.sourcePdf) throw new HttpError(409, 'Use PDF annotations to propose changes.')
        const previous = this.ctx.storage.sql.exec<{ revision: number }>(
          'SELECT revision FROM edits WHERE id = ?', incoming.id).toArray()[0]
        if (previous) {
          this.#send(socket, { type: 'ack', id: incoming.id, revision: state.revision })
          return
        }
        const draft = new Y.Doc()
        try {
          Y.applyUpdate(draft, Y.encodeStateAsUpdate(this.#draft))
          Y.applyUpdate(draft, decode(incoming.update))
          const bytes = Y.encodeStateAsUpdate(draft)
          if (bytes.length > 524_288 || draft.store.pendingStructs || draft.store.pendingDs) {
            throw new HttpError(422, 'The draft reached its size limit or the update is incomplete.')
          }
          validateDraft(draft)
          const revision = state.revision + 1
          this.#save({ ...state, revision, preview: null }, () => {
            this.#writeFile('draft', bytes)
            this.ctx.storage.sql.exec('INSERT INTO edits VALUES (?, ?)', incoming.id, revision)
            this.ctx.storage.sql.exec("DELETE FROM files WHERE id = 'preview'")
          })
          Y.applyUpdate(this.#draft, bytes)
          this.#send(socket, { type: 'ack', id: incoming.id, revision })
          this.#broadcast({ type: 'edit', id: incoming.id, revision, update: incoming.update }, socket)
        } finally { draft.destroy() }
      } catch (error) {
        this.#send(socket, { type: 'error', message: error instanceof HttpError ? error.message : 'The draft update could not be saved.' })
      }
    })
  }
  webSocketClose(socket: WebSocket) {
    const presence = this.#presence(socket.deserializeAttachment() as Attachment, true)
    if (presence) this.#broadcast(presence, socket)
  }
  webSocketError(socket: WebSocket) { this.webSocketClose(socket) }
}
