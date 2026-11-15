import { DurableObject } from 'cloudflare:workers'
import { createContract, identifier, redeemInvite } from '@clausid/contracts'
import type { ContractView, Summary } from '@clausid/contracts'
import { Contract } from './contract.ts'
import { HttpError, internal, readJson, safeResponse } from './http.ts'
import type { Account, Env } from './http.ts'

export { Contract }
export class Directory extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env)
    ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS contracts (id TEXT PRIMARY KEY, created INTEGER NOT NULL)')
  }
  async fetch(request: Request) {
    const id = new URL(request.url).pathname.slice(1)
    if (request.method === 'PUT') {
      this.ctx.storage.sql.exec('INSERT OR IGNORE INTO contracts VALUES (?, ?)', id, Date.now())
      return new Response(null, { status: 204 })
    }
    return Response.json(this.ctx.storage.sql.exec<{ id: string }>(
      'SELECT id FROM contracts ORDER BY created DESC').toArray().map((row) => row.id))
  }
}
function actor(env: Env, id: string, account: Account, action: string, request?: RequestInit) {
  const headers = new Headers(request?.headers)
  headers.set('x-clausid-account', encodeURIComponent(JSON.stringify(account)))
  headers.set('x-clausid-contract', id)
  return env.CONTRACTS.get(env.CONTRACTS.idFromName(id)).fetch('https://contract/' + action, { ...request, headers })
}
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
  const register = async (id: string) => {
    const response = await directory.fetch('https://directory/' + id, { method: 'PUT' })
    if (!response.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
  }
  if (pathname === '/api/contracts') {
    if (method === 'POST') {
      const { title, requestId } = createContract.parse(await readJson(request))
      await register(requestId)
      return actor(env, requestId, account, 'create', json({ title }))
    }
    if (method === 'GET') {
      const response = await directory.fetch('https://directory/')
      if (!response.ok) throw new HttpError(503, 'Contract directory is temporarily unavailable.')
      const ids = await response.json<string[]>()
      const summaries: Summary[] = []
      for (let index = 0; index < ids.length; index += 12) {
        const views = await Promise.all(ids.slice(index, index + 12).map((id) => actor(env, id, account, 'view')))
        for (const view of views) {
          if (view.status === 404) continue
          if (!view.ok) throw new HttpError(503, 'A contract could not be loaded.')
          const { id, title, role, status } = await view.json<ContractView>()
          summaries.push({ id, title, role, status })
        }
      }
      return Response.json(summaries)
    }
  }
  const match = pathname.match(/^\/api\/contracts\/([^/]+)(?:\/(.+))?$/)
  if (!match) throw new HttpError(404, 'Page unavailable.')
  const id = identifier.parse(match[1])
  const action = match[2] ?? 'view'
  if (method === 'GET' && action === 'socket') {
    return actor(env, id, { ...account, expires: Math.min(account.expires, Date.now() + 120_000) }, action,
      { headers: { Upgrade: request.headers.get('Upgrade') ?? '' } })
  }
  if (method === 'GET' && (/^(view|pdf|evidence)$/.test(action) || /^preview\/[\w-]+$/.test(action))) {
    return actor(env, id, account, action)
  }
  if (method === 'POST' && action === 'redeem') {
    const body = redeemInvite.parse(await readJson(request))
    return actor(env, id, account, action, json(body))
  }
  if (method === 'POST' && action === 'duplicate') {
    const { title, requestId } = createContract.parse(await readJson(request))
    const source = await actor(env, id, account, 'copy-source')
    if (!source.ok) return source
    const { draft } = await source.json<{ draft: string }>()
    await register(requestId)
    return actor(env, requestId, account, 'create-copy', json({ title, draft }))
  }
  if (method === 'POST' && (/^(invite|preview|freeze|sign|void)$/.test(action) || /^revoke\/[\w-]+$/.test(action))) {
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
