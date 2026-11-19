import { assetManifestSchema } from './records.ts'
import { serviceResponse } from './http.ts'
import type { Env } from './http.ts'

const mimeTypes = new Map([
  ['html', 'text/html; charset=utf-8'],
  ['css', 'text/css; charset=utf-8'],
  ['js', 'text/javascript; charset=utf-8'],
  ['mjs', 'text/javascript; charset=utf-8'],
  ['json', 'application/json'],
  ['svg', 'image/svg+xml'],
  ['png', 'image/png'],
  ['webp', 'image/webp'],
  ['wasm', 'application/wasm'],
  ['ico', 'image/x-icon'],
  ['woff', 'font/woff'],
  ['woff2', 'font/woff2'],
])

export function servesApplication(request: Request) {
  const path = new URL(request.url).pathname
  return path !== '/healthz' && path !== '/api' && !path.startsWith('/api/')
}

function isPage(path: string) {
  return (
    path === '/' ||
    path === '/contracts' ||
    path === '/workspaces/new' ||
    /^\/workspaces\/[\w-]+\/edit\/?$/.test(path) ||
    /^\/(?:contracts|invite|workspace-invite)\/[\w-]+\/?$/.test(path)
  )
}

let manifest: Promise<Set<string>> | undefined

async function loadManifest(disk: NonNullable<Env['WEB_DISK']>) {
  const response = await disk.fetch('http://assets/clausid-assets.json')
  if (!response.ok) {
    return new Set<string>()
  }
  return new Set(await serviceResponse(response, assetManifestSchema))
}

export function securityHeaders(publicOrigin: string, headers = new Headers()) {
  for (const [key, value] of Object.entries({
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
    'X-Frame-Options': 'SAMEORIGIN',
  })) {
    headers.set(key, value)
  }
  if (new URL(publicOrigin).protocol === 'https:') {
    headers.set('Strict-Transport-Security', 'max-age=31536000')
  }
  return headers
}

export async function serveApplication(request: Request, env: Env): Promise<Response> {
  const headers = securityHeaders(env.PUBLIC_ORIGIN)
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    headers.set('Allow', 'GET, HEAD')
    return new Response(null, { status: 405, headers })
  }

  const path = new URL(request.url).pathname
  const file = isPage(path) ? '/index.html' : path
  const mime = mimeTypes.get(file.split('.').at(-1) ?? '')
  if (file === '/clausid-assets.json' || !mime || !/^\/[\w./-]+$/.test(file)) {
    return new Response(null, { status: 404, headers })
  }

  let response: Response | undefined
  if (env.ASSETS) {
    response = await env.ASSETS.fetch(new URL(file, request.url), { method: request.method })
  } else if (env.WEB_DISK && (await (manifest ??= loadManifest(env.WEB_DISK))).has(file)) {
    response = await env.WEB_DISK.fetch('http://assets' + file, { method: request.method })
  }
  if (!response?.ok) {
    return new Response(null, { status: 404, headers })
  }

  headers.set('Content-Type', mime)
  headers.set('Cache-Control', /^\/assets\/[^/]+-[\w-]{8,}\.[\w]+$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache')
  return new Response(request.method === 'HEAD' ? null : response.body, { headers })
}
