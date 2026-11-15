import { betterAuth } from 'better-auth'
import Database from 'better-sqlite3'
import nodemailer from 'nodemailer'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'

export function required(name: string) {
  const value = process.env[name]
  if (!value) throw new Error(`Set ${name} before starting the auth service.`)
  return value
}

export const origin = new URL(required('PUBLIC_ORIGIN')).origin
const path = process.env.AUTH_DB_PATH ?? '../../.data/auth/auth.sqlite'
mkdirSync(dirname(path), { recursive: true, mode: 0o700 })
export const database = new Database(path)
database.pragma('journal_mode = WAL')
database.pragma('busy_timeout = 5000')
const secure = process.env.SMTP_SECURE === 'true'
const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST ?? '127.0.0.1',
  port: Number(process.env.SMTP_PORT ?? 1025),
  secure,
  connectionTimeout: 5000,
  greetingTimeout: 5000,
  socketTimeout: 8000,
  requireTLS: !secure && process.env.SMTP_REQUIRE_TLS === 'true',
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: required('SMTP_PASSWORD') } : undefined,
})

export async function sendMail(to: string, subject: string, text: string) {
  await transport.sendMail({ from: required('MAIL_FROM'), to, subject, text })
}

export const auth = betterAuth({
  database,
  secret: required('BETTER_AUTH_SECRET'),
  baseURL: origin,
  trustedOrigins: [origin],
  advanced: {
    useSecureCookies: origin.startsWith('https:'),
    ipAddress: { ipAddressHeaders: ['x-clausid-client-ip'] },
  },
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
    minPasswordLength: 12,
    sendResetPassword: async ({ user, url }) => sendMail(user.email, 'Reset your Clausid password', url),
  },
  emailVerification: {
    sendOnSignUp: true,
    sendVerificationEmail: async ({ user, url }) => sendMail(user.email, 'Verify your Clausid email', url),
  },
  session: { expiresIn: 60 * 60 * 24 * 7, freshAge: 10 * 60, cookieCache: { enabled: false } },
  rateLimit: { enabled: true, window: 60, max: 60, storage: 'database' },
})
