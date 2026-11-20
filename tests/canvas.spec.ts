// Verify selection-driven native formatting/comments through real services and inspect the actual PDF mark output.
import { z } from 'zod'
import { test, expect as playwrightExpect } from '@playwright/test'
import { createHash } from 'node:crypto'
import { setTimeout as delay } from 'node:timers/promises'
import { PDFDocument, PDFArray, PDFDict, PDFName, PDFHexString, PDFRawStream, decodePDFRawStream } from '../apps/worker/node_modules/pdf-lib/cjs/index.js'
import { contractViewSchema, previewSchema, workspaceSchema } from '../packages/contracts/src/index.ts'
import { requiredValue } from '../packages/contracts/src/invariant.ts'
import { linkFor } from './mailpit.ts'
import { workspaceFixture, workspacePdf } from './workspace-fixture.ts'

const origin = `http://127.0.0.1:${process['env']['CLAUSID_VITE_PORT'] ?? '5173'}`
// Reloads can cross the real auth service's 60-second loopback retry window.
const expect = playwrightExpect.configure({ timeout: 75_000 })

test('contextual native formatting and inline comments persist and export faithfully', async ({ page, context }) => {
  test.setTimeout(180_000)
  const errors: string[] = []
  page.on('pageerror', (error) => {
    errors.push(error.message)
    console.error('Canvas page error', error.message)
  })
  const email = 'canvas-' + crypto.randomUUID().slice(0, 8) + '@example.test'
  const password = 'clausid-canvas-testing-123'
  await page.route(/\/api\/auth\/(?:get-session|sign-in\/email|sign-up\/email)(?:\?|$)/, async (route) => {
    let response = await route.fetch()
    if (response.status() === 429) {
      await delay((Number(response.headers()['x-retry-after'] ?? response.headers()['retry-after'] ?? 60) + 1) * 1000)
      response = await route.fetch()
    }
    await route.fulfill({ response })
  })
  await page.goto('/?auth=signup')
  await page.getByLabel(/^Name\b/).fill('Canvas Reviewer')
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Create account', exact: true }).click()
  await expect(page.getByText('Check your inbox to verify your email', { exact: false })).toBeVisible()
  await page.goto(await linkFor(email, 'verify'))
  await page.getByLabel(/^Email\b/).fill(email)
  await page.getByLabel(/^Password\b/).fill(password)
  await page.getByRole('button', { name: 'Login', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Workspaces', exact: true })).toBeVisible()
  const created = await page.request.post('/api/contracts', {
    headers: { Origin: origin },
    data: { title: 'Canvas formatting and comments', requestId: crypto.randomUUID() },
  })
  expect(created.ok()).toBe(true)
  const contract = contractViewSchema.parse(await created.json())
  const path = '/contracts/' + contract.id
  const endpoint = '/api' + path
  await page.goto(path)
  const editor = page.getByRole('textbox', { name: 'Contract document', exact: true })
  await expect(editor).toBeVisible()
  const text = 'Review the payment schedule and delivery milestones before approving this agreement. '.repeat(3).trim()
  await editor.fill(text)
  await editor.press('ControlOrMeta+a')
  const toolbar = page.getByRole('toolbar', { name: 'Selection tools', exact: true })
  await expect(toolbar).toBeVisible()
  for (const [label, tag] of [
    ['Bulleted list', 'ul'],
    ['Numbered list', 'ol'],
    ['Blockquote', 'blockquote'],
  ] as const) {
    await toolbar.getByRole('button', { name: label, exact: true }).click()
    await expect(editor.locator(tag)).toContainText(text)
    await toolbar.getByRole('button', { name: label, exact: true }).click()
    await expect(editor.locator(tag)).toHaveCount(0)
  }
  await toolbar.getByRole('button', { name: 'Bold', exact: true }).click()
  await expect(editor.locator('strong')).toHaveText(text)
  await toolbar.getByRole('button', { name: 'Text color', exact: true }).click()
  await page.getByRole('menuitem', { name: 'Purple', exact: true }).click()
  await expect(editor.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(109, 40, 217)')
  await toolbar.getByRole('button', { name: 'Link', exact: true }).click()
  const link = page.getByRole('dialog', { name: 'Edit link', exact: true })
  await link.getByRole('textbox', { name: 'Link URL', exact: true }).fill('javascript:alert(1)')
  await link.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect(link.getByRole('alert')).toContainText('absolute')
  await link.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.com/terms')
  await link.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/terms')
  await toolbar.getByRole('button', { name: 'Link', exact: true }).click()
  await link.getByRole('button', { name: 'Remove link', exact: true }).click()
  await expect(editor.locator('a')).toHaveCount(0)
  await toolbar.getByRole('button', { name: 'Link', exact: true }).click()
  await link.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.com/updated')
  await link.getByRole('button', { name: 'Apply link', exact: true }).click()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/updated')
  await toolbar.getByRole('button', { name: 'Link', exact: true }).click()
  await link.getByRole('textbox', { name: 'Link URL', exact: true }).fill('https://example.com/terms')
  await link.getByRole('button', { name: 'Apply link', exact: true }).click()

  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click()
  const composer = page.getByRole('dialog', { name: 'Comment on passage', exact: true })
  await composer.getByRole('textbox', { name: 'Comment', exact: true }).fill('Please confirm the milestones.')
  let calls = 0
  const ids: string[] = []
  await page.route('**' + endpoint + '/review', async (route) => {
    const data = z.object({ requestId: z.uuid() }).parse(JSON.parse(route.request().postData() ?? '{}'))
    if (typeof data.requestId !== 'string') {
      throw Error('Request ID missing')
    }
    ids.push(data.requestId)
    calls++
    if (calls === 1) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test retry without losing the comment.' }) })
    } else {
      await route.continue()
    }
  })
  await composer.getByRole('button', { name: 'Post comment', exact: true }).click()
  await expect(composer.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('Please confirm the milestones.')
  await expect(composer.getByRole('alert')).toContainText('Test retry')
  await composer.getByRole('textbox', { name: 'Comment', exact: true }).press('ControlOrMeta+Enter')
  await expect(composer).toBeHidden()
  expect(ids).toHaveLength(2)
  expect(ids[0]).toBe(ids[1])
  await expect(page.getByLabel('Comments panel', { exact: true }).getByText('Please confirm the milestones.', { exact: true })).toBeVisible()
  const current = contractViewSchema.parse(await (await page.request.get(endpoint)).json())
  expect(current.threads?.filter((row) => row.text === 'Please confirm the milestones.')).toHaveLength(1)
  const nativeComment = requiredValue(current.threads?.[0])
  const replyResponse = await page.request.post(endpoint + '/review', {
    headers: { Origin: origin },
    data: { requestId: crypto.randomUUID(), change: { action: 'reply', id: nativeComment.id, text: 'The milestones are under review.' } },
  })
  expect(replyResponse.ok()).toBe(true)
  const beforeHover = contractViewSchema.parse(await replyResponse.json()).revision
  await editor.press('ArrowRight')
  const nativePoint = await editor.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const node = walker.nextNode()
    if (!node?.textContent) {
      throw Error('Native text unavailable')
    }
    const range = document.createRange()
    range.setStart(node, 0)
    range.setEnd(node, Math.min(10, node.textContent.length))
    const box = range.getBoundingClientRect()
    return { x: box.left + box.width / 2, y: box.top + box.height / 2 }
  })
  const discussion = page.getByRole('dialog', { name: 'Passage discussion', exact: true })
  await page.mouse.move(nativePoint.x, nativePoint.y)
  await expect(discussion).toBeVisible({ timeout: 5000 })
  await expect(discussion).toContainText('Please confirm the milestones.')
  await expect(discussion).toContainText('The milestones are under review.')
  await expect(discussion).toContainText('Canvas Reviewer')
  expect(contractViewSchema.parse(await (await page.request.get(endpoint)).json()).revision).toBe(beforeHover)
  await page.screenshot({ path: test.info().outputPath('canvas-native-hover.png'), animations: 'disabled' })
  await discussion.getByText('The milestones are under review.', { exact: true }).dblclick()
  await expect(discussion).toBeVisible()
  await page.keyboard.press('Escape')
  await expect(discussion).toBeHidden()
  const nativeMarker = page.getByRole('button', { name: /^Discussion 1:/ })
  await nativeMarker.focus()
  await expect(discussion).toBeVisible({ timeout: 5000 })
  await nativeMarker.press('Enter')
  await expect(discussion).toBeHidden()
  await expect(page.locator('#review-' + nativeComment.id)).toBeFocused()
  await page.getByRole('button', { name: 'Resolve', exact: true }).click()
  await page.reload()
  await expect(editor.locator('a')).toHaveAttribute('href', 'https://example.com/terms')
  await expect(editor.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(109, 40, 217)')
  await expect(page.getByText('Resolved', { exact: true })).toBeVisible()
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await toolbar.getByRole('button', { name: 'Suggest replacement', exact: true }).click()
  const replacement = text.replaceAll('milestones', 'deliverables')
  await page.getByRole('textbox', { name: 'Replacement text', exact: true }).fill(replacement)
  await page.getByRole('button', { name: 'Submit suggestion', exact: true }).click()
  await page.getByRole('button', { name: 'Approve', exact: true }).click()
  await expect(editor.locator('a')).toHaveText(replacement)
  await expect(editor.locator('span[style*="color"]')).toHaveCSS('color', 'rgb(109, 40, 217)')
  const other = await context.newPage()
  await other.goto(path)
  await expect(other.getByRole('textbox', { name: 'Contract document' }).locator('a')).toHaveText(replacement)
  await other.close()
  const revision = contractViewSchema.parse(await (await page.request.get(endpoint)).json()).revision
  const previewResponse = await page.request.post(endpoint + '/preview', { headers: { Origin: origin }, data: { revision, signers: [email] } })
  expect(previewResponse.ok()).toBe(true)
  const preview = previewSchema.parse(await previewResponse.json())
  const bytes = await (await page.request.get(endpoint + '/preview/' + preview.id)).body()
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(preview.digest)
  const pdf = await PDFDocument.load(bytes)
  let links = 0
  const colors: number[][] = []
  for (const sheet of pdf.getPages()) {
    const contents = sheet.node.Contents()
    const streams =
      contents instanceof PDFArray
        ? contents
            .asArray()
            .map((ref) => pdf.context.lookup(ref))
            .filter((value) => value instanceof PDFRawStream)
        : contents instanceof PDFRawStream
          ? [contents]
          : []
    for (const stream of streams) {
      const content = new TextDecoder().decode(decodePDFRawStream(stream).decode())
      for (const match of content.matchAll(/([\d.]+) ([\d.]+) ([\d.]+) rg/g)) {
        colors.push(match.slice(1).map(Number))
      }
    }
    for (const ref of sheet.node.Annots()?.asArray() ?? []) {
      const annotation = pdf.context.lookup(ref, PDFDict)
      const action = annotation.lookup(PDFName.of('A'), PDFDict)
      const uri = action.lookup(PDFName.of('URI'), PDFHexString)
      expect(uri.decodeText()).toBe('https://example.com/terms')
      links++
    }
  }
  expect(links).toBeGreaterThan(3)
  expect(
    colors.some(
      (color) => Math.abs((color[0] ?? 0) - 109 / 255) < 0.001 && Math.abs((color[1] ?? 0) - 40 / 255) < 0.001 && Math.abs((color[2] ?? 0) - 217 / 255) < 0.001,
    ),
  ).toBe(true)
  expect(errors).toEqual([])
  await page.getByRole('button', { name: 'Comments', exact: true }).click()
  await page.setViewportSize({ width: 1440, height: 1000 })
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await expect(toolbar).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('canvas-selection-desktop.png'), animations: 'disabled' })
  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click()
  await composer.getByRole('textbox', { name: 'Comment', exact: true }).fill('A draft comment beside the selected passage.')
  await page.screenshot({ path: test.info().outputPath('canvas-comment-desktop.png'), animations: 'disabled' })
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'dark' })
  await editor.click()
  await editor.press('ControlOrMeta+a')
  await expect(toolbar).toBeVisible()
  await page.screenshot({ path: test.info().outputPath('canvas-selection-dark.png'), animations: 'disabled' })
  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(composer.getByRole('textbox', { name: 'Comment', exact: true })).toHaveValue('A draft comment beside the selected passage.')
  await page.screenshot({ path: test.info().outputPath('canvas-comment-dark.png'), animations: 'disabled' })
  await composer.getByRole('button', { name: 'Cancel', exact: true }).click()
  await page.emulateMedia({ colorScheme: 'light' })

  for (const width of [1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await expect(page.getByRole('button', { name: 'Close Comments', exact: true })).toBeHidden()
    await editor.focus()
    await expect(editor).toBeFocused()
    await editor.press('ArrowRight')
    await expect(toolbar).toBeHidden()
    await editor.press('ControlOrMeta+a')
    await expect(toolbar).toBeVisible()
    await expect(toolbar.getByRole('button', { name: 'Suggest replacement', exact: true })).toBeInViewport({ ratio: 1 })
    const bounds = await toolbar.boundingBox()
    expect(bounds?.x).toBeGreaterThanOrEqual(0)
    expect((bounds?.x ?? 0) + (bounds?.width ?? 0)).toBeLessThanOrEqual(width)
    await page.screenshot({ path: test.info().outputPath('canvas-selection-' + width + '.png'), animations: 'disabled' })
    if (width === 390) {
      await toolbar.getByRole('button', { name: 'Comment', exact: true }).click()
      await expect(composer).toBeInViewport({ ratio: 1 })
      const composerBounds = await composer.boundingBox()
      expect((composerBounds?.x ?? 0) + (composerBounds?.width ?? 0)).toBeLessThanOrEqual(width)
      await page.screenshot({ path: test.info().outputPath('canvas-comment-mobile.png'), animations: 'disabled' })
      await composer.getByRole('button', { name: /^Close/i }).click()
      await expect(composer).toBeHidden()
    }
  }
  const freeze = await page.request.post(endpoint + '/freeze', { headers: { Origin: origin }, data: { previewId: preview.id } })
  expect(freeze.ok()).toBe(true)
  const frozen = contractViewSchema.parse(await freeze.json())
  expect(frozen.version?.digest).toBe(preview.digest)
  expect(await (await page.request.get(endpoint + '/pdf')).body()).toEqual(bytes)
  await expect(editor).toHaveCount(0)
  await expect(toolbar).toBeHidden()

  // PDF comments use the same composer while retaining page/item/digest anchors.
  const workspaceResponse = await page.request.post('/api/workspaces', {
    headers: { Origin: origin },
    data: { name: 'Canvas PDF comments', requestId: crypto.randomUUID(), ...workspaceFixture() },
  })
  expect(workspaceResponse.ok()).toBe(true)
  const workspace = workspaceSchema.parse(await workspaceResponse.json())
  const pdfPath = '/contracts/' + requiredValue(workspace.firstContractId)
  await page.setViewportSize({ width: 1440, height: 1000 })
  await page.goto(pdfPath)
  const secondSheet = page.getByRole('group', { name: 'PDF page 2', exact: true })
  await secondSheet.scrollIntoViewIfNeeded()
  const phrase = secondSheet.locator('[data-pdf-item]').filter({ hasText: /^15 days$/ })
  await expect(phrase).toBeVisible()
  await phrase.scrollIntoViewIfNeeded()
  const bounds = requiredValue(await phrase.boundingBox())
  await page.mouse.move(bounds.x + 0.5, bounds.y + bounds.height / 2)
  await page.mouse.down()
  await page.mouse.move(bounds.x + bounds.width - 0.5, bounds.y + bounds.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('15 days')
  await page.screenshot({ path: test.info().outputPath('canvas-pdf-selection.png'), animations: 'disabled' })
  // Highlighting the selectable overlay must not paint a second font over the PDF canvas.
  const overlayInk = await phrase.evaluate((element) =>
    ['::selection', '::highlight(clausid-passage)', '::highlight(clausid-review-anchors)', '::highlight(clausid-hover-passage)'].map(
      (highlight) => getComputedStyle(element, highlight).color,
    ),
  )
  expect(overlayInk).toEqual(Array.from({ length: 4 }, () => 'rgba(0, 0, 0, 0)'))
  await toolbar.getByRole('button', { name: 'Comment', exact: true }).click()
  await expect(composer).toContainText('15 days')
  await composer.getByRole('textbox', { name: 'Comment', exact: true }).fill('Confirm this PDF passage.')
  await composer.getByRole('textbox', { name: 'Comment', exact: true }).press('ControlOrMeta+Enter')
  await expect(composer).toBeHidden()
  await expect(page.getByLabel('Comments panel', { exact: true }).getByText('Confirm this PDF passage.', { exact: true })).toBeVisible()
  const pdfComment = contractViewSchema.parse(await (await page.request.get('/api' + pdfPath)).json())
  expect(pdfComment.annotations).toHaveLength(1)
  expect(pdfComment.annotations?.[0]).toMatchObject({ page: 2, quote: '15 days' })
  expect(pdfComment.annotations?.[0]?.location).toBeDefined()
  await page.reload()
  await expect(page.getByLabel('Comments panel', { exact: true }).getByText('Confirm this PDF passage.', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'View page 2', exact: true }).click()
  await expect(phrase).toBeInViewport()
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('15 days')
  await expect(page.getByText('This passage is no longer available.', { exact: true })).toHaveCount(0)
  expect(
    await page.evaluate(() => {
      let highlighted = false
      CSS.highlights.forEach((_value, key) => {
        highlighted ||= key === 'clausid-passage'
      })
      return highlighted
    }),
  ).toBe(true)
  await page.screenshot({ path: test.info().outputPath('canvas-pdf-comment.png'), animations: 'disabled' })
  const hoverPdf = async () => {
    await secondSheet.scrollIntoViewIfNeeded({ timeout: 5000 })
    await phrase.scrollIntoViewIfNeeded({ timeout: 5000 })
    const sheet = requiredValue(await secondSheet.boundingBox())
    await page.mouse.click(sheet.x + sheet.width * 0.8, sheet.y + sheet.height * 0.4)
    await expect.poll(() => page.evaluate(() => window.getSelection()?.isCollapsed), { timeout: 5000 }).toBe(true)
    const box = requiredValue(await phrase.boundingBox())
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await expect(discussion).toBeVisible({ timeout: 5000 })
  }
  await hoverPdf()
  await expect(discussion).toContainText('Confirm this PDF passage.')
  const pdfReply = await page.request.post('/api' + pdfPath + '/annotation', {
    headers: { Origin: origin },
    data: { action: 'reply', id: requiredValue(pdfComment.annotations?.[0]).id, text: 'Discuss this PDF clause inline.' },
  })
  expect(pdfReply.ok()).toBe(true)
  await expect(discussion).toContainText('Discuss this PDF clause inline.')
  await page.screenshot({ path: test.info().outputPath('canvas-pdf-hover.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  await expect(discussion).toBeHidden()
  const selectPhrase = async () => {
    await secondSheet.scrollIntoViewIfNeeded({ timeout: 5000 })
    await phrase.scrollIntoViewIfNeeded({ timeout: 5000 })
    await phrase.click()
    const box = requiredValue(await phrase.boundingBox())
    await page.mouse.move(box.x + 0.5, box.y + box.height / 2)
    await page.mouse.down()
    await page.mouse.move(box.x + box.width - 0.5, box.y + box.height / 2, { steps: 8 })
    await page.mouse.up()
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString()), { timeout: 5000 }).toBe('15 days')
    await expect(toolbar).toBeVisible({ timeout: 5000 })
    await expect(discussion).toBeHidden()
  }
  for (const label of ['Underline', 'Strikethrough'] as const) {
    await selectPhrase()
    await expect(toolbar.getByRole('button', { name: label, exact: true })).toBeEnabled()
    await page.screenshot({ path: test.info().outputPath('canvas-pdf-full-toolbar.png'), animations: 'disabled' })
    await toolbar.getByRole('button', { name: label, exact: true }).click()
    await expect(toolbar).toBeHidden()
  }
  const pdfEndpoint = '/api' + pdfPath
  const readPdf = async () => contractViewSchema.parse(await (await page.request.get(pdfEndpoint)).json())
  const schedule = secondSheet
    .locator('[data-pdf-item]')
    .filter({ hasText: /^Payment/ })
    .first()
  await schedule.scrollIntoViewIfNeeded({ timeout: 5000 })
  const start = requiredValue(await schedule.boundingBox())
  const end = requiredValue(await phrase.boundingBox())
  await page.mouse.move(start.x + 0.5, start.y + start.height / 2)
  await page.mouse.down()
  await page.mouse.move(end.x + end.width - 0.5, end.y + end.height / 2, { steps: 8 })
  await page.mouse.up()
  await expect(toolbar.getByRole('button', { name: 'Highlight', exact: true })).toBeEnabled()
  const markIds: string[] = []
  await page.route('**' + pdfEndpoint + '/annotation', async (route) => {
    const value = z.object({ requestId: z.uuid(), markup: z.object({ tool: z.literal('highlight') }) }).parse(JSON.parse(route.request().postData() ?? '{}'))
    markIds.push(value.requestId)
    if (markIds.length === 2) {
      await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'Test line annotation retry.' }) })
    } else {
      await route.continue()
    }
  })
  await toolbar.getByRole('button', { name: 'Highlight', exact: true }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'Retry this action' })).toBeVisible()
  await toolbar.getByRole('button', { name: 'Highlight', exact: true }).click()
  await expect(toolbar).toBeHidden()
  await page.unroute('**' + pdfEndpoint + '/annotation')
  expect(markIds).toHaveLength(4)
  expect(markIds.slice(0, 2)).toEqual(markIds.slice(2))
  const marked = await readPdf()
  expect(marked.annotations).toHaveLength(5)
  const highlights = marked.annotations?.filter((item) => item.markup?.tool === 'highlight') ?? []
  expect(highlights.map((item) => item.quote)).toEqual(['Payment schedule', 'Pay in 15 days'])
  expect(requiredValue(highlights[0]?.markup?.points[0]).y).toBeLessThan(requiredValue(highlights[1]?.markup?.points[0]).y)
  const underline = marked.annotations?.find((item) => item.markup?.tool === 'underline')
  const strike = marked.annotations?.find((item) => item.markup?.tool === 'strikethrough')
  expect(requiredValue(underline?.markup?.points[0]).y).toBeGreaterThan(requiredValue(strike?.markup?.points[0]).y)
  for (const item of marked.annotations ?? []) {
    if (!item.markup) {
      continue
    }
    expect(item.page).toBe(2)
    expect(item.markup.points).toHaveLength(2)
    expect(item.markup.points[0]?.y).toBe(item.markup.points[1]?.y)
    expect(requiredValue(item.markup.points[0]).x).toBeLessThan(requiredValue(item.markup.points[1]).x)
  }
  await page.reload()
  await expect(page.getByText('highlight annotation', { exact: true })).toHaveCount(2)
  expect((await readPdf()).annotations).toHaveLength(5)
  await hoverPdf()
  await expect(discussion.getByTestId('review-preview-row')).toHaveCount(4)
  await expect(discussion).toContainText('underline annotation')
  await expect(discussion).toContainText('strikethrough annotation')
  await expect(discussion).toContainText('highlight annotation')
  await page.screenshot({ path: test.info().outputPath('canvas-pdf-overlapping-hover.png'), animations: 'disabled' })
  await page.keyboard.press('Escape')
  const visibility = await page.request.post(pdfEndpoint + '/annotation', {
    headers: { Origin: origin },
    data: { action: 'visibility', id: requiredValue(underline).id, withdrawn: true },
  })
  expect(visibility.ok()).toBe(true)
  await hoverPdf()
  await expect(discussion.getByTestId('review-preview-row')).toHaveCount(3)
  await expect(discussion).not.toContainText('underline annotation')
  await page.keyboard.press('Escape')
  expect(
    (
      await page.request.post(pdfEndpoint + '/annotation', {
        headers: { Origin: origin },
        data: { action: 'visibility', id: requiredValue(underline).id, withdrawn: false },
      })
    ).ok(),
  ).toBe(true)
  for (const annotation of marked.annotations ?? []) {
    const decision = await page.request.post(pdfEndpoint + '/annotation', {
      headers: { Origin: origin },
      data: { action: 'decide', id: annotation.id, decision: 'Approved' },
    })
    expect(decision.ok()).toBe(true)
  }
  await expect(page.getByRole('group', { name: 'Clean negotiated PDF', exact: true })).toBeVisible()
  await selectPhrase()
  await page.screenshot({ path: test.info().outputPath('canvas-pdf-approved-text-marks.png'), animations: 'disabled' })
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 })
    await selectPhrase()
    for (const label of ['Comment', 'Highlight', 'Underline', 'Strikethrough', 'Suggest replacement']) {
      await expect(toolbar.getByRole('button', { name: label, exact: true })).toBeInViewport({ ratio: 1 })
    }
    await page.screenshot({ path: test.info().outputPath('canvas-pdf-toolbar-' + width + '.png'), animations: 'disabled' })
    await hoverPdf()
    await expect(discussion).toBeInViewport({ ratio: 1 })
    await expect(discussion).toContainText('Approved')
    // Native anchor visibility can suppress painting without changing the layout box.
    await expect
      .poll(() =>
        discussion.evaluate((element) => {
          const bounds = element.getBoundingClientRect()
          return element.contains(document.elementFromPoint(bounds.left + 24, bounds.top + 24))
        }),
      )
      .toBe(true)
    await discussion.screenshot({ path: test.info().outputPath('canvas-pdf-hover-card-' + width + '.png'), animations: 'allow' })
    await expect(discussion).toBeVisible({ timeout: 5000 })
    await page.screenshot({ path: test.info().outputPath('canvas-pdf-hover-' + width + '.png'), animations: 'allow' })
    await expect(discussion).toBeVisible({ timeout: 5000 })
    await page.keyboard.press('Escape')
    const marker = page.getByRole('button', { name: /^Discussion \d+: 15 days/ })
    await marker.click()
    await expect(page.getByRole('dialog', { name: 'Comments', exact: true })).toBeVisible()
    await page
      .getByRole('dialog', { name: 'Comments', exact: true })
      .getByRole('button', { name: /^Close/ })
      .click()
  }
  expect(await (await page.request.get(pdfEndpoint + '/source-pdf')).body()).toEqual(workspacePdf)
  const approved = await readPdf()
  const pdfPreviewResponse = await page.request.post(pdfEndpoint + '/preview', {
    headers: { Origin: origin },
    data: { revision: approved.revision, signers: [email] },
  })
  expect(pdfPreviewResponse.ok()).toBe(true)
  const pdfPreview = previewSchema.parse(await pdfPreviewResponse.json())
  const pdfFreeze = await page.request.post(pdfEndpoint + '/freeze', { headers: { Origin: origin }, data: { previewId: pdfPreview.id } })
  expect(pdfFreeze.ok()).toBe(true)
  await expect(toolbar).toBeHidden()
  await hoverPdf()
  await expect(discussion).toContainText('Approved')
  await page.keyboard.press('Escape')
  expect(errors).toEqual([])
})
