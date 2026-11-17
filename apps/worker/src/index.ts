import { DurableObject } from 'cloudflare:workers'
import { PDFDocument } from 'pdf-lib'
import { createContract, createWorkspace, identifier, redeemInvite, workspaceDocument, workspaceDocumentLimit } from '@clausid/contracts'
import type { ContractView, Summary, Workspace, WorkspaceParties } from '@clausid/contracts'
import { workspaceSharing } from './workspace-sharing.ts'
import { Contract } from './contract.ts'
import { inspectPdf } from './pdf-rewrite.ts'
import { decode, HttpError, internal, readJson, safeResponse } from './http.ts'
import type { Account, Env } from './http.ts'

type WorkspaceRow = Pick<Workspace, 'id' | 'name' | 'description' | 'slug' | 'project' | 'createdAt'>

const workspaceSelect = 'SELECT workspaces.id, name, description, slug, project, created AS createdAt FROM workspaces LEFT JOIN workspace_slugs USING (id) LEFT JOIN workspace_projects USING (id)'
const workspaceDocumentRequestLimit = 4 * Math.ceil(workspaceDocumentLimit / 3) + 16_384
const workspaceReady = 'NOT EXISTS (SELECT 1 FROM workspace_requests WHERE workspace_id = workspaces.id AND ready = 0)'

export { Contract }
export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, created INTEGER NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_access (id TEXT PRIMARY KEY, workspace TEXT NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, name TEXT NOT NULL, description TEXT NOT NULL, created INTEGER NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_slugs (id TEXT PRIMARY KEY, slug TEXT NOT NULL UNIQUE)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_projects (id TEXT PRIMARY KEY, project TEXT NOT NULL)')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_requests (request_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL UNIQUE, ready INTEGER NOT NULL CHECK (ready IN (0, 1)))')
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS workspace_contracts (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL)')
  }
  fetch(request: Request) {
    return safeResponse(async () => {
      const path = new URL(request.url).pathname
      const sql = this.ctx.storage.sql
      if (path.startsWith('/sharing/')) return workspaceSharing(this.ctx, this.env, request)
      if (path === '/workspace-access' && request.method === 'POST') {
        const workspace = await readJson(request) as Workspace
        sql.exec('INSERT OR REPLACE INTO workspace_access VALUES (?, ?)', workspace.id, JSON.stringify(workspace))
        return new Response(null, { status: 204 })
      }
      if (path.startsWith('/workspace-ready/') && request.method === 'POST') {
        const id = identifier.parse(path.slice('/workspace-ready/'.length))
        sql.exec('UPDATE workspace_requests SET ready = 1 WHERE workspace_id = ?', id)
        return new Response(null, { status: 204 })
      }
      if (path.startsWith('/workspace-delete/') && request.method === 'POST') {
        const id = identifier.parse(path.slice('/workspace-delete/'.length))
        this.ctx.storage.transactionSync(() => {
          if (sql.exec('SELECT id FROM workspace_contracts WHERE workspace_id = ? LIMIT 1', id).toArray().length) {
            throw new HttpError(409, 'Only empty, unshared workspaces can be deleted.')
          }
          sql.exec('INSERT OR IGNORE INTO workspace_requests SELECT id, id, 1 FROM workspaces WHERE id = ?', id)
          sql.exec('DELETE FROM workspace_slugs WHERE id = ?', id)
          sql.exec('DELETE FROM workspace_projects WHERE id = ?', id)
          sql.exec('DELETE FROM workspaces WHERE id = ?', id)
        })
        return new Response(null, { status: 204 })
      }
      if (path.startsWith('/workspaces/')) {
        const id = identifier.parse(path.slice('/workspaces/'.length))
        const owned = sql.exec<WorkspaceRow>(
          workspaceSelect + ' WHERE workspaces.id = ? AND ' + workspaceReady, id,
        ).toArray()[0]
        if (owned) return Response.json({...owned, role: 'owner'})
        const access = sql.exec<{ workspace: string }>('SELECT workspace FROM workspace_access WHERE id = ?', id).toArray()[0]
        if (access) return Response.json(JSON.parse(access.workspace))
        throw new HttpError(404, 'Workspace unavailable.')
      }
      if (path.startsWith('/workspace-contract/')) {
        const id = identifier.parse(path.slice('/workspace-contract/'.length))
        const entry = sql.exec<{ workspaceId: string }>(
          'SELECT workspace_id AS workspaceId FROM workspace_contracts WHERE id = ?', id).toArray()[0]
        return Response.json(entry ?? null)
      }
      if (path === '/workspaces') {
        if (request.method === 'POST') {
          const { requestId, name, description, slug, project } = createWorkspace.parse(await readJson(request))
          const item = this.ctx.storage.transactionSync(() => {
            const mapping = sql.exec<{ workspace_id: string; ready: number }>(
              'SELECT workspace_id, ready FROM workspace_requests WHERE request_id = ?', requestId,
            ).toArray()[0]
            if (mapping) {
              const workspace = sql.exec<WorkspaceRow>(workspaceSelect + ' WHERE workspaces.id = ?', mapping.workspace_id).toArray()[0]
              if (!workspace) throw new HttpError(409, 'This request was already used for a deleted workspace.')
              return { workspace, pending: mapping.ready === 0 }
            }
            const legacy = sql.exec<WorkspaceRow>(workspaceSelect + ' WHERE workspaces.id = ? AND NOT EXISTS '
              + '(SELECT 1 FROM workspace_requests WHERE workspace_id = workspaces.id)', requestId).toArray()[0]
            if (legacy) return { workspace: legacy, pending: false }
            if (slug && sql.exec('SELECT id FROM workspace_slugs WHERE slug = ?', slug).toArray().length) {
              throw new HttpError(409, 'That workspace URL is already taken.')
            }
            const id = crypto.randomUUID()
            const createdAt = Date.now()
            sql.exec('INSERT INTO workspaces VALUES (?, ?, ?, ?)', id, name, description, createdAt)
            if (slug) sql.exec('INSERT INTO workspace_slugs VALUES (?, ?)', id, slug)
            if (project) sql.exec('INSERT INTO workspace_projects VALUES (?, ?)', id, project)
            sql.exec('INSERT INTO workspace_requests VALUES (?, ?, 0)', requestId, id)
            return { workspace: { id, name, description, slug: slug ?? null, project: project || null, createdAt }, pending: true }
          })
          return Response.json(item, { status: 201 })
        }
        return Response.json([
          ...sql.exec<WorkspaceRow>(workspaceSelect + ' WHERE ' + workspaceReady + ' ORDER BY created DESC').toArray().map((workspace) => ({ ...workspace, role: 'owner' })),
          ...sql.exec<{workspace: string}>('SELECT workspace FROM workspace_access').toArray().map(({ workspace }) => JSON.parse(workspace)),
        ])
      }
      if (request.method === 'DELETE') {
        const id = identifier.parse(path.slice(1))
        this.ctx.storage.transactionSync(() => {
          sql.exec('DELETE FROM workspace_contracts WHERE id = ?', id)
          sql.exec('DELETE FROM contracts WHERE id = ?', id)
        })
        return new Response(null, { status: 204 })
      }
      if (request.method === 'PUT') {
        const id = identifier.parse(path.slice(1))
        const url = new URL(request.url)
        const selected = url.searchParams.get('workspace')
        const copy = url.searchParams.get('copy')
        const workspace = selected ?? (copy && sql.exec<{ id: string }>(
          'SELECT workspace_id AS id FROM workspace_contracts WHERE id = ?', copy).toArray()[0]?.id)
        if (workspace && !sql.exec('SELECT id FROM workspaces WHERE id = ? AND ' + workspaceReady
          + ' UNION SELECT id FROM workspace_access WHERE id = ?', workspace, workspace).toArray().length) {
          throw new HttpError(404, 'Workspace unavailable.')
        }
        this.ctx.storage.transactionSync(() => {
          const existing = sql.exec('SELECT id FROM contracts WHERE id = ?', id).toArray().length > 0
          sql.exec('INSERT OR IGNORE INTO contracts VALUES (?, ?)', id, Date.now())
          if (workspace && (!existing || url.searchParams.has('attach'))) {
            sql.exec('INSERT OR IGNORE INTO workspace_contracts VALUES (?, ?)', id, workspace)
          }
        })
        return new Response(null, { status: 204 })
      }
      return Response.json(sql.exec<{ id: string; workspaceId: string | null }>(
        'SELECT contracts.id, workspace_contracts.workspace_id AS workspaceId FROM contracts LEFT JOIN workspace_contracts USING (id) ORDER BY contracts.created DESC').toArray())
    })
  }
}
function actor(env: Env, id: string, account: Account, action: string, request?: RequestInit) {
  const headers = new Headers(request?.headers)
  headers.set('x-clausid-account', encodeURIComponent(JSON.stringify(account)))
  headers.set('x-clausid-contract', id)
  return env.CONTRACTS.get(env.CONTRACTS.idFromName(id)).fetch('https://contract/' + action, { ...request, headers })
}
async function readPdfUpload(data: string) {
  let bytes: Uint8Array
  let pages: number
  try {
    bytes = decode(data)
    if (bytes.length > workspaceDocumentLimit) throw new HttpError(413, 'The PDF exceeds 1 MB.')
    if (new TextDecoder().decode(bytes.subarray(0, 5)) !== '%PDF-') throw new Error('Invalid PDF')
    pages = (await PDFDocument.load(bytes, { updateMetadata: false })).getPageCount()
    if (!pages) throw new Error('Empty PDF')
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(422, 'Choose a readable, unencrypted PDF.')
  }
  inspectPdf(bytes)
  return { bytes, pages }
}

function createPdfContract(env: Env, id: string, account: Account, title: string, name: string,
  { bytes, pages }: Awaited<ReturnType<typeof readPdfUpload>>,
) {
  return actor(env, id, account, 'create-pdf', {
    method: 'POST', body: bytes.slice().buffer,
    headers: {
      'Content-Type': 'application/pdf',
      'x-clausid-pdf': encodeURIComponent(JSON.stringify({ title, name, pages })),
    },
  })
}

const contractUpload = createContract.extend({ document: workspaceDocument.optional() })
const json = (body: unknown): RequestInit => ({
  method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
})
async function route(request: Request, env: Env) {
  const { pathname } = new URL(request.url)
  const { method } = request
  if (pathname === '/healthz' && method === 'GET') return Response.json({ ok: true })
  if (pathname.startsWith('/api/auth/')) {
    const headers = new Headers(request.headers)
    headers.delete('x-internal-key')
    headers.set('x-forwarded-host', new URL(env.PUBLIC_ORIGIN).host)
    headers.set('x-forwarded-proto', new URL(env.PUBLIC_ORIGIN).protocol.slice(0, -1))
    return env.AUTH.fetch(new Request('http://auth' + pathname + new URL(request.url).search, { method, headers, body: request.body, redirect: 'manual' }))
  }
  if (!pathname.startsWith('/api/')) throw new HttpError(404, 'Page unavailable.')
  if ((method !== 'GET' || request.headers.has('Upgrade')) && request.headers.get('Origin') !== env.PUBLIC_ORIGIN) {
    throw new HttpError(403, 'Request origin rejected.')
  }
  const session = await internal(env, '/internal/session', { headers: { cookie: request.headers.get('Cookie') ?? '' } })
  if (session.status === 401) throw new HttpError(401, 'Sign in with your verified email.')
  if (!session.ok) throw new HttpError(503, 'Authentication is temporarily unavailable.')
  const account = await session.json<Account>()
  const directory = env.DIRECTORY.get(env.DIRECTORY.idFromName(account.id))
  const sharing = (id: string, action: string, options?: RequestInit) => {
    const headers = new Headers(options?.headers)
    headers.set('x-clausid-account', encodeURIComponent(JSON.stringify(account)))
    return env.DIRECTORY.get(env.DIRECTORY.idFromName('workspace:' + id))
      .fetch('https://directory/sharing/' + action, { ...options, headers })
  }
  if (pathname === '/api/workspaces') {
    if (method === 'GET') {
      const listing = await directory.fetch('https://directory/workspaces')
      if (!listing.ok) return listing
      const workspaces = await listing.json<Workspace[]>()
      const result: Workspace[] = []
      for (let offset = 0; offset < workspaces.length; offset += 12) {
        result.push(...await Promise.all(workspaces.slice(offset, offset + 12).map(async (workspace) => {
          const detail = await sharing(workspace.id, 'details')
          if (detail.status === 404 && workspace.role === 'owner') {
            return { ...workspace, assignee: { id: account.id, email: account.email } }
          }
          if (!detail.ok) throw new HttpError(503, 'Workspace details are temporarily unavailable.')
          return { ...workspace, ...await detail.json<Workspace>(), role: workspace.role }
        })))
      }
      return Response.json(result)
    }
    if (method === 'POST') {
      const reservation = await directory.fetch('https://directory/workspaces', json(await readJson(request)))
      if (!reservation.ok) return reservation
      const { workspace, pending } = await reservation.json<{ workspace: Workspace; pending: boolean }>()
      if (pending) {
        const initialized = await sharing(workspace.id, 'initialize', json(workspace))
        if (!initialized.ok) return initialized
        const ready = await directory.fetch('https://directory/workspace-ready/' + workspace.id, { method: 'POST' })
        if (!ready.ok) return ready
      }
      return Response.json(workspace, { status: 201 })
    }
  }
  const workspaceInfo = (id: string) => directory.fetch('https://directory/workspaces/' + id)
  async function isServiceProvider(id: string) {
    const source = await workspaceInfo(id)
    if (source.status === 404) throw new HttpError(404, 'Workspace unavailable.')
    if (!source.ok) throw new HttpError(503, 'Workspace directory is temporarily unavailable.')
    return (await source.json<Workspace>()).role === 'owner'
  }
  const providerRequired = () => new HttpError(403, 'Only the workspace service provider can perform this action.')
  async function parties(id: string) {
    const source = await workspaceInfo(id)
    if (!source.ok) return source
    const workspace = await source.json<Workspace>()
    if (workspace.role === 'owner') {
      const initialized = await sharing(id, 'initialize', json(workspace))
      if (!initialized.ok) return initialized
    }
    return sharing(id, 'parties')
  }
  const workspaceAction = pathname.match(/^\/api\/workspaces\/([^/]+)\/(parties|invite|redeem|customize|delete)$/)
  if (workspaceAction) {
    const id = identifier.parse(workspaceAction[1])
    const action = workspaceAction[2]
    if (action === 'redeem' && method === 'POST') return sharing(id, action, json(await readJson(request)))
    if (action === 'parties' && method === 'GET') return parties(id)
    if (action === 'delete' && method === 'POST') {
      if (!await isServiceProvider(id)) throw providerRequired()
      const initialized = await parties(id)
      if (!initialized.ok) return initialized
      return sharing(id, 'delete', { method: 'POST' })
    }
    if (action === 'customize' && method === 'POST') {
      if (!await isServiceProvider(id)) throw providerRequired()
      const roster = await parties(id)
      if (!roster.ok) return roster
      return sharing(id, action, json(await readJson(request)))
    }
    if (action === 'invite' && method === 'POST') {
      const roster = await parties(id)
      if (!roster.ok) return roster
      return sharing(id, action, json(await readJson(request)))
    }
  }
  const register = async (id: string, options?: { workspace?: string; copy?: string }) => {
    const url = new URL('https://directory/' + id)
    if (options?.workspace) url.searchParams.set('workspace', options.workspace)
    if (options?.copy) url.searchParams.set('copy', options.copy)
    const response = await directory.fetch(url, { method: 'PUT' })
    if (response.status === 404) throw new HttpError(404, 'Workspace unavailable.')
    if (!response.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
  }
  if (pathname === '/api/contracts') {
    if (method === 'POST') {
      const { title, requestId, workspaceId, document } = contractUpload.parse(await readJson(request, workspaceDocumentRequestLimit))
      if (workspaceId && !await isServiceProvider(workspaceId)) throw providerRequired()
      const source = document && await readPdfUpload(document.data)
      if (workspaceId) {
        const entry = await directory.fetch('https://directory/workspace-contract/' + requestId)
        if (!entry.ok) throw new HttpError(503, 'The contract directory is temporarily unavailable.')
        const existing = await entry.json<{ workspaceId: string } | null>()
        if (existing && existing.workspaceId !== workspaceId) throw new HttpError(409, 'That contract belongs to another workspace.')
      }
      await register(requestId, { workspace: workspaceId })
      const created = document && source
        ? await createPdfContract(env, requestId, account, title, document.name, source)
        : await actor(env, requestId, account, 'create', json({ title }))
      if (created.status === 410) await directory.fetch('https://directory/' + requestId, { method: 'DELETE' })
      return created
    }
    if (method === 'GET') {
      const response = await directory.fetch('https://directory/')
      if (!response.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
      const entries = await response.json<{ id: string; workspaceId: string | null }[]>()
      const summaries: Summary[] = []
      for (let index = 0; index < entries.length; index += 12) {
        const batch = entries.slice(index, index + 12)
        const views = await Promise.all(batch.map(({ id }) => actor(env, id, account, 'view')))
        for (const [offset, view] of views.entries()) {
          if (view.status === 404) continue
          if (!view.ok) throw new HttpError(503, 'A contract could not be loaded.')
          const { id, title, role, status, hasSignatures } = await view.json<ContractView>()
          summaries.push({ id, title, role, status, hasSignatures, workspaceId: batch[offset].workspaceId ?? undefined })
        }
      }
      return Response.json(summaries)
    }
  }
  const match = pathname.match(/^\/api\/contracts\/([^/]+)(?:\/(.+))?$/)
  if (!match) throw new HttpError(404, 'Page unavailable.')
  const id = identifier.parse(match[1])
  const action = match[2] ?? 'view'
  async function contractWorkspace() {
    const location = await directory.fetch('https://directory/workspace-contract/' + id)
    if (!location.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
    return location.json<{ workspaceId: string } | null>()
  }
  if ((method === 'GET' && action === 'workspace') || (method === 'POST' && action === 'share-workspace')) {
    const contract = await actor(env, id, account, 'view')
    if (!contract.ok) return contract
    const view = await contract.json<ContractView>()
    const entry = await contractWorkspace()
    const canManage = view.role === 'owner' && (!entry || await isServiceProvider(entry.workspaceId))
    if (method === 'GET') return Response.json({ workspaceId: entry?.workspaceId, canManage })
    if (!canManage) throw providerRequired()
    if (view.role !== 'owner' || !entry) throw new HttpError(404, 'Workspace contract unavailable.')
    const roster = await parties(entry.workspaceId)
    if (!roster.ok) return roster
    const { parties: members } = await roster.json<WorkspaceParties>()
    return actor(env, id, account, 'share-workspace', json({ workspaceId: entry.workspaceId, members }))
  }
  if (method === 'GET' && action === 'socket') {
    return actor(env, id, { ...account, expires: Math.min(account.expires, Date.now() + 120_000) }, action,
      { headers: { Upgrade: request.headers.get('Upgrade') ?? '' } })
  }
  if (method === 'GET' && action === 'text-blocks') {
    const query = new URL(request.url).searchParams
    return actor(env, id, account, 'text-blocks?' + query.toString())
  }
  if (method === 'GET' && (/^(view|pdf|evidence|source-pdf|source-download)$/.test(action)
    || /^preview\/[\w-]+$/.test(action) || /^negotiated-pdf\/[a-f0-9]{64}$/.test(action))) {
    return actor(env, id, account, action)
  }
  if (method === 'POST' && action === 'redeem') {
    const body = redeemInvite.parse(await readJson(request))
    return actor(env, id, account, action, json(body))
  }
  if (method === 'POST' && action === 'delete') {
    const entry = await contractWorkspace()
    if (entry && !await isServiceProvider(entry.workspaceId)) throw providerRequired()
    return actor(env, id, account, 'delete', { method: 'POST' })
  }
  if (method === 'POST' && /^(invite|preview|freeze|duplicate|revoke\/[^/]+)$/.test(action)) {
    const entry = await contractWorkspace()
    if (entry && !await isServiceProvider(entry.workspaceId)) throw providerRequired()
  }
  if (method === 'POST' && action === 'duplicate') {
    const { title, requestId } = createContract.parse(await readJson(request))
    const source = await actor(env, id, account, 'copy-source')
    if (!source.ok) return source
    const { draft, pdf } = await source.json<{ draft: string; pdf?: boolean }>()
    if (pdf) {
      const original = await actor(env, id, account, 'copy-pdf')
      if (!original.ok) return original
      const metadata = JSON.parse(decodeURIComponent(original.headers.get('x-clausid-pdf')!))
      const body = await original.arrayBuffer()
      await register(requestId, { copy: id })
      return actor(env, requestId, account, 'create-pdf', { method: 'POST', body, headers: {
        'Content-Type': 'application/pdf', 'x-clausid-pdf': encodeURIComponent(JSON.stringify({ ...metadata, title })),
      } })
    }
    await register(requestId, { copy: id })
    return actor(env, requestId, account, 'create-copy', json({ title, draft }))
  }
  if (method === 'POST' && (/^(invite|preview|freeze|sign|void|annotation)$/.test(action) || /^revoke\/[\w-]+$/.test(action))) {
    return actor(env, id, account, action, json(await readJson(request)))
  }
  throw new HttpError(404, 'Page unavailable.')
}

export default {
  async fetch(request: Request, env: Env) {
    const response = await safeResponse(() => route(request, env))
    if (response.status !== 101) {
      const headers = new Headers(response.headers)
      headers.set('Cache-Control', 'private, no-store')
      headers.set('Referrer-Policy', 'no-referrer')
      headers.set('X-Content-Type-Options', 'nosniff')
      return new Response(response.body, { status: response.status, headers })
    }
    return response
  },
} satisfies ExportedHandler<Env>
