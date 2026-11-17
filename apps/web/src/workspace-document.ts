import { toBase64 } from './base64.ts'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import { workspaceDocument } from '@clausid/contracts'

GlobalWorkerOptions.workerSrc = workerUrl

export async function prepareWorkspaceDocument(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer())
  const attachment = workspaceDocument.safeParse({ name: file.name, data: toBase64(bytes) })
  if (!attachment.success) throw new Error('Choose a PDF file up to 1 MB.')

  const task = getDocument({ data: bytes, useWasm: false, isOffscreenCanvasSupported: false })
  try {
    const pdf = await task.promise
    for (let number = 1; number <= pdf.numPages; number++) {
      const page = await pdf.getPage(number)
      const content = await page.getTextContent()
      if (content.items.some(item => 'str' in item && item.str.trim())) return attachment.data
    }
  } catch {
    throw new Error('Choose a readable, unencrypted PDF.')
  } finally {
    await task.destroy().catch(() => undefined)
  }
  throw new Error('Choose a PDF with selectable text. Scanned PDFs are unsupported.')
}
