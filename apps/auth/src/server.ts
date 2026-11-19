import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { toNodeHandler } from 'better-auth/node'
import { auth, origin, required, sendMail } from './config.ts'
import { sendInvitation, sessionResponse } from './operations.ts'

const handleAuth = toNodeHandler(auth)
const key = Buffer.from(required('INTERNAL_AUTH_KEY'))
const server = createServer((request, response) => {
  void handleRequest(request, response).catch(() => {
    response.destroy()
    console.error('Authentication handler failed')
  })
})
async function handleRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', origin)
  try {
    if (url.pathname.startsWith('/api/auth/')) {
      return await handleAuth(request, response)
    }
    const provided = Buffer.from(String(request.headers['x-internal-key'] ?? ''))
    if (provided.length !== key.length || !timingSafeEqual(provided, key)) {
      response.writeHead(404).end()
      return
    }
    if (url.pathname === '/internal/session' && request.method === 'GET') {
      const result = await sessionResponse(auth, new Headers({ cookie: request.headers.cookie ?? '' }))
      response.writeHead(result.status, Object.fromEntries(result.headers)).end(await result.text())
      return
    }
    if (url.pathname === '/internal/invite' && request.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        if (!(chunk instanceof Buffer)) {
          throw new Error('Invalid HTTP body chunk.')
        }
        size += chunk.length
        if (size > 8192) {
          response.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      await sendInvitation(origin, sendMail, JSON.parse(Buffer.concat(chunks).toString()))
      response.writeHead(204).end()
      return
    }
    response.writeHead(404).end()
  } catch {
    if (!response.headersSent) {
      response.writeHead(503)
    }
    response.end()
    console.error('Authentication or mail operation failed')
  }
}
server.listen(Number(process['env']['AUTH_PORT'] ?? 8788), process['env']['AUTH_HOST'] ?? '127.0.0.1')
