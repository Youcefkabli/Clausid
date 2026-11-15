import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'
import { HttpError } from './http.ts'
import regular from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'
import bold from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'
import italic from '@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff'
import boldItalic from '@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff'

type Node = {
  type: string
  text?: string
  attrs?: Record<string, unknown>
  marks?: { type: string }[]
  content?: Node[]
}

export async function renderPdf(title: string, draft: Doc) {
  const document = yDocToProsemirrorJSON(draft, 'default') as Node
  const hasText = (node: Node): boolean => Boolean(node.text?.trim() || node.content?.some(hasText))
  if (!hasText(document)) {
    throw new HttpError(422, 'Add contract text before preparing it for signing.')
  }
  const pdf = await PDFDocument.create()
  pdf.setTitle(title)
  pdf.registerFontkit(fontkit)
  const fonts = await Promise.all([regular, bold, italic, boldItalic].map((font) => pdf.embedFont(font, { subset: true })))
  const glyphs = fonts.map((font) => new Set(font.getCharacterSet()))
  const ink = rgb(0.1, 0.14, 0.18)
  let page = pdf.addPage([612, 792])
  let y = 728
  const beginLine = (size: number) => {
    if (y < 64 + size) {
      page = pdf.addPage([612, 792])
      y = 728
    }
  }
  const paragraph = (nodes: Node[], size: number, indent: number, strong = false) => {
    const left = 62 + Math.min(indent, 100)
    let x = left
    const line = () => { y -= size * 1.55; x = left; beginLine(size) }
    beginLine(size)
    for (const node of nodes) {
      if (node.type === 'hardBreak') { line(); continue }
      const marks = new Set(node.marks?.map((mark) => mark.type))
      const index = Number(strong || marks.has('bold')) + (marks.has('italic') ? 2 : 0)
      const font = fonts[index]
      const draw = (part: string) => {
        const width = font.widthOfTextAtSize(part, size)
        if (x + width > 550) line()
        page.drawText(part, { x, y, size, font, color: ink })
        const markLine = (offset: number) => page.drawLine({
          start: { x, y: y + offset }, end: { x: x + width, y: y + offset }, thickness: 0.7, color: ink,
        })
        if (marks.has('underline')) markLine(-2)
        if (marks.has('strike')) markLine(size * 0.32)
        x += width
      }
      for (const part of (node.text ?? '').replaceAll('\t', '    ').split(/(\r?\n|[^\S\r\n]+)/u).filter(Boolean)) {
        if (part.includes('\n')) { line(); continue }
        if ([...part].some((character) => !glyphs[index].has(character.codePointAt(0)!))) {
          throw new HttpError(422, 'The PDF font cannot reproduce one or more characters. Review the draft text.')
        }
        if (font.widthOfTextAtSize(part, size) > 550 - left) {
          for (const character of part) draw(character)
        } else {
          if (x + font.widthOfTextAtSize(part, size) > 550) line()
          draw(part)
        }
      }
    }
    y -= size * 1.6 + 5
  }

  const write = (node: Node, indent = 0, prefix = '') => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      const content = prefix ? [{ type: 'text', text: prefix }, ...node.content ?? []] : node.content ?? []
      paragraph(content, node.type === 'heading' ? (node.attrs?.level === 1 ? 20 : 15) : 11, indent, node.type === 'heading')
      return
    }
    if (node.type === 'horizontalRule') {
      beginLine(12)
      page.drawLine({ start: { x: 62 + indent, y }, end: { x: 550, y }, thickness: 0.6, color: ink })
      y -= 20
      return
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const start = Number(node.attrs?.start ?? 1)
      node.content?.forEach((entry, index) => entry.content?.forEach((child, childIndex) =>
        write(child, indent + 20, childIndex === 0 ? (node.type === 'orderedList' ? `${start + index}.  ` : '•  ') : '')))
      return
    }
    node.content?.forEach((child) => write(child, node.type === 'blockquote' ? indent + 18 : indent))
  }

  paragraph([{ type: 'text', text: title }], 26, 0, true)
  y -= 12
  write(document)
  pdf.getPages().forEach((item, index) =>
    item.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: 62, y: 35, font: fonts[0], size: 9, color: ink }))
  return new Uint8Array(await pdf.save())
}
