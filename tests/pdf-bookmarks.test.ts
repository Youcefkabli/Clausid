// Narrow producer-shaped PDF.js named/index/reference destinations and reject malformed values before page-index calls.
import { expect, it } from 'vite-plus/test'
import { pdfBookmark, pdfPageTarget } from '../apps/web/src/pdf-bookmarks.ts'

it('retains bookmark text, child entries and named/index/reference destinations', () => {
  const children = [{ title: 'Child', dest: [2], items: [] }]
  expect(pdfBookmark({ title: 'Heading', dest: 'named', items: children })).toEqual({ title: 'Heading', destination: 'named', items: children })
  expect(pdfBookmark({ title: 'Heading', dest: [0], items: children })?.items).toBe(children)
  expect(pdfPageTarget([0, { name: 'XYZ' }, null])).toBe(0)
  expect(pdfPageTarget([{ num: 7, gen: 0 }, { name: 'Fit' }])).toEqual({ num: 7, gen: 0 })
})

it('does not pass malformed destinations or outline children into typed PDF.js methods', () => {
  for (const value of [null, 7, [], { title: 7 }, {}]) {
    expect(pdfBookmark(value)).toBeUndefined()
  }
  expect(pdfBookmark({ title: 'Legacy leaf', dest: null })?.items).toEqual([])
  for (const value of [null, {}, [], [-1], [NaN], [1.5], [{}], [{ num: '7', gen: 0 }], [{ num: 7, gen: -1 }]]) {
    expect(pdfPageTarget(value)).toBeUndefined()
  }
})
