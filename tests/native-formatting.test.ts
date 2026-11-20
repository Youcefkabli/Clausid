// Exercise actual Yjs draft validation so unsupported mark attributes cannot be persisted by bypassing the UI.
import { expect, it } from 'vite-plus/test'
import * as Y from 'yjs'
import { validateDraft } from '../apps/worker/src/native-schema.ts'
import { nativeColorSchema, nativeLinkSchema, nativeTextColors } from '../packages/contracts/src/index.ts'

function formattedDraft(attributes: Record<string, unknown>) {
  const doc = new Y.Doc()
  const paragraph = new Y.XmlElement('paragraph')
  const text = new Y.XmlText()
  doc.getXmlFragment('default').insert(0, [paragraph])
  paragraph.insert(0, [text])
  text.insert(0, 'Payment terms', attributes)
  return doc
}

it('accepts existing plain drafts and combined links, colors and ordinary marks', () => {
  for (const attributes of [
    {},
    ...nativeTextColors.map(({ value }) => ({
      bold: {},
      italic: {},
      underline: {},
      strike: {},
      link: { href: 'https://example.com/terms' },
      textStyle: { color: value },
    })),
  ]) {
    const draft = formattedDraft(attributes)
    expect(() => validateDraft(draft)).not.toThrow()
    draft.destroy()
  }
})

it('rejects unsafe links and arbitrary colors through the server validation entry point', () => {
  for (const attributes of [
    { link: { href: 'javascript:alert(1)' } },
    { link: { href: '//example.com' } },
    { link: { href: 'data:text/html,test' } },
    { textStyle: { color: 'red' } },
    { textStyle: { color: '#ffffff' } },
  ]) {
    const draft = formattedDraft(attributes)
    expect(() => validateDraft(draft)).toThrow()
    draft.destroy()
  }
  for (const url of ['https://example.com/terms', 'http://example.test/path?q=test', 'mailto:person@example.test']) {
    expect(nativeLinkSchema.safeParse(url).success).toBe(true)
  }
  expect(nativeLinkSchema.safeParse('https://user:secret@example.com').success).toBe(false)
  expect(nativeColorSchema.safeParse(null).success).toBe(false)
})
