import type { PdfAnnotation, PdfLocation, PdfTextBlock } from '@clausid/contracts'

export type PdfTextMarkTool = 'highlight' | 'underline' | 'strikethrough'
export type PdfSelectionMark = {
  quote: string
  location: PdfLocation
  rect: { left: number; top: number; right: number; bottom: number }
}

export type PdfSelection = {
  page: number
  quote: string
  digest: string
  singleLine: boolean
  offset?: number
  run?: { text: string; x: number; y: number }
  marks?: readonly PdfSelectionMark[]
}

// Intersect each real PDF.js text span with the selection, then join spans on
// one baseline. Normalizing viewport rectangles also accounts for canvas zoom.
export function pdfSelectionMarks(
  range: Range,
  page: HTMLElement,
  lines: readonly { item?: number; text: string; x?: number; y?: number }[],
): PdfSelectionMark[] {
  const bounds = page.getBoundingClientRect()
  if (bounds.width <= 0 || bounds.height <= 0) {
    return []
  }
  const fragments = new Map<number, { from: number; to: number; left: number; top: number; right: number; bottom: number }>()
  for (const span of Array.from(page.querySelectorAll<HTMLElement>('[data-pdf-item]'))) {
    if (!range.intersectsNode(span)) {
      continue
    }
    const part = window.document.createRange()
    part.selectNodeContents(span)
    if (range.compareBoundaryPoints(Range.START_TO_START, part) > 0) {
      part.setStart(range.startContainer, range.startOffset)
    }
    if (range.compareBoundaryPoints(Range.END_TO_END, part) < 0) {
      part.setEnd(range.endContainer, range.endOffset)
    }
    if (!part.toString()) {
      continue
    }
    const prefix = window.document.createRange()
    prefix.selectNodeContents(span)
    prefix.setEnd(part.startContainer, part.startOffset)
    const from = Number(span.dataset['offset']) + prefix.toString().length
    const to = from + part.toString().length
    const item = Number(span.dataset['pdfLine'])
    const rect = part.getBoundingClientRect()
    if (!Number.isFinite(from) || !Number.isFinite(item) || rect.width <= 0 || rect.height <= 0) {
      continue
    }
    const old = fragments.get(item)
    fragments.set(item, {
      from: Math.min(from, old?.from ?? from),
      to: Math.max(to, old?.to ?? to),
      left: Math.min(rect.left, old?.left ?? rect.left),
      top: Math.min(rect.top, old?.top ?? rect.top),
      right: Math.max(rect.right, old?.right ?? rect.right),
      bottom: Math.max(rect.bottom, old?.bottom ?? rect.bottom),
    })
  }
  return lines.flatMap((line) => {
    const fragment = line.item === undefined ? undefined : fragments.get(line.item)
    if (!fragment || line.x === undefined || line.y === undefined) {
      return []
    }
    const selected = line.text.slice(fragment.from, fragment.to)
    const quote = selected.trim()
    if (!quote) {
      return []
    }
    const clamp = (value: number) => Math.max(0, Math.min(1, value))
    return [
      {
        quote,
        location: { x: line.x, y: line.y, offset: fragment.from + selected.indexOf(quote) },
        rect: {
          left: clamp((fragment.left - bounds.left) / bounds.width),
          top: clamp((fragment.top - bounds.top) / bounds.height),
          right: clamp((fragment.right - bounds.left) / bounds.width),
          bottom: clamp((fragment.bottom - bounds.top) / bounds.height),
        },
      },
    ]
  })
}

// PDF.js may split a source block into several runs. The one-click path uses
// the engine's original baseline and the exact visible wording. A split or
// otherwise ambiguous run can still be reviewed through the source-line picker.
export function matchSourceBlock(selection: PdfSelection, blocks: PdfTextBlock[], annotations: PdfAnnotation[]) {
  const { run, quote } = selection
  if (!selection.singleLine || !run || !quote) {
    return
  }
  const candidates = blocks.filter((block) => block.baseline && Math.abs(block.baseline[0] - run.x) < 0.5 && Math.abs(block.baseline[1] - run.y) < 0.5)
  if (candidates.length !== 1) {
    return
  }
  const block = candidates[0]
  if (!block) {
    return
  }
  const start = block.text.indexOf(quote)
  if (start < 0 || block.text.indexOf(quote, start + 1) !== -1) {
    return
  }
  const from = Array.from(block.text.slice(0, start)).length
  const to = from + Array.from(quote).length
  const edits = annotations
    .flatMap((item) =>
      item.decision?.status === 'Approved' && !item.withdrawn && item.edit?.page === selection.page - 1 && item.edit.block === block.block ? [item.edit] : [],
    )
    .sort((a, b) => b.offset - a.offset)
  const visible = Array.from(block.text)
  for (const edit of edits) {
    const length = Array.from(edit.expected).length
    if (from < edit.offset + length && edit.offset < to) {
      return
    }
    visible.splice(edit.offset, length, ...Array.from(edit.replacement))
  }
  if (visible.join('') !== run.text || run.text.indexOf(quote) !== run.text.lastIndexOf(quote)) {
    return
  }
  return block
}
