import { createServer } from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { toNodeHandler } from 'better-auth/node'
import { auth, origin, required, sendMail } from './config.ts'

const handleAuth = toNodeHandler(auth)
const key = Buffer.from(required('INTERNAL_AUTH_KEY'))
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', origin)
  try {
    if (url.pathname.startsWith('/api/auth/')) return await handleAuth(request, response)
    const provided = Buffer.from(String(request.headers['x-internal-key'] ?? ''))
    if (provided.length !== key.length || !timingSafeEqual(provided, key)) {
      response.writeHead(404).end()
      return
    }
    if (url.pathname === '/internal/session' && request.method === 'GET') {
      const session = await auth.api.getSession({ headers: new Headers({ cookie: request.headers.cookie ?? '' }) })
      if (!session?.user.emailVerified) {
        response.writeHead(401).end()
        return
      }
      response.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
      response.end(JSON.stringify({
        id: session.user.id, email: session.user.email.toLowerCase(), name: session.user.name,
        createdAt: session.session.createdAt.getTime(), expires: session.session.expiresAt.getTime(),
      }))
      return
    }
    if (url.pathname === '/internal/invite' && request.method === 'POST') {
      const chunks: Buffer[] = []
      let size = 0
      for await (const chunk of request) {
        size += chunk.length
        if (size > 8192) {
          response.writeHead(413).end()
          return
        }
        chunks.push(chunk)
      }
      const { email, contractId, token, role } = JSON.parse(Buffer.concat(chunks).toString())
      const url = new URL(`/invite/${contractId}`, origin)
      const fragment = new URLSearchParams({ token })
      url.hash = fragment.toString()
      await sendMail(email, role === 'signer' ? 'You have a Clausid contract to sign' : 'You are invited to edit a Clausid contract',
        `Open this invitation and sign in with the verified email address it was sent to.\n\n${url.href}`)
      response.writeHead(204).end()
      return
    }
    response.writeHead(404).end()
  } catch {
    if (!response.headersSent) response.writeHead(503)
    response.end()
    console.error('Authentication or mail operation failed')
  }
})
server.listen(Number(process.env.AUTH_PORT ?? 8788), process.env.AUTH_HOST ?? '127.0.0.1')
