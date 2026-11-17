import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden'
import { useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const styles = stylex.create({ page: { display: 'block', width: '100%', height: 'auto' } })

function PdfPage({ document, number, pageAnchors }: { document: PDFDocumentProxy; number: number; pageAnchors: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    const target = canvas.current
    if (!target) return
    let active = true
    let task: RenderTask | undefined
    const observer = new IntersectionObserver(([entry]) => {
      if (!entry?.isIntersecting) return
      observer.disconnect()
      void document.getPage(number).then(async (page) => {
        if (!active) return
        const base = page.getViewport({ scale: 1 })
        const scale = Math.min(2, Math.sqrt(3_000_000 / (base.width * base.height)))
        const viewport = page.getViewport({ scale })
        target.width = Math.ceil(viewport.width)
        target.height = Math.ceil(viewport.height)
        task = page.render({ canvas: target, viewport })
        await task.promise
        if (!active) return
        setLoaded(true)
        const content = await page.getTextContent().catch(() => null)
        if (active && content) setText(content.items.map((item) => 'str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '').join(''))
      }).catch(() => { if (active) setFailed(true) })
    }, { rootMargin: '400px' })
    observer.observe(target)
    return () => {
      active = false
      observer.disconnect()
      task?.cancel()
    }
  }, [document, number])

  return <VStack id={pageAnchors ? 'contract-pdf-page-' + number : undefined} role="group" aria-label={`PDF page ${number}`} aria-busy={!loaded && !failed}>
    {failed ? <Banner status="error" title={`Page ${number} could not be displayed.`} />
      : <canvas {...stylex.props(styles.page)} ref={canvas} width={612} height={792} role="img" aria-label={`Page ${number}`} />}
    {text && <VisuallyHidden as="p">{text}</VisuallyHidden>}
  </VStack>
}

export default function FrozenPdf({ url, label = 'Frozen contract PDF', pageAnchors = true }: { url: string; label?: string; pageAnchors?: boolean }) {
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const task = getDocument({ url, useWasm: false, isOffscreenCanvasSupported: false })
    void task.promise.then((document) => {
      if (active) setDocument(document)
    }).catch(() => { if (active) setFailed(true) })
    return () => { active = false; void task.destroy().catch(() => undefined) }
  }, [url])

  if (failed) return <Banner status="error" title="Could not display the frozen PDF."
    description="Use Export to open the PDF in a new tab." />
  if (!document) return <Text role="status">Loading PDF…</Text>
  return <VStack gap={4} role="group" aria-label={label}>
    {Array.from({ length: document.numPages }, (_, index) =>
      <PdfPage key={index} document={document} number={index + 1} pageAnchors={pageAnchors} />)}
  </VStack>
}
