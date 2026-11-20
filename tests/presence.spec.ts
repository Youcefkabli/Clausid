// Verify workspace presence, private-document redaction, named selections, and tab aggregation through real services.
import { test, expect as playwrightExpect } from '@playwright/test'
import type { Page, APIRequestContext } from '@playwright/test'
import { setTimeout as delay } from 'node:timers/promises'
import { linkFor } from './mailpit.ts'
import { contractViewSchema, workspaceSchema, workspacePresenceSchema } from '../packages/contracts/src/index.ts'
import type { Participant } from '../packages/contracts/src/index.ts'
import { requiredValue } from '../packages/contracts/src/invariant.ts'
const expect = playwrightExpect.configure({ timeout: 75_000 })
const origin = `http://127.0.0.1:${process.env['CLAUSID_VITE_PORT'] ?? '5173'}`
const password = 'clausid-testing-123'
const post = (request: APIRequestContext, path: string, data: object) => request.post(origin + path, { data, headers: { Origin: origin } })
async function account(page: Page, name: string, email: string) {
  // The two verified sessions share a loopback IP with the other browser tests.
  // Honor Better Auth's retry interval when the combined workflows fill its window.
  await page.route(/\/api\/auth\/(?:get-session|sign-in\/email|sign-up\/email)(?:\?|$)/, async (route) => {
    let response = await route.fetch()
    if (response.status() === 429) {
      const seconds = Number(response.headers()['x-retry-after'] ?? response.headers()['retry-after'] ?? 60)
      await delay((seconds + 1) * 1000)
      response = await route.fetch()
    }
    await route.fulfill({ response })
  })
  await page.goto('/')
  await page.getByRole('link', { name: 'Sign up' }).click()
  await page.getByLabel(/^Name\b/).fill(name)
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Check your inbox to verify your email', { exact: false })).toBeVisible()
  await page.goto(await linkFor(email, 'verify'))
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
}

test('workspace members see safe activity, colored carets and one row per account across tabs', async ({ browser }) => {
  test.setTimeout(240_000)
  const ownerContext = await browser.newContext()
  const memberContext = await browser.newContext()
  const owner = await ownerContext.newPage(),
    member = await memberContext.newPage()
  const errors: string[] = []
  owner.on('pageerror', (error) => errors.push(error.message))
  member.on('pageerror', (error) => errors.push(error.message))
  const suffix = crypto.randomUUID().slice(0, 8)
  const ownerEmail = `presence-owner-${suffix}@example.com`,
    memberEmail = `presence-member-${suffix}@example.com`
  let latest: Participant[] = []
  const frames: string[] = []
  member.on('websocket', (socket) => {
    if (socket.url().includes('/api/workspaces/')) {
      socket.on('framereceived', ({ payload }) => {
        const raw = payload.toString()
        frames.push(raw)
        const value: unknown = JSON.parse(raw)
        const parsed = workspacePresenceSchema.parse(value)
        if (parsed.type === 'participants') {
          latest = parsed.participants
        }
      })
    }
  })
  try {
    await Promise.all([account(owner, 'Alex Morgan', ownerEmail), account(member, 'Taylor Jordan', memberEmail)])
    const created = await post(owner.request, '/api/workspaces', { requestId: crypto.randomUUID(), name: 'Presence workspace', team: [memberEmail] })
    expect(created.status(), await created.text()).toBe(201)
    const workspace = workspaceSchema.parse(await created.json())
    const invitation = await linkFor(memberEmail, 'workspace')
    const token = new URLSearchParams(new URL(invitation).hash.slice(1)).get('token')
    expect((await post(member.request, `/api/workspaces/${workspace.id}/redeem`, { token })).status()).toBe(200)
    const isolatedResponse = await post(owner.request, '/api/workspaces', { requestId: crypto.randomUUID(), name: 'Isolated workspace', team: [memberEmail] })
    const isolated = workspaceSchema.parse(await isolatedResponse.json())
    expect((await member.request.get(`/api/workspaces/${isolated.id}/parties`)).status()).toBe(404)
    const refused = await member.evaluate(
      (workspaceId) =>
        new Promise<number>((resolve) => {
          const ws = new WebSocket(location.origin.replace('http', 'ws') + '/api/workspaces/' + workspaceId + '/socket')
          ws.onclose = (event) => resolve(event.code)
          ws.onmessage = () => {
            ws.close()
            resolve(0)
          }
        }),
      isolated.id,
    )
    expect(refused).toBe(1006)
    expect(
      (await member.request.get(`/api/workspaces/${workspace.id}/socket`, { headers: { Origin: 'https://other.example', Upgrade: 'websocket' } })).status(),
    ).toBe(403)
    const sharedId = crypto.randomUUID(),
      privateId = crypto.randomUUID()
    for (const [requestId, title] of [
      [sharedId, 'Shared terms'],
      [privateId, 'Confidential pricing'],
    ]) {
      const response = await post(owner.request, '/api/contracts', { requestId, title, workspaceId: workspace.id })
      expect(response.status(), await response.text()).toBe(201)
      contractViewSchema.parse(await response.json())
    }
    expect((await post(owner.request, `/api/contracts/${sharedId}/share-workspace`, {})).status()).toBe(200)
    await member.goto('/?workspace=' + workspace.id)
    await member.getByRole('button', { name: /online$/ }).click()
    const participantsDialog = member.getByRole('dialog', { name: 'Workspace participants' })
    await expect(participantsDialog.getByText('Taylor Jordan', { exact: true })).toBeVisible()
    const ownerRow = participantsDialog.getByRole('listitem').filter({ hasText: ownerEmail })
    await expect(ownerRow).toContainText('Offline')
    await owner.goto('/contracts/' + privateId)
    await expect(owner.getByRole('textbox', { name: 'Contract document' })).toBeVisible()
    await expect(ownerRow).toContainText('Working in a document')
    expect(frames.join('\n')).not.toContain(privateId)
    expect(frames.join('\n')).not.toContain('Confidential pricing')
    await owner.goto('/contracts/' + sharedId)
    await expect(ownerRow.getByRole('link', { name: 'Shared terms' })).toBeVisible()
    await ownerRow.getByRole('link', { name: 'Shared terms' }).click()
    const ownerEditor = owner.getByRole('textbox', { name: 'Contract document' })
    const memberEditor = member.getByRole('textbox', { name: 'Contract document' })
    await expect(memberEditor).toBeVisible()
    await memberEditor.fill('Working together on shared terms.')
    await expect(ownerEditor).toContainText('Working together')
    await memberEditor.press('End')
    await memberEditor.press('Shift+ArrowLeft')
    await memberEditor.press('Shift+ArrowLeft')
    await expect(owner.locator('.collaboration-carets__label')).toHaveText('Taylor Jordan')
    await expect(owner.locator('.ProseMirror-yjs-selection')).toBeVisible()
    const color = requiredValue(latest.find((person) => person.email === memberEmail)).color
    const rgb = 'rgb(' + [1, 3, 5].map((start) => parseInt(color.slice(start, start + 2), 16)).join(', ') + ')'
    await expect(owner.locator('.collaboration-carets__caret')).toHaveCSS('border-left-color', rgb)
    await owner.screenshot({ path: test.info().outputPath('participants-carets.png'), fullPage: true, animations: 'disabled' })
    const spoofed = await member.evaluate(
      ({ workspaceId, secretId }) =>
        new Promise<string>((resolve) => {
          const ws = new WebSocket(location.origin.replace('http', 'ws') + '/api/workspaces/' + workspaceId + '/socket')
          let sent = false
          ws.onmessage = (event) => {
            if (sent && typeof event.data === 'string') {
              ws.close()
              resolve(event.data)
            } else {
              sent = true
              ws.send(JSON.stringify({ type: 'activity', status: 'Editing', contractId: secretId, name: 'Imposter', email: 'imposter@example.com' }))
            }
          }
        }),
      { workspaceId: workspace.id, secretId: privateId },
    )
    const spoofSnapshot = workspacePresenceSchema.parse(JSON.parse(spoofed))
    expect(spoofSnapshot.type).toBe('participants')
    expect(spoofed).not.toContain('Imposter')
    expect(spoofed).not.toContain(privateId)
    expect(spoofed).not.toContain('Confidential pricing')
    await owner.getByRole('button', { name: 'People', exact: true }).click()
    const people = owner.getByLabel('People panel', { exact: true })
    const memberRow = people.getByRole('listitem').filter({ hasText: memberEmail })
    await memberEditor.press('End')
    const typing = memberEditor.pressSequentially(' Editing live.', { delay: 75 })
    await expect(memberRow).toContainText('Editing')
    await typing
    await expect(memberRow).toContainText('Online')
    const extra = await memberContext.newPage()
    await extra.goto('/contracts/' + sharedId)
    await expect(extra.getByRole('textbox', { name: 'Contract document' })).toBeVisible()
    await expect(memberRow).toHaveCount(1)
    expect(requiredValue(latest.find((person) => person.email === memberEmail)).color).toBe(color)
    await extra.close()
    await expect(memberRow).not.toContainText('Offline')
    const longName = 'Taylor Jordan with a long participant name for the shared contract review'
    expect((await post(member.request, '/api/auth/update-user', { name: longName })).status()).toBe(200)
    await member.reload()
    await expect(memberRow).toContainText(longName)
    expect(requiredValue(latest.find((person) => person.email === memberEmail)).color).toBe(color)
    await owner.getByRole('button', { name: 'Sections', exact: true }).click()
    const shellSurfaces = async () => {
      const surfaces = await owner.evaluate(() => {
        const banner = document.querySelector('[role="banner"]')
        const header = banner?.querySelector('.astryx-layout-header')
        const panels = ['Document navigation', 'Sections panel', 'People panel'].map((label) => document.querySelector('[aria-label="' + label + '"]'))
        if (!banner || !header || panels.some((panel) => !panel)) {
          throw new Error('Shell regions are missing.')
        }
        function background(element: Element): string {
          let current: Element | null = element
          while (current) {
            const color = getComputedStyle(current).backgroundColor
            if (color !== 'rgba(0, 0, 0, 0)' && color !== 'transparent') {
              return color
            }
            current = current.parentElement
          }
          throw new Error('Shell has no painted surface.')
        }
        return {
          background: background(banner),
          panels: panels.map((panel) => {
            if (!panel) {
              throw new Error('Missing panel')
            }
            return background(panel)
          }),
          border: getComputedStyle(header).borderBottomColor,
          borders: panels.map((panel, index) => {
            if (!panel) {
              throw new Error('Missing panel')
            }
            return index < 2 ? getComputedStyle(panel).borderRightColor : getComputedStyle(panel).borderLeftColor
          }),
          borderWidths: [
            getComputedStyle(header).borderBottomWidth,
            ...panels.map((panel, index) => {
              if (!panel) {
                throw new Error('Missing panel')
              }
              return index < 2 ? getComputedStyle(panel).borderRightWidth : getComputedStyle(panel).borderLeftWidth
            }),
          ],
        }
      })
      expect(surfaces.panels).toEqual(Array.from({ length: 3 }, () => surfaces.background))
      expect(surfaces.borders).toEqual(Array.from({ length: 3 }, () => surfaces.border))
      expect(surfaces.borderWidths).toEqual(Array.from({ length: 4 }, () => '1px'))
    }
    await shellSurfaces()
    await owner.screenshot({ path: test.info().outputPath('participants-desktop.png'), fullPage: true, animations: 'disabled' })
    await owner.emulateMedia({ colorScheme: 'dark' })
    await shellSurfaces()
    await owner.screenshot({ path: test.info().outputPath('participants-dark.png'), fullPage: true, animations: 'disabled' })
    for (const width of [1920, 1280, 1100, 1024, 901, 641, 390, 320]) {
      await owner.setViewportSize({ width, height: 844 })
      const nav = owner.getByRole('navigation', { name: 'Top navigation' })
      await expect(nav).toHaveCSS('height', '36px')
      await expect(nav.getByRole('group', { name: 'Editor tools' })).toHaveCount(width > 900 ? 1 : 0)
      const group = nav.getByRole('group', { name: 'Participants and account' })
      const participant = group.getByRole('button', { name: /online$/ })
      await expect(participant).toBeVisible()
      const avatars = participant.getByTestId('online-member-avatars').locator('.astryx-avatar')
      await expect(avatars).toHaveCount(2)
      await expect(avatars.nth(1).getByTestId('online-member-color')).toHaveCSS('background-color', rgb)
      const firstAvatar = requiredValue(await avatars.nth(0).boundingBox())
      const secondAvatar = requiredValue(await avatars.nth(1).boundingBox())
      expect(secondAvatar.x).toBeGreaterThan(firstAvatar.x)
      expect(secondAvatar.x).toBeLessThan(firstAvatar.x + firstAvatar.width)
      const participantBounds = requiredValue(await participant.boundingBox(), 'Missing participant bounds at width ' + width)
      const accountBounds = requiredValue(await group.getByRole('button', { name: 'Account settings' }).boundingBox())
      expect(participantBounds.x + participantBounds.width).toBeLessThanOrEqual(accountBounds.x)
      expect(accountBounds.x - (participantBounds.x + participantBounds.width)).toBeLessThanOrEqual(8)
      expect(accountBounds.x + accountBounds.width).toBeLessThanOrEqual(width)
      const toolbarBounds = requiredValue(await owner.getByRole('group', { name: 'Editor tools' }).boundingBox())
      const intersects =
        toolbarBounds.x < participantBounds.x + participantBounds.width &&
        toolbarBounds.x + toolbarBounds.width > participantBounds.x &&
        toolbarBounds.y < participantBounds.y + participantBounds.height &&
        toolbarBounds.y + toolbarBounds.height > participantBounds.y
      expect(intersects).toBe(false)
      if (width === 1024) {
        await owner.screenshot({ path: test.info().outputPath('participants-medium.png'), fullPage: true, animations: 'disabled' })
      }
      expect(
        await participant.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          const hit = document.elementFromPoint(bounds.x + bounds.width / 2, bounds.y + bounds.height / 2)
          return hit !== null && element.contains(hit)
        }),
      ).toBe(true)
    }
    await owner.setViewportSize({ width: 320, height: 844 })
    await expect(owner.getByRole('navigation', { name: 'Top navigation' })).toHaveCSS('height', '36px')
    await owner.setViewportSize({ width: 390, height: 844 })
    await expect(owner.getByLabel('People panel', { exact: true })).toHaveCount(0)
    await owner.getByRole('button', { name: 'People', exact: true }).click()
    await expect(owner.getByRole('dialog', { name: 'People', exact: true }).getByText(longName, { exact: true })).toBeVisible()
    await expect
      .poll(async () => {
        const box = await owner.getByRole('dialog', { name: 'People', exact: true }).boundingBox()
        return box ? box.x + box.width : Infinity
      })
      .toBeLessThanOrEqual(391)
    await owner.screenshot({ path: test.info().outputPath('participants-mobile.png'), fullPage: true, animations: 'disabled' })
    expect((await post(member.request, '/api/auth/update-user', { name: 'Alex Morgan' })).status()).toBe(200)
    await member.reload()
    await expect(owner.getByRole('dialog', { name: 'People', exact: true }).getByRole('listitem').filter({ hasText: memberEmail })).toContainText('Alex Morgan')
    await expect(owner.getByRole('dialog', { name: 'People', exact: true }).getByRole('listitem')).toHaveCount(2)
    await member.goto('/')
    await expect(owner.getByRole('dialog', { name: 'People', exact: true }).getByRole('listitem').filter({ hasText: memberEmail })).toContainText('Offline')
    expect(errors).toEqual([])
  } finally {
    await ownerContext.close()
    await memberContext.close()
  }
})
