import type { Editor } from '@tiptap/core'
import type { ContractView, NativeThread, PdfAnnotation, PdfLocation } from '@clausid/contracts'
import { nativeBounds } from './navigation.ts'
import type { Passage } from './navigation.ts'

export type ReviewItem = { kind: 'native'; value: NativeThread } | { kind: 'pdf'; value: PdfAnnotation }
export type ReviewRect = { left: number; top: number; right: number; bottom: number }
export type ReviewAnchor = {
  item: ReviewItem
  marker: ReviewRect
  rects: ReviewRect[]
  ranges: Range[]
  stroke?: { points: { x: number; y: number }[]; radius: number }
}

const normalized = (text: string) => text.replace(/\s+/gu, ' ').trim()

// Location witnesses take precedence. Quote-only legacy comments must have one
// unique occurrence, including when the browser selected several PDF lines.
export function pdfReviewPassage(rows: readonly Passage[], page: number, quote: string, location?: PdfLocation) {
  const lines = rows.filter((row) => row.page === page && row.item !== undefined)
  if (!quote) {
    return
  }
  if (location) {
    const matches = lines.filter((row) => row.x === location.x && row.y === location.y && row.text.startsWith(quote, location.offset))
    if (matches.length !== 1 || !matches[0]) {
      return
    }
    return { first: matches[0], from: location.offset, last: matches[0], to: location.offset + quote.length }
  }
  const matches = new Map<string, { first: Passage; from: number; last: Passage; to: number }>()
  for (const separator of ['\n', '']) {
    let text = ''
    const positions: { row: Passage; offset: number }[] = []
    for (const [index, row] of lines.entries()) {
      const value = row.text + (index < lines.length - 1 ? separator : '')
      for (let offset = 0; offset < value.length; offset++) {
        const character = value[offset] ?? ''
        if (/\s/u.test(character)) {
          if (text.endsWith(' ')) {
            continue
          }
          text += ' '
        } else {
          text += character
        }
        positions.push({ row, offset: Math.min(offset, row.text.length) })
      }
    }
    const needle = normalized(quote)
    if (!needle) {
      return
    }
    for (let index = text.indexOf(needle); index >= 0; index = text.indexOf(needle, index + 1)) {
      const first = positions[index],
        last = positions[index + needle.length - 1]
      if (first && last) {
        matches.set(first.row.key + ':' + first.offset + '/' + last.row.key + ':' + last.offset, {
          first: first.row,
          from: first.offset,
          last: last.row,
          to: last.offset + 1,
        })
      }
    }
  }
  return matches.size === 1 ? matches.values().next().value : undefined
}

function pdfRange(root: HTMLElement, rows: readonly Passage[], annotation: PdfAnnotation) {
  const quote = annotation.edit && annotation.decision?.status === 'Approved' ? annotation.edit.replacement : (annotation.quote ?? annotation.edit?.expected)
  if (!quote) {
    return
  }
  const match = pdfReviewPassage(rows, annotation.page, quote, annotation.location)
  const page = root.querySelector('#contract-pdf-page-' + annotation.page)
  if (!match || !page) {
    return
  }
  const first = Array.from(page.querySelectorAll<HTMLElement>('[data-pdf-line="' + match.first.item + '"]')).find(
    (span) => Number(span.dataset['offset']) + (span.textContent?.length ?? 0) > match.from,
  )
  const last = Array.from(page.querySelectorAll<HTMLElement>('[data-pdf-line="' + match.last.item + '"]')).find(
    (span) => Number(span.dataset['offset']) + (span.textContent?.length ?? 0) >= match.to,
  )
  if (!first?.firstChild || !last?.firstChild) {
    return
  }
  try {
    const range = window.document.createRange()
    range.setStart(first.firstChild, match.from - Number(first.dataset['offset']))
    range.setEnd(last.firstChild, match.to - Number(last.dataset['offset']))
    return normalized(range.toString()) === normalized(quote) ? range : undefined
  } catch {
    return
  }
}

export function reviewAnchors(root: HTMLElement, editor: Editor | null, rows: readonly Passage[], contract: ContractView): ReviewAnchor[] {
  const anchors: ReviewAnchor[] = []
  if (editor && !contract.sourcePdf) {
    for (const thread of contract.threads ?? []) {
      const quote = thread.decision?.status === 'Approved' && thread.replacement !== undefined ? thread.replacement : thread.anchor.quote
      const bounds = nativeBounds(editor, { ...thread.anchor, quote })
      if (!bounds) {
        continue
      }
      let { from, to } = bounds
      const block = editor.state.doc.nodeAt(from)
      if (block?.isTextblock && from + block.nodeSize === to) {
        from++
        to--
      }
      const first = editor.view.domAtPos(from),
        last = editor.view.domAtPos(to)
      const range = window.document.createRange()
      range.setStart(first.node, first.offset)
      range.setEnd(last.node, last.offset)
      const rects = Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0)
      if (rects[0]) {
        anchors.push({ item: { kind: 'native', value: thread }, marker: rects[0], rects, ranges: [range] })
      }
    }
  }
  if (!contract.sourcePdf) {
    return anchors
  }
  for (const annotation of contract.annotations ?? []) {
    if (annotation.withdrawn) {
      continue
    }
    const page = root.querySelector<HTMLElement>('#contract-pdf-page-' + annotation.page)
    if (!page) {
      continue
    }
    const bounds = page.getBoundingClientRect()
    const range = pdfRange(root, rows, annotation)
    const ranges = range ? [range] : []
    const rects = range ? Array.from(range.getClientRects()).filter((rect) => rect.width > 0 && rect.height > 0) : []
    const points = annotation.markup?.points.map((point) => ({ x: bounds.left + point.x * bounds.width, y: bounds.top + point.y * bounds.height })) ?? []
    const marker =
      rects[0] ??
      (points[0]
        ? { left: points[0].x, right: points[0].x, top: points[0].y, bottom: points[0].y }
        : { left: bounds.left, right: bounds.left, top: bounds.top + 20, bottom: bounds.top + 20 })
    anchors.push({
      item: { kind: 'pdf', value: annotation },
      marker,
      rects,
      ranges,
      ...(points.length && annotation.decision?.status !== 'Rejected'
        ? { stroke: { points, radius: Math.max(5, ((annotation.markup?.tool === 'highlight' ? 6 : 2) * bounds.width) / 612) } }
        : {}),
    })
  }
  return anchors
}

export function hitsReview(anchor: ReviewAnchor, x: number, y: number) {
  if (anchor.rects.some((rect) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom)) {
    return true
  }
  const stroke = anchor.stroke
  if (!stroke) {
    return false
  }
  return stroke.points.some((point, index) => {
    const next = stroke.points[index + 1]
    if (!next) {
      return false
    }
    const dx = next.x - point.x,
      dy = next.y - point.y
    const length = dx * dx + dy * dy
    const ratio = length ? Math.max(0, Math.min(1, ((x - point.x) * dx + (y - point.y) * dy) / length)) : 0
    return Math.hypot(x - point.x - ratio * dx, y - point.y - ratio * dy) <= stroke.radius
  })
}
