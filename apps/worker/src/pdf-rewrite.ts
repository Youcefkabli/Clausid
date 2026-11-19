import { pdfTextBlocksSchema } from '@clausid/contracts'
import { wasmErrorSchema } from './records.ts'
import wasm from '../../../packages/pdf-engine/dist/pdf_engine_bg.wasm'
import { apply, initSync, inspect, plan } from '../../../packages/pdf-engine/dist/pdf_engine.js'
import type { PdfTextBlock, PdfTextEdit } from '@clausid/contracts'
import { HttpError } from './http.ts'

initSync({ module: wasm })

function rewriteOperation<T>(work: () => T): T {
  try {
    return work()
  } catch (error) {
    if (typeof error === 'string') {
      const failure = wasmErrorSchema.parse(JSON.parse(error))
      throw new HttpError(422, failure.message ?? 'The PDF rewrite could not be applied.')
    }
    throw error
  }
}

export function inspectPdf(bytes: Uint8Array): PdfTextBlock[] {
  return rewriteOperation(() => pdfTextBlocksSchema.parse(JSON.parse(inspect(bytes))))
}

export function planPdfEdit(bytes: Uint8Array, id: string, edit: PdfTextEdit) {
  rewriteOperation(() => plan(bytes, JSON.stringify({ id, ...edit })))
}

export function rewritePdf(bytes: Uint8Array, edits: { id: string; edit: PdfTextEdit }[]): Uint8Array {
  return rewriteOperation(() => {
    const result = apply(bytes, JSON.stringify(edits.map(({ id, edit }) => ({ id, ...edit }))))
    try {
      return result.take_pdf()
    } finally {
      result.free()
    }
  })
}
