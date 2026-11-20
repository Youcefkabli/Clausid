// Refuse stale/ambiguous display anchors and hit actual drawing strokes, not their empty bounding boxes.
import { describe, expect, it } from 'vite-plus/test'
import { hitsReview, pdfReviewPassage } from '../apps/web/src/app/canvas-editor/review-anchors.ts'
import type { ReviewAnchor } from '../apps/web/src/app/canvas-editor/review-anchors.ts'
import type { Passage } from '../apps/web/src/app/canvas-editor/navigation.ts'

const rows: Passage[] = [
  { key: 'one', page: 1, item: 0, x: 72, y: 650, text: 'Payment schedule' },
  { key: 'two', page: 1, item: 1, x: 72, y: 600, text: 'Pay in 15 days' },
  { key: 'three', page: 2, item: 0, x: 72, y: 600, text: 'Pay in 15 days' },
]
describe('document review anchors', () => {
  it('uses the recorded page, baseline and offset and never falls back from a stale location', () => {
    expect(pdfReviewPassage(rows, 1, '15 days', { x: 72, y: 600, offset: 7 })).toMatchObject({ first: rows[1], from: 7, last: rows[1], to: 14 })
    expect(pdfReviewPassage(rows, 1, '15 days', { x: 72, y: 650, offset: 7 })).toBeUndefined()
    expect(pdfReviewPassage(rows, 1, '30 days', { x: 72, y: 600, offset: 7 })).toBeUndefined()
  })
  it('rejects duplicate legacy quotes within one line or several page lines', () => {
    expect(pdfReviewPassage([...rows, { ...rows[1], key: 'four', page: 1, item: 3, text: 'Pay in 15 days' }], 1, '15 days')).toBeUndefined()
    expect(pdfReviewPassage([{ ...rows[0], key: 'duplicate', page: 1, item: 0, text: '15 days or 15 days' }], 1, '15 days')).toBeUndefined()
    expect(pdfReviewPassage(rows, 2, '15 days')).toMatchObject({ first: rows[2], from: 7 })
  })
  it('maps multi-line browser selections with or without the PDF.js line separator', () => {
    for (const quote of ['Payment schedule\nPay in 15 days', 'Payment schedulePay in 15 days']) {
      expect(pdfReviewPassage(rows, 1, quote)).toMatchObject({ first: rows[0], from: 0, last: rows[1], to: 14 })
    }
    expect(pdfReviewPassage(rows, 1, 'Payment schedule\nChanged terms')).toBeUndefined()
  })
  it('preserves UTF-16 text-layer offsets around non-BMP characters', () => {
    const unicode = [{ key: 'unicode', page: 1, item: 0, text: '⚓ 😀 Pay in 15 days' }]
    expect(pdfReviewPassage(unicode, 1, 'Pay in 15 days')).toMatchObject({ from: 5, to: 19 })
  })
  it('hits a freehand stroke and refuses empty space inside its bounding box', () => {
    const anchor: ReviewAnchor = {
      item: { kind: 'pdf', value: { id: 'drawing', page: 1, author: 'author@example.test', createdAt: '2026-11-19T12:00:00Z', text: '', replies: [] } },
      marker: { left: 0, top: 0, right: 100, bottom: 100 },
      rects: [],
      ranges: [],
      stroke: {
        points: [
          { x: 0, y: 0 },
          { x: 100, y: 100 },
        ],
        radius: 5,
      },
    }
    expect(hitsReview(anchor, 50, 50)).toBe(true)
    expect(hitsReview(anchor, 10, 90)).toBe(false)
  })
})
