// Exercise real verified-account registration, session logout and password recovery against Better Auth/Mailpit.
import { setTimeout as delay } from 'node:timers/promises'
import { expect, test, type Page } from '@playwright/test'
import { linkFor } from './mailpit.ts'

const password = 'clausid-original-password'
const reset = 'clausid-reset-password'

async function signIn(page: Page, email: string, value: string) {
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(value)
  const login = page.getByRole('button', { name: 'Login', exact: true })
  const [response] = await Promise.all([page.waitForResponse((result) => result.url().endsWith('/api/auth/sign-in/email')), login.click()])
  if (response.status() === 429) {
    const retryAfter = Number(response.headers()['x-retry-after'] ?? '10')
    await delay((retryAfter + 1) * 1000)
    await login.click()
  }
}

test('email registration, current-session sign-out, and password recovery', async ({ page, browser }) => {
  const email = 'account-' + crypto.randomUUID() + '@example.com'
  await page.goto('/contracts')
  await expect(page.getByRole('link', { name: 'Forgot password?' })).toBeVisible()
  expect((await page.request.get('/api/contracts')).status()).toBe(401)
  await page.getByRole('link', { name: 'Sign up' }).click()
  await page.getByLabel(/^Name\b/).fill('Test Account')
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Create account' }).click()
  await expect(page.getByText(/Check your inbox to verify/)).toBeVisible()
  await signIn(page, email, password)
  await expect(page.getByText('Verify your email before signing in.')).toBeVisible()
  expect((await page.request.get('/api/contracts')).status()).toBe(401)
  await page.getByRole('link', { name: 'Resend verification email' }).click()
  await page.getByRole('button', { name: 'Send verification email' }).click()
  await expect(page.getByText(/you’ll receive a new link/)).toBeVisible()
  await page.goto(await linkFor(email, 'verify', { minimumMessages: 2 }))
  await expect(page.getByText('Email verified. Sign in to continue.')).toBeVisible()
  await signIn(page, email, password)
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()

  const otherContext = await browser.newContext()
  try {
    const other = await otherContext.newPage()
    await other.goto('/')
    await signIn(other, email, password)
    await expect(other.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()

    await page.getByRole('button', { name: 'Account settings' }).click()
    const dialog = page.getByRole('dialog', { name: 'Settings' })
    await dialog.getByText('Login & security', { exact: true }).click({ timeout: 5000 })
    const currentSession = dialog.getByRole('listitem').filter({ hasText: 'Current session' })
    await expect(currentSession.getByText(email, { exact: true })).toBeVisible()
    await currentSession.getByRole('button', { name: 'Sign out', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
    expect((await page.request.get('/api/contracts')).status()).toBe(401)
    expect((await other.request.get('/api/contracts')).status()).toBe(200)

    await page.getByLabel(/^Email\b/).fill(email)
    await page.getByRole('link', { name: 'Forgot password?' }).click()
    await page.getByRole('button', { name: 'Send reset link' }).click()
    await expect(page.getByText(/you’ll receive a password reset link/)).toBeVisible()
    await page.goto(await linkFor(email, 'reset'))
    await page.getByLabel(/^New password/).fill(reset)
    await page.getByRole('button', { name: 'Set new password' }).click()
    await expect(page.getByText('Password reset. Sign in with your new password.')).toBeVisible()
    expect((await other.request.get('/api/contracts')).status()).toBe(401)
    await signIn(page, email, reset)
    await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
  } finally {
    await otherContext.close()
  }
})
