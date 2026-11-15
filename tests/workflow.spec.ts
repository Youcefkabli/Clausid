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
    const appHeader = first.getByRole('navigation', { name: 'Top navigation' })
    const originalHeaderHeight = await appHeader.evaluate((element) => element.getBoundingClientRect().height)
    await first.getByRole('button', { name: 'Add document' }).click()
    await first.getByLabel('Contract title').fill('Services agreement')
    await first.getByRole('button', { name: 'Create contract', exact: true }).click()
    await expect(first.getByRole('textbox', { name: 'Contract document' })).toBeVisible()
    await expect(appHeader.getByRole('link', { name: 'Clausid', exact: true })).toBeVisible()
    await expect(appHeader.getByRole('button', { name: 'Account settings' })).toBeVisible()
    await expect(appHeader.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
    await expect(appHeader.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(appHeader.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
    const desktopViewport = first.viewportSize()!
    for (const width of [desktopViewport.width, 641, 390, 320]) {
      await first.setViewportSize({ width, height: desktopViewport.height })
      await expect.poll(() => appHeader.evaluate((element) => element.getBoundingClientRect().height),
        { message: `App header height at ${width}px` })
        .toBe(originalHeaderHeight)
      await expect(appHeader.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
      await expect(appHeader.getByRole('button', { name: 'Account settings' })).toBeVisible()
    }
    await first.setViewportSize(desktopViewport)
    const canvas = first.locator('.contract-editor')
    await expect(canvas).toBeVisible()
    expect(await canvas.evaluate((element) => {
      const bounds = element.getBoundingClientRect()
      return bounds.top > 0 && bounds.left === 0 && bounds.width === innerWidth
        && Math.abs(bounds.bottom - innerHeight) < 1
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

test('only the service provider can share a workspace draft and approve it for signing', async ({ browser }) => {
  const firstContext = await browser.newContext()
  const secondContext = await browser.newContext()
  const owner = await firstContext.newPage()
  const party = await secondContext.newPage()
  const suffix = crypto.randomUUID().slice(0, 8)
  const ownerEmail = 'workspace-owner-' + suffix + '@example.com'
  const partyEmail = 'workspace-party-' + suffix + '@example.com'
  const id = crypto.randomUUID()
  try {
    await Promise.all([account(owner, 'Service Provider', ownerEmail), account(party, 'Negotiating Party', partyEmail)])
    const created = await post(owner.request, '/api/workspaces', { name: 'Negotiation workspace', requestId: id })
    expect(created.ok()).toBe(true)
    await owner.goto('/')
    await owner.getByRole('link', { name: 'Negotiation workspace', exact: true }).click()
    await owner.getByRole('button', { name: 'Share workspace' }).click()
    await owner.getByLabel('Party email').fill(partyEmail)
    await owner.getByRole('button', { name: 'Invite party' }).click()
    await expect(owner.getByText('Workspace invitation sent.')).toBeVisible()
    const invitation = await linkFor(partyEmail, 'workspace')
    const token = new URLSearchParams(new URL(invitation).hash.slice(1)).get('token')
    expect((await post(owner.request, '/api/workspaces/' + id + '/redeem', { token })).status()).toBe(404)
    await party.goto(invitation)
    await party.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(party.getByRole('heading', { name: 'Negotiation workspace' })).toBeVisible()
    await expect(party.getByRole('button', { name: 'Add document' })).toHaveCount(0)
    expect((await post(party.request, '/api/contracts', {
      title: 'Unauthorized draft', requestId: crypto.randomUUID(), workspaceId: id,
    })).status()).toBe(403)
    await owner.goto('/?workspace=' + id)
    await owner.getByRole('button', { name: 'Add document' }).click()
    await owner.getByLabel('Contract title').fill('Draft proposal')
    await owner.getByRole('button', { name: 'Create contract' }).click()
    const ownerEditor = owner.getByRole('textbox', { name: 'Contract document' })
    await expect(ownerEditor).toBeVisible()
    const contractPath = new URL(owner.url()).pathname
    await ownerEditor.focus()
    await owner.keyboard.insertText('Proposed payment term: 30 days.')
    await expect(owner.getByText('Saved', { exact: true })).toBeVisible()
    expect((await party.request.get(origin + '/api' + contractPath)).status()).toBe(404)
    await expect(party.getByRole('heading', { name: 'No contracts yet' })).toBeVisible()
    await owner.getByRole('button', { name: 'Export', exact: true }).click()
    await owner.getByRole('menuitem', { name: 'Share', exact: true }).click()
    await owner.getByRole('button', { name: 'Share with workspace' }).click()
    await expect(owner.getByText('Workspace parties can now edit this draft.')).toBeVisible()
    await owner.getByRole('button', { name: 'Done', exact: true }).click()
    await party.getByRole('link', { name: 'Draft proposal', exact: true }).click()
    const partyEditor = party.getByRole('textbox', { name: 'Contract document' })
    await expect(partyEditor).toContainText('Proposed payment term: 30 days.')
    await partyEditor.press('End')
    await party.keyboard.insertText(' Counterproposal: 45 days.')
    await expect(ownerEditor).toContainText('Counterproposal: 45 days.')
    await party.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(party.getByRole('menuitem', { name: 'Share', exact: true })).toBeDisabled()
    await expect(party.getByRole('menuitem', { name: 'Prepare for signing', exact: true })).toBeDisabled()
    for (const action of ['share-workspace', 'invite', 'preview', 'freeze']) {
      expect((await post(party.request, '/api' + contractPath + '/' + action, {})).status()).toBe(403)
    }
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})
