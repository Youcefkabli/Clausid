import { betterAuth } from 'better-auth'
import type { BetterAuthOptions } from 'better-auth'

type AuthConfig = {
  database: BetterAuthOptions['database']
  origin: string
  secret: string
  clientIpHeader: string
  sendMail: (to: string, subject: string, text: string) => Promise<void>
}

export function createAuth({ database, origin, secret, clientIpHeader, sendMail }: AuthConfig) {
  return betterAuth({
    // oxlint-disable-next-line typescript/no-unsafe-assignment -- TypeScript 5.9 validates BetterAuthOptions database; the TS7 lint adapter loses this third-party union. Real auth and restore suites exercise both adapters.
    database,
    secret,
    baseURL: origin,
    trustedOrigins: [origin],
    advanced: {
      useSecureCookies: origin.startsWith('https:'),
      ipAddress: { ipAddressHeaders: [clientIpHeader] },
    },
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 12,
      revokeSessionsOnPasswordReset: true,
      sendResetPassword: async ({ user, url }) => sendMail(user.email, 'Reset your Clausid password', url),
    },
    emailVerification: {
      sendOnSignUp: true,
      sendVerificationEmail: async ({ user, url }) => sendMail(user.email, 'Verify your Clausid email', url),
    },
    session: { expiresIn: 60 * 60 * 24 * 7, freshAge: 10 * 60, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 60, storage: 'database' },
  })
}
