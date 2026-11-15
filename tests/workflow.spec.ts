import { createHash } from 'node:crypto'
import { expect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test'
import { linkFor } from './mailpit.ts'
import { consentVersion } from '../packages/contracts/src/index.ts'

const origin = 'http://127.0.0.1:5173'
const password = 'clausid-testing-123'
const post = (request: APIRequestContext, path: string, data: object) =>
  request.post(origin + path, { data, headers: { Origin: origin } })

async function account(page: Page, name: string, email: string) {
  await page.goto('/')
  await page.getByRole('link', { name: 'Create an account' }).click()
  await page.getByLabel(/^Name\b/).fill(name)
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Check your inbox to verify your email', { exact: false })).toBeVisible()
  await page.goto(await linkFor(email, 'verify'))
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Contracts', exact: true })).toBeVisible()
}

test('verified users collaborate, freeze an exact PDF, and sign with evidence', async ({ browser }) => {
  const owner = await browser.newContext()
  const editor = await browser.newContext()
  const first = await owner.newPage()
  const second = await editor.newPage()
  const suffix = crypto.randomUUID().slice(0, 8)
  const ownerEmail = 'owner-' + suffix + '@example.com'
  const editorEmail = 'editor-' + suffix + '@example.com'
  try {
    await Promise.all([account(first, 'Owner Lee', ownerEmail), account(second, 'Editor Lee', editorEmail)])
    await first.getByRole('link', { name: 'New workspace', exact: true }).click()
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Enter a workspace name' })).toBeVisible()
    await first.getByLabel('Workspace name').fill('Demo workspace')
    const slug = 'demo-workspace-' + suffix
    await first.getByLabel('Workspace URL').fill(slug)
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Invite your team' })).toBeVisible()
    await first.getByLabel('Email addresses').fill('invalid-address')
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Not a valid email address' })).toBeVisible()
    await first.getByRole('button', { name: 'Skip', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Choose a plan' })).toBeVisible()
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Review and create' })).toBeVisible()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Acknowledge the preview to create the workspace.' })).toBeVisible()
    await first.getByRole('checkbox', { name: /I understand/ }).check()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Demo workspace' })).toBeVisible()
    expect(new URL(first.url()).searchParams.get('workspaceSlug')).toBe(slug)
    const entries = await (await first.request.get(origin + '/api/workspaces')).json()
    const workspaceId = entries.find((item: { slug: string }) => item.slug === slug)?.id
    expect(workspaceId).toBeTruthy()
    const duplicateSlug = await post(first.request, '/api/workspaces', { name: 'Another workspace', requestId: crypto.randomUUID(), slug })
    expect(duplicateSlug.status()).toBe(409)
    const inaccessibleWorkspace = await post(second.request, '/api/contracts', {
      title: 'Unauthorized workspace contract', requestId: crypto.randomUUID(), workspaceId,
    })
    expect(inaccessibleWorkspace.status()).toBe(404)
    await first.getByRole('button', { name: 'New contract' }).click()
    await first.getByLabel('Contract title').fill('Services agreement')
    await first.getByRole('button', { name: 'Create contract', exact: true }).click()
    await expect(first.getByRole('textbox', { name: 'Contract document' })).toBeVisible()
    const fullscreen = first.locator('.contract-editor-fullscreen')
    await expect(fullscreen).toBeVisible()
    expect(await fullscreen.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top === 0 && bounds.left === 0 && bounds.width === innerWidth && bounds.height === innerHeight
    })).toBe(true)
    await expect(first.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(first.getByLabel('Layers and assets', { exact: true })).toBeVisible()
    await expect(first.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()
    await expect(first.locator('article[aria-label="Contract artboard"]').getByRole('textbox', { name: 'Contract document' })).toHaveCount(1)
    await expect(first.getByRole('button', { name: 'Template preview', exact: true })).toHaveCount(0)
    const contractPath = new URL(first.url()).pathname
    const apiPath = '/api' + contractPath
    expect((await second.request.get(origin + apiPath)).status()).toBe(404)
    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await first.getByRole('menuitem', { name: 'Share', exact: true }).click()
    await first.getByLabel('Collaborator email').fill(editorEmail)
    await first.getByRole('button', { name: 'Send invitation' }).click()
    const invitation = await linkFor(editorEmail, 'invite')
    const token = new URLSearchParams(new URL(invitation).hash.slice(1)).get('token')
    expect((await post(first.request, apiPath + '/redeem', { token })).status()).toBe(404)
    let suspended = false
    let editorSocket: WebSocketRoute | undefined
    await second.routeWebSocket('**/socket', (socket) => {
      if (suspended) { void socket.close({ code: 4000 }); return }
      editorSocket = socket
      socket.connectToServer()
    })
    await second.goto(invitation)
    await second.getByRole('button', { name: 'Accept invitation' }).click()
    await first.getByRole('button', { name: 'Done' }).click()
    const firstEditor = first.getByRole('textbox', { name: 'Contract document' })
    const secondEditor = second.getByRole('textbox', { name: 'Contract document' })
    await expect(secondEditor).toBeVisible()
    expect((await post(second.request, apiPath + '/redeem', { token })).status()).toBe(404)
    await Promise.all([firstEditor.focus(), secondEditor.focus()])
    await Promise.all([first.keyboard.insertText('Services '), second.keyboard.insertText('Terms ')])
    const draftText = (editor: typeof firstEditor) => editor.evaluate((element) => {
      const copy = element.cloneNode(true) as HTMLElement
      copy.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove())
      return copy.textContent
    })
    await expect.poll(() => draftText(firstEditor)).toMatch(/Services.*Terms|Terms.*Services/)
    await expect.poll(async () => await draftText(firstEditor) === await draftText(secondEditor)).toBe(true)
    await expect(first.locator('.collaboration-carets__label')).toHaveText('Editor Lee')
    suspended = true
    await editorSocket!.close({ code: 4000, reason: 'Test disconnect' })
    await expect(second.getByText('Reconnecting…', { exact: true })).toBeVisible()
    await secondEditor.press('End')
    await secondEditor.pressSequentially(' Offline clause.')
    expect(await draftText(firstEditor)).not.toContain('Offline clause.')
    suspended = false
    await expect.poll(() => draftText(firstEditor)).toContain('Offline clause.')
    await expect(first.getByText('Saved', { exact: true })).toBeVisible()
    const stale = await (await first.request.get(origin + apiPath)).json()
    const early = await post(first.request, apiPath + '/preview', { revision: stale.revision, signers: [ownerEmail] })
    expect(early.status(), await early.text()).toBe(200)
    const oldPreview = await early.json()
    await firstEditor.press('End')
    await firstEditor.pressSequentially(' Updated clause.')
    await expect.poll(() => draftText(secondEditor)).toContain('Updated clause.')
    expect((await post(first.request, apiPath + '/freeze', { previewId: oldPreview.id })).status()).toBe(409)

    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await first.getByRole('menuitem', { name: 'Prepare for signing', exact: true }).click()
    await first.getByLabel('Signer email addresses').fill([ownerEmail, editorEmail].join('\n'))
    await first.getByRole('button', { name: 'Generate PDF preview' }).click()
    const previewLink = first.getByRole('link', { name: 'Open preview in a new tab' })
    await expect(previewLink).toBeVisible()
    const previewBytes = await (await first.request.get(origin + await previewLink.getAttribute('href'))).body()
    expect(previewBytes.subarray(0, 4).toString()).toBe('%PDF')
    await first.getByRole('button', { name: 'Freeze and send' }).click()
    await expect(first.getByText('Awaiting signatures', { exact: true })).toBeVisible()
    await expect(second.getByText('Access to this contract ended.', { exact: true })).toBeVisible()
    const signingLink = await linkFor(editorEmail, 'invite', invitation)
    // The valid signing link is the latest invitation for the recipient.
    expect(signingLink).not.toBe(invitation)
    await second.goto(signingLink)
    await second.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(second.getByRole('button', { name: 'Sign contract' })).toBeVisible()
    const version = (await (await first.request.get(origin + apiPath)).json()).version
    const frozenBytes = await (await first.request.get(origin + apiPath + '/pdf')).body()
    expect(frozenBytes.equals(previewBytes)).toBe(true)
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(version.digest)
    await first.getByLabel('Full name').fill('Owner Lee')
    await first.getByRole('checkbox').check()
    await first.getByRole('button', { name: 'Sign contract' }).click()
    await expect(first.getByRole('button', { name: 'Sign contract' })).toHaveCount(0)
    const signature = { versionId: version.id, digest: version.digest, name: 'Editor Lee', consent: true, consentVersion }
    expect((await post(second.request, apiPath + '/sign', { ...signature, digest: '0'.repeat(64) })).status()).toBe(409)
    const responses = await Promise.all([post(second.request, apiPath + '/sign', signature), post(second.request, apiPath + '/sign', signature)])
    for (const response of responses) expect(response.status(), await response.text()).toBe(200)
    await expect(first.getByRole('link', { name: 'Download signing evidence' })).toBeVisible()
    const evidence = await second.request.get(origin + apiPath + '/evidence')
    expect(evidence.status()).toBe(200)
    const archive = unzipSync(await evidence.body())
    const record = JSON.parse(strFromU8(archive['signing-evidence.json']))
    expect(record.versionId).toBe(version.id)
    expect(record.sha256).toBe(version.digest)
    expect(record.signatures).toHaveLength(2)
    expect(new Set(record.signatures.map((entry: {email: string}) => entry.email))).toEqual(new Set([ownerEmail, editorEmail]))
    expect(record.signatures.every((entry: {digest: string}) => entry.digest === version.digest)).toBe(true)
    expect(Buffer.from(archive['contract.pdf']).equals(frozenBytes)).toBe(true)
    await first.getByRole('link', { name: 'Back to contracts' }).click()
    await first.getByRole('link', { name: 'Demo workspace', exact: true }).click()
    const list = first.getByRole('table', { name: 'Your contracts' })
    await expect(list.getByRole('row').filter({ hasText: 'Services agreement' })).toContainText('Signed')
    await expect(list.getByRole('link', { name: 'Services agreement' })).toHaveAttribute('href', contractPath)
  } finally {
    await owner.close()
    await editor.close()
  }
})
