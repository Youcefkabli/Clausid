// Exercise real collaboration, provider authority, PDF negotiation, frozen signing and protocol recovery in a browser.
import { z } from 'zod'

import { requiredValue } from '../packages/contracts/src/invariant.ts'
import { setTimeout as delay } from 'node:timers/promises'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { expect as playwrightExpect, test } from '@playwright/test'
import { strFromU8, unzipSync } from 'fflate'
import type { APIRequestContext, Page, WebSocketRoute } from '@playwright/test'
import { linkFor } from './mailpit.ts'
import { workspaceFixture, workspacePdf } from './workspace-fixture.ts'
import {
  clientMessage,
  consentVersion,
  contractViewSchema,
  workspaceSchema,
  workspacesSchema,
  workspacePartiesSchema,
  previewSchema,
  signatureSchema,
  digestSchema,
} from '../packages/contracts/src/index.ts'

// A page can be waiting for the real auth service's 60-second retry window.
const expect = playwrightExpect.configure({ timeout: 75_000 })
const origin = `http://127.0.0.1:${process['env']['CLAUSID_VITE_PORT'] ?? '5173'}`
test.describe.configure({ timeout: 200_000 })
const evidenceSchema = z.object({ versionId: z.string(), sha256: digestSchema, signatures: z.array(signatureSchema) })
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

test('verified users collaborate, freeze an exact PDF, and sign with evidence', async ({ browser }) => {
  const owner = await browser.newContext()
  const editor = await browser.newContext({ hasTouch: true })
  const first = await owner.newPage()
  const second = await editor.newPage()
  const suffix = crypto.randomUUID().slice(0, 8)
  const ownerEmail = 'owner-' + suffix + '@example.com'
  const editorEmail = 'editor-' + suffix + '@example.com'
  try {
    await Promise.all([account(first, 'Owner Lee', ownerEmail), account(second, 'Editor Lee', editorEmail)])
    const appHeader = first.getByRole('navigation', { name: 'Top navigation' })
    await expect(appHeader).toHaveCSS('height', '36px')
    await first.getByRole('link', { name: 'New workspace', exact: true }).click()
    await expect(appHeader).toHaveCSS('height', '36px')
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Enter a workspace name' })).toBeVisible()
    await first.getByLabel('Workspace name').fill('Demo workspace')
    await first.getByLabel('Project', { exact: true }).fill('Service rollout')
    await first.getByLabel('Description', { exact: true }).fill('Initial workspace description')
    await expect(first.getByRole('combobox', { name: 'Status', exact: true })).toBeDisabled()
    const slug = 'demo-workspace-' + suffix
    await first.getByLabel('Workspace URL').fill(slug)
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Invite your team' })).toBeVisible()
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByText('Invite at least one party.', { exact: true }).first()).toBeVisible()
    await first.getByLabel('Email addresses').fill('invalid-address')
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Not a valid email address' })).toBeVisible()
    await first.getByLabel('Email addresses').fill('team-' + suffix + '@example.com')
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Document', exact: true })).toBeVisible()
    await first.locator('input[type=file]').setInputFiles({
      name: 'First workspace contract.pdf',
      mimeType: 'application/pdf',
      buffer: workspacePdf,
    })
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'Review and create' })).toBeVisible()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(first.locator('[data-type=error]').filter({ hasText: 'Acknowledge the preview to create the workspace.' })).toBeVisible()
    await first.getByRole('checkbox', { name: /I understand/ }).check()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(first.getByRole('img', { name: 'Page 1' })).toBeVisible()
    const headerTools = first.getByRole('banner').getByRole('toolbar', { name: 'Canvas tools' })
    const artboard = first.getByRole('article', { name: 'Contract artboard' })
    await expect(headerTools).toContainText('100%')
    await expect(artboard).toHaveCSS('zoom', '1')
    const sourceApi = '/api' + new URL(first.url()).pathname
    const drawing = first.getByRole('img', { name: 'Drawing annotations on sheet 1', exact: true })
    await expect(drawing).toBeVisible()
    for (const label of ['Pen', 'Brush', 'Highlighter', 'Underline', 'Strikethrough']) {
      await headerTools.getByRole('button', { name: label, exact: true }).click()
      const bounds = requiredValue(await drawing.boundingBox())
      await first.mouse.move(bounds.x + 100, bounds.y + 100)
      await first.mouse.down()
      await first.mouse.move(bounds.x + 170, bounds.y + 110, { steps: 5 })
      await first.mouse.up()
      await expect
        .poll(
          async () =>
            requiredValue((await first.request.get(sourceApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))).annotations).length,
        )
        .toBe(['Pen', 'Brush', 'Highlighter', 'Underline', 'Strikethrough'].indexOf(label) + 1)
    }
    await headerTools.getByRole('button', { name: 'Undo', exact: true }).click()
    await expect
      .poll(
        async () =>
          requiredValue(
            requiredValue(await first.request.get(sourceApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))).annotations?.at(-1),
          ).withdrawn,
      )
      .toBe(true)
    await headerTools.getByRole('button', { name: 'Redo', exact: true }).click()
    await expect
      .poll(
        async () =>
          requiredValue(
            requiredValue(await first.request.get(sourceApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))).annotations?.at(-1),
          ).withdrawn,
      )
      .toBe(false)
    await first.reload()
    await expect(drawing).toBeVisible()
    const drawings = (await first.request.get(sourceApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))).annotations
    expect(requiredValue(drawings).map((item) => requiredValue(item.markup).tool)).toEqual(['pen', 'brush', 'highlight', 'underline', 'strikethrough'])
    for (const item of requiredValue(drawings)) {
      expect((await post(first.request, sourceApi + '/annotation', { action: 'decide', id: item.id, decision: 'Approved' })).status()).toBe(200)
    }
    const markedView = await first.request.get(sourceApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))
    const markedPdf = await first.request.get(sourceApi + '/negotiated-pdf/' + requiredValue(markedView.negotiatedPdf).digest)
    expect(markedPdf.status()).toBe(200)
    expect((await markedPdf.body()).equals(workspacePdf)).toBe(false)
    expect(
      (
        await post(first.request, sourceApi + '/annotation', { action: 'visibility', id: requiredValue(requiredValue(drawings)[0]).id, withdrawn: true })
      ).status(),
    ).toBe(409)
    await expect(first.getByRole('group', { name: 'PDF page 1', exact: true })).toHaveAttribute('aria-busy', 'false')
    await headerTools.getByRole('combobox', { name: 'Zoom' }).click()
    await first.getByRole('option', { name: '60%', exact: true }).click()
    await expect(artboard).toHaveCSS('zoom', '0.6')
    const firstSheet = first.getByRole('group', { name: 'PDF page 1', exact: true })
    const secondSheet = first.getByRole('group', { name: 'PDF page 2', exact: true })
    await expect(firstSheet).toHaveCSS('border-bottom-style', 'solid')
    const firstBounds = await firstSheet.boundingBox()
    const secondBounds = await secondSheet.boundingBox()
    expect(requiredValue(secondBounds).y - (requiredValue(firstBounds).y + requiredValue(firstBounds).height)).toBeGreaterThan(8)
    const initialContract = new URL(first.url()).pathname
    await first.goto('/?workspaceSlug=' + slug)
    await expect(first.getByRole('heading', { name: 'Demo workspace' })).toBeVisible()
    await expect(first.getByRole('link', { name: 'First workspace contract', exact: true })).toHaveAttribute('href', initialContract)
    const entries = workspacesSchema.parse(await (await first.request.get(origin + '/api/workspaces')).json())
    const workspaceId = entries.find((item) => item.slug === slug)?.id
    expect(workspaceId).toBeTruthy()
    const duplicateSlug = await post(first.request, '/api/workspaces', {
      name: 'Another workspace',
      requestId: crypto.randomUUID(),
      slug,
      ...workspaceFixture(),
    })
    expect(duplicateSlug.status()).toBe(409)
    const inaccessibleWorkspace = await post(second.request, '/api/contracts', {
      title: 'Unauthorized workspace contract',
      requestId: crypto.randomUUID(),
      workspaceId,
    })
    expect(inaccessibleWorkspace.status()).toBe(404)
    const unassignedWorkspace = await post(first.request, '/api/workspaces', {
      name: 'Unassigned workspace',
      requestId: crypto.randomUUID(),
      ...workspaceFixture(),
    })
    expect(unassignedWorkspace.status()).toBe(201)
    await expect(appHeader).toHaveCSS('height', '36px')
    await first.getByRole('button', { name: 'Add document' }).click()
    await first.getByLabel('Contract title').fill('Services agreement')
    await first.getByRole('button', { name: 'Create contract', exact: true }).click()
    await expect(first.getByRole('textbox', { name: 'Contract document' })).toBeVisible()
    await expect(appHeader.getByRole('link', { name: 'Clausid', exact: true })).toBeVisible()
    await expect(appHeader.getByRole('button', { name: 'Account settings' })).toBeVisible()
    await expect(appHeader.getByRole('button', { name: 'Menu', exact: true })).toBeVisible()
    await expect(appHeader.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(appHeader.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
    const desktopViewport = requiredValue(first.viewportSize())
    for (const width of [desktopViewport.width, 641, 390, 320]) {
      await first.setViewportSize({ width, height: desktopViewport.height })
      await expect(headerTools).toBeVisible()
      await expect
        .poll(() =>
          headerTools.evaluate((element) => {
            const toolbar = element.closest('[aria-label="Editor tools"]')
            if (!toolbar) {
              throw new Error('Editor tools are missing.')
            }
            const bounds = toolbar.getBoundingClientRect()
            return Math.abs((bounds.left + bounds.right - innerWidth) / 2)
          }),
        )
        .toBeLessThan(8)
      await expect(appHeader).toHaveCSS('height', '36px')
      await expect(appHeader.getByRole('button', { name: 'Export', exact: true })).toBeVisible()
      await expect(appHeader.getByRole('button', { name: 'Account settings' })).toBeVisible()
    }
    const peopleTool = first.getByRole('button', { name: 'People', exact: true })
    await peopleTool.focus()
    await peopleTool.press('Enter')
    await expect(first.getByRole('dialog', { name: 'People', exact: true })).toBeVisible()
    await first.keyboard.press('Escape')
    await expect(peopleTool).toBeFocused()
    await first.setViewportSize(desktopViewport)
    const canvas = first.locator('.contract-editor')
    await expect(canvas).toBeVisible()
    expect(
      await canvas.evaluate((element) => {
        const bounds = element.getBoundingClientRect()
        return bounds.top > 0 && bounds.left === 0 && bounds.width === innerWidth && Math.abs(bounds.bottom - innerHeight) < 1
      }),
    ).toBe(true)
    await expect(first.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(first.getByLabel('Document navigation', { exact: true })).toBeVisible()
    await expect(first.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()
    await expect(first.locator('article[aria-label="Contract artboard"]').getByRole('textbox', { name: 'Contract document' })).toHaveCount(1)
    await expect(first.getByRole('button', { name: 'Template preview', exact: true })).toHaveCount(0)
    const textEditor = first.getByRole('textbox', { name: 'Contract document' })
    await textEditor.press('End')
    for (const [label, tag] of [
      ['Bold', 'strong'],
      ['Italic', 'em'],
      ['Underline', 'u'],
      ['Strikethrough', 's'],
    ] as const) {
      const tool = headerTools.getByRole('button', { name: label, exact: true })
      await tool.click()
      await expect(tool).toHaveAttribute('aria-pressed', 'true')
      await first.keyboard.insertText(label)
      await expect(textEditor.locator(tag)).toContainText(label)
      await tool.click()
      await expect(tool).toHaveAttribute('aria-pressed', 'false')
    }
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
      if (suspended) {
        void socket.close({ code: 4000 })
        return
      }
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
    const draftText = (editor: typeof firstEditor) =>
      editor.evaluate((element) => {
        const copy = element.cloneNode(true)
        if (!(copy instanceof HTMLElement)) {
          throw new Error('Expected a cloned editor element.')
        }
        copy.querySelectorAll('.collaboration-carets__caret').forEach((caret) => caret.remove())
        return copy.textContent
      })
    await expect.poll(() => draftText(firstEditor)).toMatch(/Services.*Terms|Terms.*Services/)
    await expect.poll(async () => (await draftText(firstEditor)) === (await draftText(secondEditor))).toBe(true)
    await expect(first.locator('.collaboration-carets__label')).toHaveText('Editor Lee')
    suspended = true
    await requiredValue(editorSocket).close({ code: 4000, reason: 'Test disconnect' })
    await expect(second.getByText('Reconnecting…', { exact: true })).toBeVisible()
    await secondEditor.press('End')
    await secondEditor.pressSequentially(' Offline clause.')
    expect(await draftText(firstEditor)).not.toContain('Offline clause.')
    suspended = false
    await expect.poll(() => draftText(firstEditor)).toContain('Offline clause.')
    await expect(first.getByText('Saved', { exact: true })).toBeVisible()
    const stale = contractViewSchema.parse(await (await first.request.get(origin + apiPath)).json())
    const early = await post(first.request, apiPath + '/preview', { revision: stale.revision, signers: [ownerEmail] })
    expect(early.status(), await early.text()).toBe(200)
    const oldPreview = previewSchema.parse(await early.json())
    await firstEditor.press('End')
    await firstEditor.pressSequentially(' Updated clause.')
    await expect.poll(() => draftText(secondEditor)).toContain('Updated clause.')
    expect((await post(first.request, apiPath + '/freeze', { previewId: oldPreview.id })).status()).toBe(409)

    await headerTools.getByRole('button', { name: 'Signature', exact: true }).click()
    await first.getByLabel('Signer email addresses').fill([ownerEmail, editorEmail].join('\n'))
    await first.getByRole('button', { name: 'Generate PDF preview' }).click()
    const previewLink = first.getByRole('link', { name: 'Open preview in a new tab' })
    await expect(previewLink).toBeVisible()
    const previewBytes = await (await first.request.get(origin + (await previewLink.getAttribute('href')))).body()
    expect(previewBytes.subarray(0, 4).toString()).toBe('%PDF')
    await first.getByRole('button', { name: 'Freeze and send' }).click()
    await expect(first.getByText('Awaiting signatures', { exact: true })).toBeVisible()
    await expect(appHeader.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(first.getByLabel('Document navigation', { exact: true })).toBeVisible()
    await expect(first.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()
    const frozenPage = first.getByRole('article', { name: 'Contract artboard' }).getByRole('group', { name: 'PDF page 1' })
    await expect(frozenPage.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await expect(frozenPage).toHaveAttribute('aria-busy', 'false')
    await expect(frozenPage).toContainText('Updated clause.')
    await expect(first.locator('article[aria-label="Contract artboard"] iframe')).toHaveCount(0)
    await expect(first.getByText('The draft is unavailable or the update is too large.')).toHaveCount(0)
    await expect(firstEditor).toHaveCount(0)

    await expect(second.getByText('Access to this contract ended.', { exact: true })).toBeVisible()
    const signingLink = await linkFor(editorEmail, 'invite', { exclude: invitation })
    // The valid signing link is the latest invitation for the recipient.
    expect(signingLink).not.toBe(invitation)
    await second.goto(signingLink)
    await second.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(second.getByRole('heading', { name: 'Signatures' })).toHaveCount(0)
    await second.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(second.getByRole('menuitem', { name: 'Sign contract' })).toBeVisible()
    await second.keyboard.press('Escape')
    await second.getByRole('toolbar', { name: 'Canvas tools' }).getByRole('button', { name: 'Signature', exact: true }).click()
    const signerDialog = second.getByRole('dialog', { name: 'Signatures' })
    await expect(signerDialog.getByLabel('Full name')).toBeVisible()
    await expect(signerDialog.getByRole('checkbox')).not.toBeChecked()
    await signerDialog.getByRole('button', { name: 'Done' }).click()
    await expect(second.getByRole('group', { name: 'Open documents' })).toContainText('Services agreement')
    await expect(second.getByRole('img', { name: 'Page 1' })).toBeVisible()

    const version = contractViewSchema.parse(await (await first.request.get(origin + apiPath)).json()).version
    const frozenBytes = await (await first.request.get(origin + apiPath + '/pdf')).body()
    expect(frozenBytes.equals(previewBytes)).toBe(true)
    expect(createHash('sha256').update(frozenBytes).digest('hex')).toBe(requiredValue(version).digest)
    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await first.getByRole('menuitem', { name: 'Sign contract' }).click()
    await expect(first.getByRole('dialog', { name: 'Signatures' })).toBeVisible()
    await first.getByLabel('Full name').fill('Owner Lee')
    await first.getByRole('checkbox').check()
    await first.getByRole('button', { name: 'Sign contract' }).click()
    await expect(first.getByRole('button', { name: 'Sign contract' })).toHaveCount(0)
    expect((await post(first.request, apiPath + '/delete', {})).status()).toBe(409)
    const signature = { versionId: requiredValue(version).id, digest: requiredValue(version).digest, name: 'Editor Lee', consent: true, consentVersion }
    expect((await post(second.request, apiPath + '/sign', { ...signature, digest: '0'.repeat(64) })).status()).toBe(409)
    const responses = await Promise.all([post(second.request, apiPath + '/sign', signature), post(second.request, apiPath + '/sign', signature)])
    for (const response of responses) {
      expect(response.status(), await response.text()).toBe(200)
    }
    await expect(first.getByRole('status').filter({ hasText: /^Signed$/ })).toBeVisible()
    await expect(first.getByRole('link', { name: 'Back to contracts' })).toHaveCount(0)
    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(first.getByRole('menuitem', { name: 'Download signing evidence' })).toBeVisible()
    await first.keyboard.press('Escape')
    const evidence = await second.request.get(origin + apiPath + '/evidence')
    expect(evidence.status()).toBe(200)
    const archive = unzipSync(await evidence.body())
    const record = evidenceSchema.parse(JSON.parse(strFromU8(requiredValue(archive['signing-evidence.json']))))
    expect(record.versionId).toBe(requiredValue(version).id)
    expect(record.sha256).toBe(requiredValue(version).digest)
    expect(record.signatures).toHaveLength(2)
    expect(new Set(record.signatures.map((entry: { email: string }) => entry.email))).toEqual(new Set([ownerEmail, editorEmail]))
    expect(record.signatures.every((entry: { digest: string }) => entry.digest === requiredValue(version).digest)).toBe(true)
    expect(Buffer.from(requiredValue(archive['contract.pdf'])).equals(frozenBytes)).toBe(true)
    await first.getByRole('button', { name: 'Close Services agreement' }).click()
    await expect(first.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
    await expect(first.getByRole('link', { name: 'All contracts' })).toHaveCount(0)
    const overview = first.getByRole('table', { name: 'Workspaces' })
    const workspaceRow = overview.getByRole('row').filter({ hasText: 'Demo workspace' })
    await expect(overview.getByRole('button', { name: /collapse.*Draft/i })).toHaveCount(0)
    await expect(workspaceRow.getByRole('cell', { name: 'Draft', exact: true })).toBeVisible()
    await first.getByRole('button', { name: 'View Options' }).click()
    const statusFilter = first.getByRole('combobox', { name: 'Status filter' })
    await expect(statusFilter).toContainText('All')
    await statusFilter.click()
    await first.getByRole('option', { name: 'Review', exact: true }).click()
    await expect(first.getByRole('heading', { name: 'No matching workspaces', exact: true })).toBeVisible()
    await statusFilter.click()
    await first.getByRole('option', { name: 'Draft', exact: true }).click()
    await expect(workspaceRow).toBeVisible()
    await statusFilter.click()
    await first.getByRole('option', { name: 'All', exact: true }).click()
    const projectFilter = first.getByRole('combobox', { name: 'Project filter' })
    const unassignedRow = overview.getByRole('row').filter({ hasText: 'Unassigned workspace' })
    await expect(projectFilter).toContainText('All projects')
    await expect(unassignedRow).toBeVisible()
    await expect(first.getByRole('radio', { name: 'None', exact: true })).toBeChecked()
    await first.getByRole('radio', { name: 'Project', exact: true }).click()
    await expect(overview.getByRole('button', { name: /collapse.*Service rollout/i })).toBeVisible()
    await expect(overview.getByRole('button', { name: /collapse.*No project/i })).toBeVisible()
    await projectFilter.click()
    await first.getByRole('option', { name: 'Service rollout', exact: true }).click()
    await expect(workspaceRow).toBeVisible()
    await expect(unassignedRow).toHaveCount(0)
    await expect(overview.getByRole('button', { name: /collapse.*No project/i })).toHaveCount(0)
    await projectFilter.click()
    await first.getByRole('option', { name: 'All projects', exact: true }).click()
    await expect(unassignedRow).toBeVisible()
    await first.getByRole('radio', { name: 'Status', exact: true }).click()
    await expect(overview.getByRole('button', { name: /collapse.*Draft/i })).toBeVisible()
    await first.getByRole('radio', { name: 'None', exact: true }).click()
    await expect(overview.getByRole('button', { name: /collapse.*Draft/i })).toHaveCount(0)
    await first.getByRole('radio', { name: 'Status', exact: true }).click()
    await expect(overview.getByRole('button', { name: /collapse.*Draft/i })).toBeVisible()
    await first.keyboard.press('Escape')

    await expect(overview.getByRole('columnheader', { name: 'Project', exact: true })).toBeVisible()
    await expect(workspaceRow.getByRole('cell', { name: 'Service rollout', exact: true })).toBeVisible()
    await expect(overview.getByRole('columnheader', { name: 'Created' })).toBeVisible()
    await expect(overview.getByRole('columnheader', { name: 'Updated' })).toBeVisible()
    await expect(overview.getByRole('columnheader', { name: 'Assignee' })).toBeVisible()
    await expect(workspaceRow).toContainText(ownerEmail)
    await workspaceRow.getByText(ownerEmail, { exact: true }).click()
    const details = first.getByRole('complementary', { name: 'Workspace details' })
    await expect(details.getByRole('heading', { name: 'Demo workspace' })).toBeVisible()
    expect(
      await details.evaluate((panel) => {
        const bounds = panel.getBoundingClientRect()
        return Math.abs(bounds.right - innerWidth) < 2 && Math.abs(bounds.bottom - innerHeight) < 2
      }),
    ).toBe(true)
    const workspaceContracts = details.getByRole('list', { name: 'Workspace contracts' })
    await expect(workspaceContracts.getByRole('listitem').filter({ hasText: 'Services agreement' })).toContainText('Signed')
    await expect(workspaceContracts.getByRole('link', { name: 'Services agreement' })).toHaveAttribute('href', contractPath)
    await details.getByRole('button', { name: 'Close panel' }).click()
    await expect(overview.getByRole('columnheader', { name: 'More options' })).toHaveCount(0)
    const unassignedActions = unassignedRow.getByRole('button', { name: 'Actions for Unassigned workspace' })
    const moveDialog = first.getByRole('dialog', { name: 'Move to project' })
    const moveProject = moveDialog.getByRole('combobox', { name: 'Project', exact: true })
    await unassignedActions.click()
    await first.getByRole('menuitem', { name: 'Move to project' }).click()
    await expect(moveProject).toContainText('No project')
    await expect
      .poll(() =>
        moveDialog.evaluate((dialog) => {
          const bounds = dialog.getBoundingClientRect()
          const headerItems = dialog.querySelectorAll('.astryx-dialog-header h2, .astryx-dialog-header button')
          return (
            headerItems.length === 2 &&
            Array.from(headerItems).every((item) => {
              const rect = item.getBoundingClientRect()
              return rect.left > bounds.left && rect.right < bounds.right && rect.top > bounds.top && rect.bottom < bounds.bottom
            })
          )
        }),
      )
      .toBe(true)
    await moveProject.click()
    await first.getByRole('option', { name: 'Service rollout', exact: true }).click()
    await moveDialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(unassignedRow.getByRole('cell', { name: 'Service rollout', exact: true })).toBeVisible()
    await unassignedActions.click()
    await first.getByRole('menuitem', { name: 'Move to project' }).click()
    await expect(moveProject).toContainText('Service rollout')
    await moveProject.click()
    await first.getByRole('option', { name: 'No project', exact: true }).click()
    await moveDialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(unassignedRow.getByRole('cell', { name: 'Service rollout', exact: true })).toHaveCount(0)
    await workspaceRow.getByRole('button', { name: 'Actions for Demo workspace' }).click()
    await expect(first.getByRole('menuitem', { name: /^Assign to/ })).toBeVisible()
    await first.getByRole('menuitem', { name: 'Edit', exact: true }).click()
    await expect(first).toHaveURL(origin + '/workspaces/' + workspaceId + '/edit')
    await expect(first.getByRole('heading', { name: 'Edit workspace', exact: true })).toBeVisible()
    await expect(first.getByLabel('Workspace name')).toHaveValue('Demo workspace')
    const workspaceURL = first.getByRole('textbox', { name: /^Workspace URL/ })
    await expect(workspaceURL).toHaveValue(origin + '/?workspaceSlug=' + slug)
    await expect(workspaceURL).not.toBeEditable()
    await expect(first.getByRole('combobox', { name: 'Data region', exact: true })).toBeDisabled()
    await expect(first.getByRole('radio', { name: 'Invite only', exact: true })).toBeDisabled()
    await expect(first.getByLabel('Description', { exact: true })).toHaveValue('Initial workspace description')
    await first.getByLabel('Project', { exact: true }).fill('Signed services')
    await first.getByLabel('Description').fill('Contract review and signing')
    await first.getByRole('combobox', { name: 'Status', exact: true }).click()
    await first.getByRole('option', { name: 'Closed', exact: true }).click()
    const next = first.getByRole('button', { name: 'Next', exact: true })
    await next.click()
    await expect(first.getByRole('heading', { name: 'Invite your team' })).toBeVisible()
    await expect(first.getByLabel('Email addresses', { exact: true })).not.toBeEditable()
    await next.click()
    await expect(first.getByRole('heading', { name: 'Document', exact: true })).toBeVisible()
    await expect(first.getByRole('button', { name: /^PDF document/ })).toBeDisabled()
    await next.click()
    await expect(first.getByRole('heading', { name: 'Review changes' })).toBeVisible()
    await expect(first.getByText('Signed services', { exact: true })).toBeVisible()
    await expect(first.getByRole('checkbox', { name: /I understand/ })).toBeDisabled()
    const customizeRequest = first.waitForRequest(
      (request) => request.method() === 'POST' && new URL(request.url()).pathname === '/api/workspaces/' + workspaceId + '/customize',
    )
    await first.getByRole('button', { name: 'Save changes' }).click()
    expect((await customizeRequest).postDataJSON()).toEqual({
      project: 'Signed services',
      description: 'Contract review and signing',
      status: 'Closed',
    })
    await expect(first).toHaveURL(origin + '/')
    await expect(workspaceRow.getByRole('cell', { name: 'Closed', exact: true })).toBeVisible()
    expect((await post(first.request, '/api/workspaces/' + workspaceId + '/delete', {})).status()).toBe(409)
    await workspaceRow.getByRole('button', { name: 'Actions for Demo workspace' }).click()
    await first.getByRole('menuitem', { name: 'Add label' }).click()
    const labelDialog = first.getByRole('dialog', { name: 'Add label' })
    await labelDialog.getByLabel(/^Label\b/).fill('Renewal')
    await labelDialog.getByRole('button', { name: 'Save changes' }).click()
    await expect(labelDialog).toHaveCount(0)
    await workspaceRow.getByRole('button', { name: 'Actions for Demo workspace' }).click()
    await first.getByRole('menuitem', { name: 'Duplicate', exact: true }).click()
    await first.getByRole('dialog', { name: 'Duplicate workspace' }).getByRole('button', { name: 'Duplicate', exact: true }).click()
    const duplicateAction = overview.getByRole('button', { name: 'Actions for Demo workspace (copy)', exact: true })
    await duplicateAction.click()
    await first.getByRole('menuitem', { name: 'Delete workspace' }).click()
    await first.getByRole('dialog', { name: 'Delete workspace' }).getByRole('button', { name: 'Delete workspace', exact: true }).click()
    await expect(duplicateAction).toHaveCount(0)
    await first.goto('/contracts')
    await expect(first).toHaveURL(origin + '/')
    await expect(workspaceRow.getByRole('cell', { name: 'Closed', exact: true })).toBeVisible()
    await expect(overview.getByRole('button', { name: /collapse.*Closed/i })).toHaveCount(0)
    await workspaceRow.getByRole('button', { name: 'Demo workspace', exact: true }).click()
    await expect(details.getByText('Contract review and signing')).toBeVisible()
    await expect(details.getByText('Signed services', { exact: true })).toBeVisible()
    await expect(details.getByText('Renewal', { exact: true })).toBeVisible()
    await expect(duplicateAction).toHaveCount(0)
    await details.getByRole('link', { name: 'Open workspace', exact: true }).click()
    const list = first.getByRole('table', { name: 'Your contracts' })
    await expect(list.getByRole('row').filter({ hasText: 'Services agreement' })).toContainText('Signed')
    await expect(list.getByRole('link', { name: 'Services agreement' })).toHaveAttribute('href', contractPath)
    await list.getByRole('button', { name: 'Actions for Services agreement' }).click()
    await expect(first.getByRole('menuitem', { name: /^Delete contract/ })).toBeDisabled()
    await first.keyboard.press('Escape')
    expect((await post(first.request, apiPath + '/delete', {})).status()).toBe(409)
    expect(await (await first.request.get(apiPath + '/pdf')).body()).toEqual(frozenBytes)
    await first.setViewportSize({ width: 390, height: desktopViewport.height })
    await list.getByRole('link', { name: 'Services agreement' }).click()
    await expect(first.getByRole('heading', { name: 'Services agreement' })).toHaveCount(1)
    await expect(first.getByText('Signed', { exact: true }).filter({ visible: true }).last()).toBeVisible()
    await expect(first.getByRole('toolbar', { name: 'Canvas tools' })).toBeVisible()
    await expect(frozenPage.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(first.getByRole('menuitem', { name: 'Download signing evidence' })).toBeVisible()
    await expect(firstEditor).toHaveCount(0)

    await second.goto('/')
    const sharedContracts = second.getByRole('table', { name: 'Contracts outside your workspaces' })
    await expect(sharedContracts.getByRole('row').filter({ hasText: 'Services agreement' })).toContainText('Signed')
    await expect(sharedContracts.getByRole('link', { name: 'Services agreement' })).toHaveAttribute('href', contractPath)

    await first.setViewportSize(desktopViewport)
    await first.goto('/workspaces/new')
    await first.getByLabel('Workspace name').fill('Workspace with a PDF')
    await first.getByLabel('Workspace URL').fill('supplied-pdf-' + suffix)
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await first.getByLabel('Email addresses').fill(editorEmail)
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await first.locator('input[type=file]').setInputFiles({ name: 'Source agreement.pdf', mimeType: 'application/pdf', buffer: workspacePdf })
    await first.getByRole('button', { name: 'Next', exact: true }).click()
    await expect(first.getByText('Source agreement.pdf', { exact: true })).toBeVisible()
    await first.getByRole('checkbox', { name: /I understand/ }).check()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()
    await expect(first.getByRole('img', { name: 'Page 1' })).toBeVisible()
    const sourcePath = new URL(first.url()).pathname
    const source = await first.request.get('/api' + sourcePath + '/source-pdf')
    expect(source.status()).toBe(200)
    expect(await source.body()).toEqual(workspacePdf)
    expect((await second.request.get('/api' + sourcePath + '/source-pdf')).status()).toBe(404)
    await second.goto(await linkFor(editorEmail, 'workspace'))
    await second.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(second).toHaveURL(origin + sourcePath)
    await expect(second.getByRole('img', { name: 'Page 1' })).toBeVisible()

    const reviewerViewport = requiredValue(second.viewportSize())
    await second.setViewportSize({ width: 390, height: 844 })
    const collaborationRail = second.getByLabel('Collaboration tools', { exact: true })
    const icons = collaborationRail.getByRole('button')
    for (const [index, label] of ['Comments', 'Suggestions', 'People'].entries()) {
      await expect(icons.nth(index)).toHaveAccessibleName(label)
      await icons.nth(index).tap()
      const drawer = second.getByRole('dialog', { name: label, exact: true })
      await expect(drawer).toBeVisible()
      const closeDrawer = drawer.getByRole('button', { name: /^Close/i })
      await expect(closeDrawer).toBeInViewport({ ratio: 1 })
      if (label === 'People') {
        await second.screenshot({ path: test.info().outputPath('mobile-people.png'), animations: 'disabled' })
      }
      await closeDrawer.tap()
      await expect(drawer).toBeHidden()
    }
    await second.setViewportSize(reviewerViewport)
    await expect(second.getByRole('button', { name: 'Signature', exact: true })).toBeDisabled()
    const pageTwo = second.getByRole('group', { name: 'PDF page 2', exact: true })
    await pageTwo.scrollIntoViewIfNeeded()
    const sourceLine = pageTwo.locator('[data-pdf-item]').filter({ hasText: /^15 days$/ })
    await expect(sourceLine).toBeVisible()
    const words = requiredValue(await sourceLine.boundingBox())
    await second.mouse.move(words.x + 0.5, words.y + words.height / 2)
    await second.mouse.down()
    await second.mouse.move(words.x + words.width - 0.5, words.y + words.height / 2, { steps: 8 })
    await second.mouse.up()
    await expect(second.getByRole('textbox', { name: 'Text to replace' })).toHaveValue('15 days')
    await second.getByRole('textbox', { name: 'Replacement text' }).fill('30 days')
    await second.getByRole('textbox', { name: 'Annotation', exact: true }).fill('Confirm the delivery schedule.')
    await second.getByRole('button', { name: 'Submit suggestion' }).click()
    await expect(second.getByRole('textbox', { name: 'Annotation', exact: true })).toHaveValue('')
    await expect(second.getByText('Confirm the delivery schedule.', { exact: true })).toBeVisible()
    const annotated = contractViewSchema.parse(await (await second.request.get('/api' + sourcePath)).json())
    const annotation = requiredValue(annotated.annotations)[0]
    const retryId = crypto.randomUUID()
    const overlapping = {
      action: 'add',
      requestId: retryId,
      page: 2,
      text: 'Alternative date',
      displayedDigest: requiredValue(annotated.sourcePdf).digest,
      replacement: { block: 1, expected: '15 days', replacement: '20 days' },
    }
    const endpoint = '/api' + sourcePath + '/annotation'
    const alternative = await post(second.request, endpoint, overlapping)
    expect(alternative.status()).toBe(200)
    const secondProposal = requiredValue(contractViewSchema.parse(await alternative.json()).annotations).at(-1)
    expect(contractViewSchema.parse(await (await post(second.request, endpoint, overlapping)).json()).annotations).toHaveLength(2)
    expect((await post(second.request, endpoint, { ...overlapping, text: 'different payload' })).status()).toBe(409)
    expect(requiredValue(annotation).page).toBe(2)
    expect(
      (
        await post(second.request, '/api' + sourcePath + '/annotation', {
          action: 'decide',
          id: requiredValue(annotation).id,
          decision: 'Approved',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await post(first.request, '/api' + sourcePath + '/preview', {
          revision: annotated.revision,
          signers: [ownerEmail],
        })
      ).status(),
    ).toBe(409)
    await first.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await expect(first.getByText('Confirm the delivery schedule.')).toBeVisible()
    await first.getByRole('button', { name: 'Reply', exact: true }).first().click()
    await first.getByRole('textbox', { name: 'Reply to annotation' }).fill('The schedule is accepted.')
    await first.getByRole('button', { name: 'Post reply' }).click()
    await expect(second.getByText('The schedule is accepted.')).toBeVisible()
    await first.getByRole('button', { name: 'Approve', exact: true }).first().click()
    await expect(second.getByText('Approved', { exact: true })).toBeVisible()
    const reviewerPage = second.getByRole('group', { name: 'Clean negotiated PDF' }).getByRole('group', { name: 'PDF page 2', exact: true })
    await reviewerPage.scrollIntoViewIfNeeded()
    await expect(reviewerPage).toContainText('Pay in 30 days')
    const approvedState = await first.request.get('/api' + sourcePath).then((r) => r.json().then((data) => contractViewSchema.parse(data)))
    expect((await post(first.request, endpoint, { action: 'decide', id: requiredValue(secondProposal).id, decision: 'Approved' })).status()).toBe(422)
    const failedApproval = await first.request.get('/api' + sourcePath).then((r) => r.json().then((data) => contractViewSchema.parse(data)))
    expect(requiredValue(failedApproval.negotiatedPdf).digest).toBe(requiredValue(approvedState.negotiatedPdf).digest)
    expect(requiredValue(requiredValue(failedApproval.annotations).at(-1)).decision).toBeUndefined()
    expect((await post(second.request, endpoint, { ...overlapping, requestId: crypto.randomUUID() })).status()).toBe(409)
    expect((await post(first.request, endpoint, { action: 'decide', id: requiredValue(secondProposal).id, decision: 'Rejected' })).status()).toBe(200)
    await first.getByRole('button', { name: 'Index', exact: true }).click()
    await first.getByRole('textbox', { name: 'Search index' }).fill('30 days')
    await first.getByText('Page 2 · 30 days', { exact: true }).click()
    await expect.poll(() => first.evaluate(() => window.getSelection()?.toString())).toBe('30 days')
    await first.screenshot({ path: test.info().outputPath('negotiated-editor.png') })
    await first.getByLabel('Suggestions panel', { exact: true }).getByRole('button', { name: 'Close Suggestions', exact: true }).click()
    const cleanCanvas = first.getByRole('group', { name: 'Clean negotiated PDF' })
    await cleanCanvas.getByRole('group', { name: 'PDF page 2', exact: true }).scrollIntoViewIfNeeded()
    await expect(cleanCanvas).toContainText('Pay in 30 days')
    await expect(cleanCanvas).toContainText('Pay in 15 days')
    const resolved = contractViewSchema.parse(await (await first.request.get('/api' + sourcePath)).json())
    expect(requiredValue(requiredValue(resolved.annotations)[0]).edit).toMatchObject({ expected: '15 days', replacement: '30 days', block: 1 })
    const negotiated = await first.request.get('/api' + sourcePath + '/negotiated-pdf/' + requiredValue(resolved.negotiatedPdf).digest)
    expect(negotiated.status()).toBe(200)
    const negotiatedBytes = await negotiated.body()
    expect(negotiatedBytes.equals(workspacePdf)).toBe(false)
    expect(await (await first.request.get('/api' + sourcePath + '/source-pdf')).body()).toEqual(workspacePdf)
    await first.getByRole('button', { name: 'Export', exact: true }).click()
    await first.getByRole('menuitem', { name: 'Prepare for signing', exact: true }).click()
    await first.getByLabel(/^Signer email addresses/).fill(ownerEmail)
    const reviewResponse = first.waitForResponse(
      (response) => response.request().method() === 'POST' && new URL(response.url()).pathname === '/api' + sourcePath + '/preview',
    )
    await first.getByRole('button', { name: 'Generate PDF preview' }).click()
    const cleanPreview = await reviewResponse
    expect(cleanPreview.status()).toBe(200)
    const { id: sourcePreview, digest } = previewSchema.parse(await cleanPreview.json())
    expect(digest).toBe(requiredValue(resolved.negotiatedPdf).digest)
    await first.getByRole('group', { name: 'Signing preview PDF' }).getByRole('group', { name: 'PDF page 2', exact: true }).scrollIntoViewIfNeeded()
    await expect(first.getByRole('group', { name: 'Signing preview PDF' })).toContainText('Pay in 30 days')
    expect(await (await first.request.get('/api' + sourcePath + '/preview/' + sourcePreview)).body()).toEqual(negotiatedBytes)
    await first.getByRole('button', { name: 'Freeze and send' }).click()
    await expect(first.getByRole('status').filter({ hasText: /^Awaiting signatures$/ })).toBeVisible()
    expect(
      (
        await post(first.request, '/api' + sourcePath + '/sign', {
          versionId: sourcePreview,
          digest,
          name: 'Owner Lee',
          consent: true,
          consentVersion,
        })
      ).status(),
    ).toBe(200)
    expect(await (await first.request.get('/api' + sourcePath + '/pdf')).body()).toEqual(negotiatedBytes)
    const pdfEvidence = unzipSync(await (await first.request.get('/api' + sourcePath + '/evidence')).body())
    expect(createHash('sha256').update(requiredValue(pdfEvidence['contract.pdf'])).digest('hex')).toBe(digest)
    expect(evidenceSchema.parse(JSON.parse(strFromU8(requiredValue(pdfEvidence['signing-evidence.json'])))).sha256).toBe(digest)
    await second.reload()
    await expect(second.getByRole('img', { name: 'Page 1' })).toBeVisible()
    await second.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await expect(second.getByText('Approved', { exact: true })).toBeVisible()
    await expect(second.getByText('Original: 15 days', { exact: true })).toHaveCount(2)
    await expect(second.getByText('Replacement: 30 days', { exact: true })).toBeVisible()
    await expect(second.getByRole('button', { name: 'Submit suggestion' })).toHaveCount(0)
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
  const requestId = crypto.randomUUID()
  try {
    await Promise.all([account(owner, 'Service Provider', ownerEmail), account(party, 'Negotiating Party', partyEmail)])
    const input = { name: 'Negotiation workspace', requestId, ...workspaceFixture() }
    const [created, retried, other] = await Promise.all([
      post(owner.request, '/api/workspaces', input),
      post(owner.request, '/api/workspaces', input),
      post(party.request, '/api/workspaces', { name: 'Separate workspace', requestId, ...workspaceFixture() }),
    ])
    for (const response of [created, retried, other]) {
      expect(response.status()).toBe(201)
    }
    const { id } = workspaceSchema.parse(await created.json())
    const { id: otherId } = workspaceSchema.parse(await other.json())
    expect(id).not.toBe(requestId)
    expect(otherId).not.toBe(id)
    expect(workspaceSchema.parse(await retried.json()).id).toBe(id)
    expect(await (await owner.request.get(origin + '/api/workspaces/' + id + '/parties')).json()).toMatchObject({ parties: [{ email: ownerEmail }] })
    expect(await (await party.request.get(origin + '/api/workspaces/' + otherId + '/parties')).json()).toMatchObject({ parties: [{ email: partyEmail }] })
    expect((await party.request.get(origin + '/api/workspaces/' + id + '/parties')).status()).toBe(404)
    expect((await owner.request.get(origin + '/api/workspaces/' + otherId + '/parties')).status()).toBe(404)
    await owner.goto('/')
    await owner.getByRole('button', { name: 'Negotiation workspace', exact: true }).click()
    await owner.getByRole('complementary', { name: 'Workspace details' }).getByRole('link', { name: 'Open workspace', exact: true }).click()
    await owner.getByRole('button', { name: 'Share workspace' }).click()
    await owner.getByLabel('Party email').fill(partyEmail)
    await owner.getByRole('button', { name: 'Invite party' }).click()
    await expect(owner.getByText('Workspace invitation sent.')).toBeVisible()
    const invitation = await linkFor(partyEmail, 'workspace')
    const token = new URLSearchParams(new URL(invitation).hash.slice(1)).get('token')
    expect((await post(owner.request, '/api/workspaces/' + id + '/redeem', { token })).status()).toBe(404)
    await party.goto(invitation)
    await party.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(party).toHaveURL(origin + '/contracts/' + id)
    await party.goto('/?workspace=' + id)
    await expect(party.getByRole('heading', { name: 'Negotiation workspace' })).toBeVisible()
    const roster = workspacePartiesSchema.parse(await (await owner.request.get(origin + '/api/workspaces/' + id + '/parties')).json())
    const assigned = roster.parties.find((member: { email: string }) => member.email === partyEmail)
    const customization = { name: input.name, description: 'Shared review', status: 'On hold', assigneeId: requiredValue(assigned).id }
    expect((await post(party.request, '/api/workspaces/' + id + '/customize', customization)).status()).toBe(403)
    const unauthorizedEdit = await party.context().newPage()
    await unauthorizedEdit.goto('/workspaces/' + id + '/edit')
    await expect(unauthorizedEdit.getByText('Workspace unavailable', { exact: true }).first()).toBeVisible()
    await unauthorizedEdit.close()
    expect((await post(owner.request, '/api/workspaces/' + id + '/customize', customization)).status()).toBe(200)
    expect((await post(owner.request, '/api/workspaces/' + id + '/delete', {})).status()).toBe(409)
    await expect
      .poll(async () => {
        const rows = workspacesSchema.parse(await (await party.request.get(origin + '/api/workspaces')).json())
        return rows.find((workspace: { id: string }) => workspace.id === id)
      })
      .toMatchObject({ status: 'On hold', assignee: { email: partyEmail }, role: 'member' })

    await expect(party.getByRole('button', { name: 'Add document' })).toHaveCount(0)
    expect(
      (
        await post(party.request, '/api/contracts', {
          title: 'Unauthorized draft',
          requestId: crypto.randomUUID(),
          workspaceId: id,
        })
      ).status(),
    ).toBe(403)
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
    await expect(party.getByRole('link', { name: 'Draft proposal', exact: true })).toHaveCount(0)
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
    // Select the last sentence and negotiate a native replacement in two sessions.
    await partyEditor.evaluate((element) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
      for (let node = walker.nextNode(); node; node = walker.nextNode()) {
        const offset = (node.textContent ?? '').indexOf('45 days.')
        if (offset < 0) {
          continue
        }
        const range = document.createRange()
        range.setStart(node, offset)
        range.setEnd(node, offset + 8)
        const selection = getSelection()
        if (!selection) {
          throw new Error('Browser selection is missing.')
        }
        selection.removeAllRanges()
        selection.addRange(range)
        return
      }
      throw new Error('Counterproposal not found.')
    })
    await party.getByRole('button', { name: 'Comment on selection' }).click()
    await party.getByRole('textbox', { name: 'Comment', exact: true }).fill('Check the settlement period.')
    await party.getByRole('button', { name: 'Post comment' }).click()
    await expect(party.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('')
    await expect(party.getByText('Check the settlement period.', { exact: true })).toBeVisible()
    await party.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await party.getByRole('textbox', { name: 'Replacement text' }).fill('60 days.')
    await party.getByRole('button', { name: 'Submit suggestion' }).click()
    await expect(party.getByText('Replacement: 60 days.', { exact: true })).toBeVisible()
    const nativeApi = '/api' + contractPath
    const openNative = await owner.request.get(nativeApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))
    expect((await post(owner.request, nativeApi + '/preview', { revision: openNative.revision, signers: [ownerEmail] })).status()).toBe(409)
    await owner.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await owner.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(ownerEditor).toContainText('Counterproposal: 60 days.')
    await expect(partyEditor).toContainText('Counterproposal: 60 days.')
    const reviewedNative = await owner.request.get(nativeApi).then((r) => r.json().then((data) => contractViewSchema.parse(data)))
    expect((await post(owner.request, nativeApi + '/preview', { revision: reviewedNative.revision, signers: [ownerEmail] })).status()).toBe(200)
    const originalSuggestion = requiredValue(openNative.threads).find((item) => item.replacement === '60 days.')
    const staleReview = await post(owner.request, nativeApi + '/review', {
      requestId: crypto.randomUUID(),
      change: {
        action: 'add',
        anchor: requiredValue(originalSuggestion).anchor,
        replacement: '90 days.',
        text: '',
      },
    })
    expect(staleReview.status()).toBe(409)
    await owner.getByRole('button', { name: 'Close Suggestions', exact: true }).click()
    await party.getByRole('button', { name: 'Export', exact: true }).click()
    await expect(party.getByRole('menuitem', { name: 'Share', exact: true })).toBeDisabled()
    await expect(party.getByRole('menuitem', { name: 'Prepare for signing', exact: true })).toBeDisabled()
    for (const action of ['share-workspace', 'invite', 'preview', 'freeze']) {
      expect((await post(party.request, '/api' + contractPath + '/' + action, {})).status()).toBe(403)
    }

    await party.keyboard.press('Escape')
    await ownerEditor.click()
    await owner.getByRole('button', { name: 'Edit section', exact: true }).click()
    await owner.getByRole('textbox', { name: 'Section title' }).fill('Payment terms')
    await owner.getByRole('button', { name: 'Save section' }).click()
    await expect(party.getByRole('button', { name: 'Payment terms', exact: true })).toBeVisible()
    await party.reload()
    await expect(party.getByRole('button', { name: 'Payment terms', exact: true })).toBeVisible()
    const uploadedTitle = 'Studio Services Agreement'
    const originalPdf = await readFile(new URL('../packages/pdf-engine/tests/fixtures/pdf-lib-subset.pdf', import.meta.url))
    const workspacePath = '/?workspace=' + id
    await owner.goto(workspacePath)
    await owner.getByRole('button', { name: 'Add document' }).click()
    await owner.locator('input[type=file]').setInputFiles({
      name: uploadedTitle + '.pdf',
      mimeType: 'application/pdf',
      buffer: originalPdf,
    })
    await owner.getByRole('button', { name: 'Upload PDF', exact: true }).click()
    const sourceCanvas = owner.getByRole('group', { name: 'Contract PDF', exact: true })
    await expect(sourceCanvas).toContainText(/within\s+15\s+business\s+days/)
    const uploadedPath = new URL(owner.url()).pathname
    const uploadedApi = '/api' + uploadedPath
    expect((await party.request.get(uploadedApi + '/source-pdf')).status()).toBe(404)

    await owner.getByRole('button', { name: 'Export', exact: true }).click()
    await owner.getByRole('menuitem', { name: 'Share', exact: true }).click()
    await owner.getByRole('button', { name: 'Share with workspace' }).click()
    await expect(owner.getByText('Workspace parties can now edit this draft.')).toBeVisible()
    await owner.getByRole('button', { name: 'Done', exact: true }).click()
    await party.goto(workspacePath)
    await party.getByRole('link', { name: uploadedTitle, exact: true }).click()
    await expect(party).toHaveURL(origin + uploadedPath)

    await party.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await party.getByRole('combobox', { name: 'Source line' }).click()
    await party.getByRole('option', { name: /^\d+\. 15$/ }).click()
    await expect(party.getByRole('textbox', { name: 'Text to replace' })).toHaveValue('15')
    await party.getByRole('textbox', { name: 'Replacement text' }).fill('10')
    await party.getByRole('button', { name: 'Submit suggestion' }).click()
    await expect(party.getByText('Replacement: 10', { exact: true })).toBeVisible()
    const proposed = await party.request.get(uploadedApi).then((response) => response.json().then((data) => contractViewSchema.parse(data)))
    expect(
      (
        await post(party.request, uploadedApi + '/annotation', {
          action: 'decide',
          id: requiredValue(requiredValue(proposed.annotations)[0]).id,
          decision: 'Approved',
        })
      ).status(),
    ).toBe(403)
    expect(
      (
        await post(owner.request, uploadedApi + '/preview', {
          revision: proposed.revision,
          signers: [ownerEmail],
        })
      ).status(),
    ).toBe(409)

    await owner.getByRole('button', { name: 'Suggestions', exact: true }).click()
    const history = owner.getByLabel('Suggestions panel', { exact: true })
    await history.getByRole('button', { name: 'Approve', exact: true }).click()
    await expect(history.getByText('Approved', { exact: true })).toBeVisible()
    await history.getByRole('button', { name: 'Close Suggestions', exact: true }).click()
    const deadline = /within\s+10\s+business\s+days/
    await expect(owner.getByRole('group', { name: 'Clean negotiated PDF' })).toContainText(deadline)
    const approved = await owner.request.get(uploadedApi).then((response) => response.json().then((data) => contractViewSchema.parse(data)))
    const negotiated = await owner.request.get(uploadedApi + '/negotiated-pdf/' + requiredValue(approved.negotiatedPdf).digest)
    expect(negotiated.ok()).toBe(true)
    const negotiatedBytes = await negotiated.body()
    expect(negotiatedBytes.equals(originalPdf)).toBe(false)
    expect(await (await owner.request.get(uploadedApi + '/source-pdf')).body()).toEqual(originalPdf)

    const ownerExport = owner.getByRole('button', { name: 'Export', exact: true })
    await ownerExport.click()
    await owner.getByRole('menuitem', { name: 'Prepare for signing', exact: true }).click()
    await owner.getByLabel('Signer email addresses').fill(ownerEmail)
    await owner.getByRole('button', { name: 'Generate PDF preview' }).click()
    await expect(owner.getByRole('group', { name: 'Signing preview PDF' })).toContainText(deadline)
    await owner.getByRole('button', { name: 'Freeze and send' }).click()

    async function reopenPdf(status: string) {
      await owner.goto(workspacePath)
      const row = owner.getByRole('table', { name: 'Your contracts' }).getByRole('row').filter({ hasText: uploadedTitle })
      await expect(row.getByRole('cell', { name: status, exact: true })).toBeVisible()
      await row.getByRole('link', { name: uploadedTitle, exact: true }).click()
      await expect(owner).toHaveURL(origin + uploadedPath)
      await expect(owner.getByRole('article', { name: 'Contract artboard' })).toContainText(deadline)
    }
    await reopenPdf('Awaiting signatures')
    await ownerExport.click()
    await owner.getByRole('menuitem', { name: 'Sign contract', exact: true }).click()
    const signing = owner.getByRole('dialog', { name: 'Signatures' })
    await signing.getByLabel('Full name').fill('Service Provider')
    await signing.getByRole('checkbox').check()
    await signing.getByRole('button', { name: 'Sign contract', exact: true }).click()
    await expect(owner.getByRole('status').filter({ hasText: /^Signed$/ })).toBeVisible()
    await reopenPdf('Signed')
    expect(await (await owner.request.get(uploadedApi + '/pdf')).body()).toEqual(negotiatedBytes)
    await owner.getByRole('button', { name: 'Suggestions', exact: true }).click()
    await expect(history.getByText('Approved', { exact: true })).toBeVisible()
  } finally {
    await firstContext.close()
    await secondContext.close()
  }
})

test('a workspace without an upload opens an empty Canvas for its parties', async ({ browser }) => {
  const owner = await browser.newContext()
  const member = await browser.newContext()
  const first = await owner.newPage()
  const second = await member.newPage()
  const suffix = crypto.randomUUID().slice(0, 8)
  const recipient = 'empty-member-' + suffix + '@example.com'
  try {
    await Promise.all([account(first, 'Empty Workspace Owner', 'empty-owner-' + suffix + '@example.com'), account(second, 'Empty Workspace Member', recipient)])
    await first.getByRole('link', { name: 'New workspace', exact: true }).click()
    await first.getByLabel('Workspace name').fill('Empty workspace')
    await first.getByLabel('Workspace URL').fill('empty-' + suffix)
    const next = first.getByRole('button', { name: 'Next', exact: true })
    await next.click()
    await first.getByLabel('Email addresses').fill(recipient)
    await next.click()
    await expect(first.getByRole('heading', { name: 'Document', exact: true })).toBeVisible()
    await next.click()
    await first.getByRole('checkbox', { name: /I understand/ }).check()
    await first.getByRole('button', { name: 'Create workspace', exact: true }).click()

    const canvas = first.getByRole('region', { name: 'Canvas', exact: true })
    await expect(canvas.getByRole('heading', { name: 'No contracts yet' })).toBeVisible()
    const workspaceId = new URL(first.url()).searchParams.get('workspace')
    expect(workspaceId).toBeTruthy()
    await expect(first.getByRole('group', { name: 'Open documents' })).toHaveCount(0)
    await expect(first.getByRole('article', { name: 'Contract artboard' })).toHaveCount(0)
    expect(await (await first.request.get('/api/contracts')).json()).toEqual([])
    expect((await first.request.get('/api/contracts/' + workspaceId)).status()).toBe(404)

    await second.goto(await linkFor(recipient, 'workspace'))
    await second.getByRole('button', { name: 'Accept invitation' }).click()
    await expect(second).toHaveURL(origin + '/?workspace=' + workspaceId)
    await expect(second.getByRole('region', { name: 'Canvas', exact: true }).getByRole('heading', { name: 'No contracts yet' })).toBeVisible()
    await expect(second.getByRole('article', { name: 'Contract artboard' })).toHaveCount(0)
    await first.getByRole('button', { name: 'Add document', exact: true }).click()
    const add = first.getByRole('dialog', { name: 'Add document' })
    await add.locator('input[type=file]').setInputFiles({
      name: 'First uploaded contract.pdf',
      mimeType: 'application/pdf',
      buffer: workspacePdf,
    })
    await add.getByRole('button', { name: 'Upload PDF' }).click()
    await expect(first.getByRole('group', { name: 'Open documents' })).toContainText('First uploaded contract')
    await expect(first.getByRole('article', { name: 'Contract artboard' }).getByRole('img', { name: 'Page 1' })).toBeVisible()
    const contractPath = new URL(first.url()).pathname
    const originals = await first.request.get('/api' + contractPath + '/source-pdf')
    expect(originals.ok()).toBe(true)
    expect(await originals.body()).toEqual(workspacePdf)
    await first.goto('/?workspace=' + workspaceId)
    const contracts = first.getByRole('table', { name: 'Your contracts' })
    await expect(contracts.getByRole('link', { name: 'First uploaded contract', exact: true })).toHaveAttribute('href', contractPath)
    await expect(contracts.getByRole('row')).toHaveCount(2)
    for (const name of ['Owner', 'Assigned to', 'Team', 'Created', 'Updated']) {
      await expect(contracts.getByRole('columnheader', { name, exact: true })).toBeVisible()
    }
    const documentRow = contracts.getByRole('row').filter({ hasText: 'First uploaded contract' })
    const ownerEmail = 'empty-owner-' + suffix + '@example.com'
    await expect(documentRow.getByRole('group', { name: 'Team: ' + ownerEmail })).toBeVisible()
    await documentRow.getByRole('button', { name: 'Actions for First uploaded contract' }).click()
    await first.getByRole('menuitem', { name: /^Assign to/ }).click()
    const assign = first.getByRole('dialog', { name: 'Assign contract' })
    await assign.getByRole('combobox', { name: 'Assigned to' }).click()
    await first.getByRole('option', { name: ownerEmail, exact: true }).click()
    await assign.getByRole('button', { name: 'Save changes' }).click()
    await expect(documentRow.getByRole('cell', { name: ownerEmail, exact: true })).toHaveCount(2)
    await first.reload()
    await expect(documentRow.getByRole('cell', { name: ownerEmail, exact: true })).toHaveCount(2)
    expect(await (await first.request.get('/api' + contractPath)).json()).toMatchObject({
      owner: { email: ownerEmail },
      assignee: { email: ownerEmail },
      createdAt: expect.any(Number),
      updatedAt: expect.any(Number),
    })
    const documentActions = documentRow.getByRole('button', { name: 'Actions for First uploaded contract' })
    await documentActions.click()
    await first.getByRole('menuitem', { name: 'Delete contract', exact: true }).click()
    const deletion = first.getByRole('dialog', { name: 'Delete contract' })
    await expect(deletion.getByText(/First uploaded contract/)).toBeVisible()
    await deletion.getByRole('button', { name: 'Cancel', exact: true }).click()
    await expect(documentRow).toBeVisible()
    expect((await post(second.request, '/api' + contractPath + '/delete', {})).status()).toBe(403)
    await documentActions.click()
    await first.getByRole('menuitem', { name: 'Delete contract', exact: true }).click()
    await deletion.getByRole('button', { name: 'Delete contract', exact: true }).click()
    await expect(canvas.getByRole('heading', { name: 'No contracts yet' })).toBeVisible()
    expect((await first.request.get('/api' + contractPath)).status()).toBe(404)
    expect((await first.request.get('/api' + contractPath + '/source-pdf')).status()).toBe(404)
    expect(await (await first.request.get('/api/contracts')).json()).toEqual([])
  } finally {
    await owner.close()
    await member.close()
  }
})

// Keep the real server/data path: corrupt only the first edit acknowledgement, then retry the same pending edit.
test('protocol failure retains unsaved edits and explicit retry persists them', async ({ browser }, testInfo) => {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } })
  const page = await context.newPage()
  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  const suffix = crypto.randomUUID().slice(0, 8)
  try {
    await account(page, 'Protocol Owner', 'protocol-' + suffix + '@example.com')
    const workspace = workspaceSchema.parse(
      await post(page.request, '/api/workspaces', {
        requestId: crypto.randomUUID(),
        name: 'Protocol recovery',
        description: '',
        team: ['party-' + suffix + '@example.com'],
      }).then((response) => response.json()),
    )
    const contract = contractViewSchema.parse(
      await post(page.request, '/api/contracts', {
        requestId: crypto.randomUUID(),
        title: 'Retained edits',
        workspaceId: workspace.id,
      }).then((response) => response.json().then((data) => contractViewSchema.parse(data))),
    )
    let corrupt = true
    await page.routeWebSocket('**/socket', (route) => {
      const server = route.connectToServer()
      route.onMessage((raw) => {
        const value: unknown = JSON.parse(String(raw))
        const parsed = clientMessage.safeParse(value)
        if (corrupt && parsed.success && parsed.data.type === 'edit') {
          corrupt = false
          route.send(JSON.stringify({ type: 'ack', id: parsed.data.id, revision: 'invalid' }))
          return
        }
        server.send(raw)
      })
    })
    await page.goto('/contracts/' + contract.id)
    const editor = page.getByRole('textbox', { name: 'Contract document' })
    await expect(editor).toBeVisible()
    await editor.fill('Unsaved words survive a protocol failure.')
    await expect(page.getByRole('button', { name: 'Retry connection' })).toBeVisible()
    await expect(editor).toContainText('Unsaved words survive')
    await expect(page.getByText('Connection needs retry', { exact: true })).toBeVisible()
    await page.screenshot({ path: testInfo.outputPath('protocol-error.png'), fullPage: true })
    await page.getByRole('button', { name: 'Retry connection' }).click()
    await expect(page.getByRole('button', { name: 'Retry connection' })).toHaveCount(0)
    await expect(page.getByText('Saved', { exact: true })).toBeVisible()
    await page.reload()
    await expect(page.getByRole('textbox', { name: 'Contract document' })).toContainText('Unsaved words survive')
    await page.screenshot({ path: testInfo.outputPath('protocol-recovered.png'), fullPage: true })
    expect(pageErrors).toEqual([])
  } finally {
    await context.close()
  }
})
