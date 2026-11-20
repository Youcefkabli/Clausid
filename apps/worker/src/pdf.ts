import { requiredValue } from '../../../packages/contracts/src/invariant.ts'
import type { PdfAnnotation } from '@clausid/contracts'
import { PDFDocument, PDFHexString, rgb, LineCapStyle } from 'pdf-lib'
import { nativeColorSchema, nativeLinkSchema } from '@clausid/contracts'
import fontkit from '@pdf-lib/fontkit'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'
import { HttpError } from './http.ts'
import { pdfNodeSchema } from './records.ts'
import type { PdfNode as Node } from './records.ts'
import regular from '@fontsource/noto-sans/files/noto-sans-latin-400-normal.woff'
import bold from '@fontsource/noto-sans/files/noto-sans-latin-700-normal.woff'
import italic from '@fontsource/noto-sans/files/noto-sans-latin-400-italic.woff'
import boldItalic from '@fontsource/noto-sans/files/noto-sans-latin-700-italic.woff'

export async function renderPdf(title: string, draft: Doc) {
  const document = pdfNodeSchema.parse(yDocToProsemirrorJSON(draft, 'default'))
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
    const line = () => {
      y -= size * 1.55
      x = left
      beginLine(size)
    }
    beginLine(size)
    for (const node of nodes) {
      if (node.type === 'hardBreak') {
        line()
        continue
      }
      const marks = new Set(node.marks?.map((mark) => mark.type))
      const href = marks.has('link') ? nativeLinkSchema.parse(node.marks?.find((mark) => mark.type === 'link')?.attrs?.['href']) : undefined
      const colorValue = node.marks?.find((mark) => mark.type === 'textStyle')?.attrs?.['color']
      const color = colorValue == null ? (href ? '#1d4ed8' : undefined) : nativeColorSchema.parse(colorValue)
      const textInk = color ? rgb(parseInt(color.slice(1, 3), 16) / 255, parseInt(color.slice(3, 5), 16) / 255, parseInt(color.slice(5, 7), 16) / 255) : ink
      const index = Number(strong || marks.has('bold')) + (marks.has('italic') ? 2 : 0)
      const font = requiredValue(fonts[index])
      const draw = (part: string) => {
        const width = font.widthOfTextAtSize(part, size)
        if (x + width > 550) {
          line()
        }
        page.drawText(part, { x, y, size, font, color: textInk })
        if (href && width > 0) {
          const annotation = pdf.context.register(
            pdf.context.obj({
              Type: 'Annot',
              Subtype: 'Link',
              Rect: [x, y - size * 0.25, x + width, y + size],
              Border: [0, 0, 0],
              A: { Type: 'Action', S: 'URI', URI: PDFHexString.fromText(href) },
            }),
          )
          page.node.addAnnot(annotation)
        }
        const markLine = (offset: number) =>
          page.drawLine({
            start: { x, y: y + offset },
            end: { x: x + width, y: y + offset },
            thickness: 0.7,
            color: textInk,
          })
        if (marks.has('underline') || href) {
          markLine(-2)
        }
        if (marks.has('strike')) {
          markLine(size * 0.32)
        }
        x += width
      }
      for (const part of (node.text ?? '')
        .replaceAll('\t', '    ')
        .split(/(\r?\n|[^\S\r\n]+)/u)
        .filter(Boolean)) {
        if (part.includes('\n')) {
          line()
          continue
        }
        if (Array.from(part).some((character) => !requiredValue(glyphs[index]).has(requiredValue(character.codePointAt(0))))) {
          throw new HttpError(422, 'The PDF font cannot reproduce one or more characters. Review the draft text.')
        }
        if (font.widthOfTextAtSize(part, size) > 550 - left) {
          for (const character of part) {
            draw(character)
          }
        } else {
          if (x + font.widthOfTextAtSize(part, size) > 550) {
            line()
          }
          draw(part)
        }
      }
    }
    y -= size * 1.6 + 5
  }

  const write = (node: Node, indent = 0, prefix = '') => {
    if (node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock') {
      const content = prefix ? [{ type: 'text', text: prefix }, ...(node.content ?? [])] : (node.content ?? [])
      paragraph(content, node.type === 'heading' ? (node['attrs']?.['level'] === 1 ? 20 : 15) : 11, indent, node.type === 'heading')
      return
    }
    if (node.type === 'horizontalRule') {
      beginLine(12)
      page.drawLine({ start: { x: 62 + indent, y }, end: { x: 550, y }, thickness: 0.6, color: ink })
      y -= 20
      return
    }
    if (node.type === 'bulletList' || node.type === 'orderedList') {
      const start = Number(node['attrs']?.['start'] ?? 1)
      node.content?.forEach((entry, index) =>
        entry.content?.forEach((child, childIndex) =>
          write(child, indent + 20, childIndex === 0 ? (node.type === 'orderedList' ? `${start + index}.  ` : '•  ') : ''),
        ),
      )
      return
    }
    node.content?.forEach((child) => write(child, node.type === 'blockquote' ? indent + 18 : indent))
  }

  paragraph([{ type: 'text', text: title }], 26, 0, true)
  y -= 12
  write(document)
  pdf
    .getPages()
    .forEach((item, index) => item.drawText(`${index + 1} / ${pdf.getPageCount()}`, { x: 62, y: 35, font: requiredValue(fonts[0]), size: 9, color: ink }))
  return new Uint8Array(await pdf.save())
}

// Coordinates use the displayed crop box so drawings follow rotated PDF pages.
export async function applyPdfMarkup(bytes: Uint8Array, annotations: PdfAnnotation[]) {
  const marks = annotations.filter((item) => item.markup)
  if (!marks.length) {
    return bytes
  }
  const pdf = await PDFDocument.load(bytes)
  for (const annotation of marks) {
    const page = pdf.getPage(annotation.page - 1)
    const { x, y, width, height } = page.getCropBox()
    const rotation = ((page.getRotation().angle % 360) + 360) % 360
    const point = (p: { x: number; y: number }) => {
      switch (rotation) {
        case 90:
          return { x: x + p.y * width, y: y + p.x * height }
        case 180:
          return { x: x + (1 - p.x) * width, y: y + p.y * height }
        case 270:
          return { x: x + (1 - p.y) * width, y: y + (1 - p.x) * height }
        default:
          return { x: x + p.x * width, y: y + (1 - p.y) * height }
      }
    }
    const mark = requiredValue(annotation.markup)
    const thickness = mark.tool === 'highlight' ? 12 : mark.tool === 'brush' ? 6 : 1.5
    for (let i = 1; i < mark.points.length; i++) {
      page.drawLine({
        start: point(requiredValue(mark.points[i - 1])),
        end: point(requiredValue(mark.points[i])),
        thickness: (thickness * Math.min(width, height)) / 612,
        color: mark.tool === 'highlight' ? rgb(1, 0.8, 0) : rgb(0.12, 0.22, 0.42),
        opacity: mark.tool === 'highlight' ? 0.3 : 1,
        lineCap: LineCapStyle.Round,
      })
    }
  }
  return pdf.save()
}
