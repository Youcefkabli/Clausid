import app, { Contract as ContractObject, Directory as DirectoryObject } from './index.ts'
import { createAuth } from '../../auth/src/policy.ts'
import { sendInvitation, sessionResponse } from '../../auth/src/operations.ts'
import { maintenanceRequest } from './operations.ts'
import type { Env } from './http.ts'

type CloudflareEnv = Omit<Env, 'AUTH' | 'WEB_DISK' | 'INTERNAL_AUTH_KEY'> & {
  AUTH_DB: D1Database
  EMAIL: SendEmail
  BETTER_AUTH_SECRET: string
  MAIL_FROM: string
}

function withAuth(env: CloudflareEnv): Env {
  const sendMail = async (to: string, subject: string, text: string) => {
    await env.EMAIL.send({ from: env.MAIL_FROM, to, subject, text })
  }
  return {
    ...env,
    INTERNAL_AUTH_KEY: '',
    AUTH: {
      async fetch(input, init) {
        const request = new Request(input, init)
        const { pathname, search } = new URL(request.url)
        try {
          if (pathname === '/internal/invite' && request.method === 'POST') {
            await sendInvitation(env.PUBLIC_ORIGIN, sendMail, await request.json())
            return new Response(null, { status: 204 })
          }
          const auth = createAuth({
            database: env.AUTH_DB,
            origin: env.PUBLIC_ORIGIN,
            secret: env.BETTER_AUTH_SECRET,
            clientIpHeader: 'cf-connecting-ip',
            sendMail,
          })
          if (pathname === '/internal/session' && request.method === 'GET') {
            return await sessionResponse(auth, request.headers)
          }
          if (pathname.startsWith('/api/auth/')) {
            return await auth.handler(new Request(new URL(pathname + search, env.PUBLIC_ORIGIN), request))
          }
          return new Response(null, { status: 404 })
        } catch {
          console.error('Authentication or mail operation failed')
          return new Response(null, { status: 503 })
        }
      },
    },
  }
}

export class Contract extends ContractObject {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, withAuth(env))
  }
}

export class Directory extends DirectoryObject {
  constructor(ctx: DurableObjectState, env: CloudflareEnv) {
    super(ctx, withAuth(env))
  }
}

export default {
  fetch(request, env) {
    if (env.OPS_KEY) {
      return maintenanceRequest(request, withAuth(env))
    }
    if (!env.PUBLIC_ORIGIN || !env.BETTER_AUTH_SECRET || env.BETTER_AUTH_SECRET.length < 32 || !env.MAIL_FROM) {
      return new Response('Clausid deployment requires configuration.', { status: 503 })
    }
    return app.fetch(request, withAuth(env))
  },
} satisfies ExportedHandler<CloudflareEnv>
