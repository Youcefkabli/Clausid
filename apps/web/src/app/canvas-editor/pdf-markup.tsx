import * as stylex from '@stylexjs/stylex'
import { useEffect, useRef } from 'react'
import type { PointerEvent } from 'react'
import type { PdfAnnotation, PdfMarkup } from '@clausid/contracts'

export type MarkupTool = PdfMarkup['tool'] | 'select'
export type MarkupControls = {
  tool: MarkupTool
  setTool: (tool: MarkupTool) => void
  annotations: PdfAnnotation[]
  writable: boolean
  busy: boolean
  add: (page: number, markup: PdfMarkup) => Promise<unknown>
  undo?: () => void
  redo?: () => void
}

const styles = stylex.create({
  overlay: { position: 'absolute', inset: 0, width: '100%', height: '100%' },
  drawing: { touchAction: 'none', cursor: 'crosshair' },
  viewing: { pointerEvents: 'none' },
})

export function PdfMarkupLayer({ page, controls }: { page: number; controls: MarkupControls }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const stroke = useRef<PdfMarkup | null>(null)
  const active = controls.writable && !controls.busy && controls.tool !== 'select'
  function paint() {
    const target = canvas.current
    const context = target?.getContext('2d')
    if (!target || !context) return
    context.clearRect(0, 0, target.width, target.height)
    const marks = controls.annotations.filter(item => item.page === page && !item.withdrawn && !item.decision).flatMap(item => item.markup ? [item.markup] : [])
    if (stroke.current) marks.push(stroke.current)
    for (const mark of marks) {
      context.beginPath()
      context.strokeStyle = mark.tool === 'highlight' ? '#ffcc00' : '#1f386b'
      context.globalAlpha = mark.tool === 'highlight' ? 0.3 : 1
      context.lineWidth = mark.tool === 'highlight' ? 12 : mark.tool === 'brush' ? 6 : 1.5
      context.lineWidth *= target.width / 612
      context.lineCap = 'round'
      context.lineJoin = 'round'
      mark.points.forEach((point, index) => {
        const x = point.x * target.width
        const y = point.y * target.height
        if (index === 0) context.moveTo(x, y)
        else context.lineTo(x, y)
      })
      context.stroke()
    }
  }
  useEffect(() => {
    const target = canvas.current
    if (!target) return
    const observer = new ResizeObserver(() => {
      target.width = Math.max(1, Math.round(target.clientWidth))
      target.height = Math.max(1, Math.round(target.clientHeight))
      paint()
    })
    observer.observe(target)
    return () => observer.disconnect()
  }, [controls.annotations, page])
  useEffect(() => {
    stroke.current = null
    paint()
  }, [controls.tool, controls.writable, controls.annotations])
  function point(event: PointerEvent<HTMLCanvasElement>) {
    const bounds = event.currentTarget.getBoundingClientRect()
    return { x: Math.max(0, Math.min(1, (event.clientX - bounds.left) / bounds.width)),
      y: Math.max(0, Math.min(1, (event.clientY - bounds.top) / bounds.height)) }
  }
  function move(event: PointerEvent<HTMLCanvasElement>) {
    const mark = stroke.current
    if (!mark) return
    const next = point(event)
    if (mark.tool === 'underline' || mark.tool === 'strikethrough' || mark.tool === 'highlight') {
      mark.points = [mark.points[0], { x: next.x, y: mark.points[0].y }]
    } else {
      if (mark.points.length >= 256) mark.points = mark.points.filter((_, index) => index % 2 === 0)
      mark.points.push(next)
    }
    paint()
  }
  return <canvas ref={canvas} {...stylex.props(styles.overlay, active ? styles.drawing : styles.viewing)}
    aria-label={`Drawing annotations on sheet ${page}`} role="img"
    onPointerDown={event => {
      if (!active || event.button !== 0 || !event.isPrimary) return
      event.currentTarget.setPointerCapture(event.pointerId)
      const start = point(event)
      stroke.current = { tool: controls.tool as PdfMarkup['tool'], points: [start, start] }
      paint()
    }}
    onPointerMove={move}
    onPointerUp={event => {
      if (!stroke.current) return
      move(event)
      const mark = stroke.current
      stroke.current = null
      event.currentTarget.releasePointerCapture(event.pointerId)
      void controls.add(page, mark).finally(paint)
    }}
    onPointerCancel={() => { stroke.current = null; paint() }}
    onLostPointerCapture={() => { stroke.current = null; paint() }} />
}
