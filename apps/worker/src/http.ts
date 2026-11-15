import { ValidationError } from '@clausid/contracts'

export interface Env {
  CONTRACTS: DurableObjectNamespace
  DIRECTORY: DurableObjectNamespace
  AUTH: Fetcher
  PUBLIC_ORIGIN: string
  INTERNAL_AUTH_KEY: string
}
export type Account = { id: string; email: string; name: string; createdAt: number; expires: number }

export class HttpError extends Error {
  constructor(public status: number, message: string) { super(message) }
}
export async function safeResponse(handler: () => Promise<Response>) {
  try { return await handler() } catch (error) {
    if (error instanceof HttpError) return Response.json({ error: error.message }, { status: error.status })
    if (error instanceof ValidationError || error instanceof SyntaxError) {
      return Response.json({ error: 'Check the information you entered.' }, { status: 400 })
    }
    console.error('Clausid request failed', error instanceof Error ? error.name : 'Unknown error')
    return Response.json({ error: 'The request could not be completed.' }, { status: 500 })
  }
}
export async function readJson(request: Request, limit = 16_384) {
  if (!request.headers.get('content-type')?.startsWith('application/json')) {
    throw new HttpError(415, 'Use application/json.')
  }
  const reader = request.body?.getReader()
  if (!reader) throw new HttpError(400, 'Request body required.')
  const decoder = new TextDecoder()
  let value = ''
  let size = 0
  for (;;) {
    const { value: chunk, done } = await reader.read()
    if (done) return JSON.parse(value + decoder.decode()) as unknown
    size += chunk.length
    if (size > limit) {
      await reader.cancel()
      throw new HttpError(413, 'Request is too large.')
    }
    value += decoder.decode(chunk, { stream: true })
  }
}
export function internal(env: Env, path: string, init?: RequestInit) {
  const headers = new Headers(init?.headers)
  headers.set('x-internal-key', env.INTERNAL_AUTH_KEY)
  return env.AUTH.fetch('http://auth' + path, { ...init, headers })
}
export function decode(data: string) {
  return Uint8Array.from(atob(data), (character) => character.charCodeAt(0))
}
export function encode(bytes: Uint8Array) {
  let result = ''
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    result += String.fromCharCode(...bytes.subarray(offset, offset + 8192))
  }
  return btoa(result)
}
export function hex(bytes: Uint8Array) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
}
export async function sha256(bytes: Uint8Array) {
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes.slice().buffer as ArrayBuffer)))
}
export function artifact(bytes: Uint8Array, contentType: string, filename: string, download: boolean) {
  return new Response(bytes.slice().buffer as ArrayBuffer, { headers: {
    'Content-Type': contentType,
    'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${filename}"`,
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  } })
}
