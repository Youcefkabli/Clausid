import { definedProps } from '../../defined-props.ts'
import { requiredValue } from '../../../../../packages/contracts/src/invariant.ts'
import { PdfMarkupLayer, type MarkupControls } from './pdf-markup.tsx'
import * as stylex from '@stylexjs/stylex'
import { Banner } from '@astryxdesign/core/Banner'
import { VStack } from '@astryxdesign/core/Stack'
import { Text } from '@astryxdesign/core/Text'
import { VisuallyHidden } from '@astryxdesign/core/VisuallyHidden'
import { useContext, useEffect, useRef, useState } from 'react'
import { getDocument, GlobalWorkerOptions, TextLayer } from 'pdfjs-dist'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
import { PdfNavigation, type Passage } from './navigation.ts'
import { pdfBookmark, pdfPageTarget } from '../../pdf-bookmarks.ts'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

const styles = stylex.create({
  sheet: {
    position: 'relative',
    boxShadow: 'var(--shadow-med)',
    borderWidth: 'var(--border-width)',
    borderStyle: 'solid',
    borderColor: 'var(--color-border)',
  },
  page: { display: 'block', width: '100%', height: 'auto' },
})

type PdfTextContent = Awaited<ReturnType<Awaited<ReturnType<PDFDocumentProxy['getPage']>>['getTextContent']>>

// PDF.js can emit separate word and whitespace runs for one PDF text line.
// Keep DOM offsets and engine baselines in the same line coordinate system.
function pageLines(content: PdfTextContent, page: number, spans?: HTMLElement[]) {
  const lines: Passage[] = []
  let line: Passage | undefined
  let index = 0
  for (const run of content.items) {
    if (!('str' in run)) {
      continue
    }
    const transform: readonly unknown[] = run.transform
    const x = transform[4],
      y = transform[5]
    if (typeof x !== 'number' || !Number.isFinite(x) || typeof y !== 'number' || !Number.isFinite(y)) {
      throw new Error('Invalid PDF text transform.')
    }
    if (!line || Math.abs(y - requiredValue(line.y)) > 0.5) {
      line = { key: page + '/' + index + '/' + x + ',' + y, page, item: index, text: '', x, y }
      lines.push(line)
    }
    const element = spans?.[index]
    if (element) {
      element['dataset']['pdfItem'] = String(index)
      element['dataset']['pdfLine'] = String(line.item)
      element['dataset']['offset'] = String(line.text.length)
    }
    line.text += run.str
    if (run.hasEOL) {
      line = undefined
    }
    index++
  }
  return lines.filter((row) => row.text.trim())
}

function PdfPage({ document, number, pageAnchors, markup }: { document: PDFDocumentProxy; number: number; pageAnchors: boolean; markup?: MarkupControls }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const lines = useRef<Passage[]>([])
  const holder = useRef<HTMLElement>(null)
  const navigation = useContext(PdfNavigation)
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  const [text, setText] = useState('')

  useEffect(() => {
    const target = canvas.current
    if (!target) {
      return
    }
    let active = true
    let task: RenderTask | undefined
    let layer: TextLayer | undefined
    let resize: ResizeObserver | undefined
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry?.isIntersecting) {
          return
        }
        observer.disconnect()
        void document
          .getPage(number)
          .then(async (page) => {
            if (!active) {
              return
            }
            const base = page.getViewport({ scale: 1 })
            const scale = Math.min(2, Math.sqrt(3_000_000 / (base.width * base.height)))
            const viewport = page.getViewport({ scale })
            target.width = Math.ceil(viewport.width)
            target.height = Math.ceil(viewport.height)
            task = page.render({ canvas: target, viewport })
            await task.promise
            if (!active) {
              return
            }
            setLoaded(true)
            const content = await page.getTextContent().catch(() => null)
            const host = holder.current
            if (active && host && content) {
              layer = new TextLayer({ container: host, textContentSource: content, viewport: base })
              const resizeLayer = () => host.style.setProperty('--total-scale-factor', String(target.clientWidth / base.width))
              resize = new ResizeObserver(resizeLayer)
              resize.observe(target)
              resizeLayer()
              await layer.render()
              lines.current = pageLines(content, number, layer.textDivs)
            }
            if (active && content) {
              setText(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : '')).join(''))
            }
          })
          .catch(() => {
            if (active) {
              setFailed(true)
            }
          })
      },
      { rootMargin: '400px' },
    )
    observer.observe(target)
    return () => {
      active = false
      observer.disconnect()
      resize?.disconnect()
      layer?.cancel()
      task?.cancel()
    }
  }, [document, number])

  function capture() {
    const selection = window.getSelection()
    if (!navigation || !markup?.writable || markup.tool !== 'select' || !selection?.rangeCount || selection.isCollapsed) {
      return
    }
    const range = selection.getRangeAt(0)
    const quote = selection.toString().trim()
    if (!quote || !holder.current?.contains(range.commonAncestorContainer)) {
      return
    }
    const start = range.startContainer.parentElement?.closest<HTMLElement>('[data-pdf-line]')
    const end = range.endContainer.parentElement?.closest<HTMLElement>('[data-pdf-line]')
    const line = lines.current.find((row) => row.item === Number(start?.['dataset']['pdfLine']))
    const singleLine = !!start && start['dataset']['pdfLine'] === end?.['dataset']['pdfLine'] && !!line
    const run = singleLine ? { text: line.text, x: requiredValue(line.x), y: requiredValue(line.y) } : undefined
    navigation.select({
      page: number,
      quote,
      singleLine,
      digest: navigation.digest,
      ...(run ? { run } : {}),
      offset: Number(start?.['dataset']['offset'] ?? 0) + range.startOffset + selection.toString().indexOf(quote),
    })
  }
  return (
    <VStack
      xstyle={styles.sheet}
      id={pageAnchors ? 'contract-pdf-page-' + number : undefined}
      role="group"
      aria-label={`PDF page ${number}`}
      aria-busy={!loaded && !failed}
    >
      {failed ? (
        <Banner status="error" title={`Page ${number} could not be displayed.`} />
      ) : (
        <canvas {...stylex.props(styles.page)} ref={canvas} width={612} height={792} role="img" aria-label={`Page ${number}`} />
      )}
      <section aria-label={`Selectable text on page ${number}`} ref={holder} className="pdf-text-layer" onPointerUp={capture} onKeyUp={capture} />
      {loaded && markup && <PdfMarkupLayer page={number} controls={markup} />}
      {text && <VisuallyHidden as="p">{text}</VisuallyHidden>}
    </VStack>
  )
}

export default function FrozenPdf({
  url,
  label = 'Frozen contract PDF',
  pageAnchors = true,
  markup,
}: {
  url: string
  label?: string
  pageAnchors?: boolean
  markup?: MarkupControls
}) {
  const [document, setDocument] = useState<PDFDocumentProxy>()
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let active = true
    const task = getDocument({ url, useWasm: false, isOffscreenCanvasSupported: false })
    void task.promise
      .then((document) => {
        if (active) {
          setDocument(document)
        }
      })
      .catch(() => {
        if (active) {
          setFailed(true)
        }
      })
    return () => {
      active = false
      void task.destroy().catch(() => undefined)
    }
  }, [url])

  const load = useContext(PdfNavigation)?.load
  useEffect(() => {
    if (!document || !load || !pageAnchors) {
      return
    }
    let active = true
    async function read(pdf: PDFDocumentProxy) {
      const passages: Passage[] = []
      for (let page = 1; page <= pdf.numPages && active; page++) {
        passages.push({ key: 'page-' + page, page, text: 'Page ' + page })
        const sheet = await pdf.getPage(page)
        const content = await sheet.getTextContent()
        passages.push(...pageLines(content, page))
      }
      const tree: unknown = await pdf.getOutline().catch(() => null)
      async function bookmarks(items: unknown, level: number) {
        const entries: readonly unknown[] = Array.isArray(items) ? items : []
        for (const item of entries) {
          if (!active) {
            return
          }
          const entry = pdfBookmark(item)
          if (!entry) {
            continue
          }
          const dest: unknown = typeof entry.destination === 'string' ? await pdf.getDestination(entry.destination) : entry.destination
          const target = pdfPageTarget(dest)
          if (target !== undefined) {
            const index = typeof target === 'number' ? target : await pdf.getPageIndex(target).catch(() => -1)
            if (index >= 0 && index < pdf.numPages) {
              passages.push({ key: 'bookmark/' + index + '/' + entry.title.slice(0, 160), page: index + 1, text: entry.title, level, bookmark: true })
            }
          }
          await bookmarks(entry.items, level + 1)
        }
      }
      if (tree) {
        await bookmarks(tree, 1)
      }
      if (active) {
        requiredValue(load)(passages)
      }
    }
    void read(document).catch(() => {
      if (active) {
        load(Array.from({ length: document.numPages }, (_, i) => ({ key: 'page-' + (i + 1), page: i + 1, text: 'Page ' + (i + 1) })))
      }
    })
    return () => {
      active = false
    }
  }, [document, load, pageAnchors])

  if (failed) {
    return <Banner status="error" title="Could not display the frozen PDF." description="Use Export to open the PDF in a new tab." />
  }
  if (!document) {
    return <Text role="status">Loading PDF…</Text>
  }
  return (
    <VStack gap={8} role="group" aria-label={label}>
      {Array.from({ length: document.numPages }, (_, index) => (
        <PdfPage key={index} document={document} number={index + 1} pageAnchors={pageAnchors} {...definedProps({ markup: markup })} />
      ))}
    </VStack>
  )
}
