import type { PdfAnnotation, PdfTextBlock } from '@clausid/contracts'

export type PdfSelection = {
  page: number; quote: string; digest: string; singleLine: boolean
  offset?: number
  run?: { text: string; x: number; y: number }
}

// PDF.js may split a source block into several runs. The one-click path uses
// the engine's original baseline and the exact visible wording. A split or
// otherwise ambiguous run can still be reviewed through the source-line picker.
export function matchSourceBlock(selection: PdfSelection, blocks: PdfTextBlock[], annotations: PdfAnnotation[]) {
  const {run, quote} = selection
  if (!selection.singleLine || !run || !quote) return
  const candidates = blocks.filter(block => block.baseline && Math.abs(block.baseline[0] - run.x) < 0.5
    && Math.abs(block.baseline[1] - run.y) < 0.5)
  if (candidates.length !== 1) return
  const block = candidates[0]
  const start = block.text.indexOf(quote)
  if (start < 0 || block.text.indexOf(quote, start + 1) !== -1) return
  const from = Array.from(block.text.slice(0, start)).length
  const to = from + Array.from(quote).length
  const edits = annotations.flatMap(item => item.decision?.status === 'Approved' && !item.withdrawn && item.edit?.page === selection.page - 1
    && item.edit.block === block.block ? [item.edit] : []).sort((a,b) => b.offset - a.offset)
  const visible = Array.from(block.text)
  for (const edit of edits) {
    const length = Array.from(edit.expected).length
    if (from < edit.offset + length && edit.offset < to) return
    visible.splice(edit.offset, length, ...Array.from(edit.replacement))
  }
  if (visible.join('') !== run.text || run.text.indexOf(quote) !== run.text.lastIndexOf(quote)) return
  return block
}
