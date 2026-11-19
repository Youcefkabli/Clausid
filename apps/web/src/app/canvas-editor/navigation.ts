import { requiredValue } from '../../../../../packages/contracts/src/invariant.ts'
import { createContext } from 'react'
import type { Editor } from '@tiptap/core'
import { absolutePositionToRelativePosition, relativePositionToAbsolutePosition, ySyncPluginKey } from '@tiptap/y-tiptap'
import * as Y from 'yjs'
import type { NativeAnchor, OutlineCorrection } from '@clausid/contracts'
import { toBase64 } from '../../base64.ts'

export type Passage = {
  key: string
  text: string
  page?: number
  item?: number
  offset?: number
  description?: string
  x?: number
  y?: number
  position?: number
  level?: number
  title?: string
  bookmark?: boolean
}
import type { PdfSelection } from '../../pdf-selection.ts'
export type { PdfSelection } from '../../pdf-selection.ts'
export const PdfNavigation = createContext<{
  load: (passages: Passage[]) => void
  select: (selection: PdfSelection) => void
  digest: string
} | null>(null)

export function nativePosition(editor: Editor, pos: number) {
  const sync = ySyncPluginKey.getState(editor.state)
  if (!sync?.binding) {
    return ''
  }
  return toBase64(Y.encodeRelativePosition(absolutePositionToRelativePosition(pos, sync.type, sync.binding.mapping)))
}
export function nativeSelection(editor: Editor): NativeAnchor | undefined {
  const { from, to } = editor.state.selection
  const quote = editor.state.doc.textBetween(from, to, '\n')
  if (!quote || quote.length > 800) {
    return
  }
  return { start: nativePosition(editor, from), end: nativePosition(editor, to), quote }
}
export function locateNative(editor: Editor, anchor: NativeAnchor) {
  const sync = ySyncPluginKey.getState(editor.state)
  if (!sync?.binding) {
    return false
  }
  const resolve = (value: string) =>
    relativePositionToAbsolutePosition(
      sync.doc,
      sync.type,
      Y.decodeRelativePosition(Uint8Array.from(atob(value), (c) => c.charCodeAt(0))),
      sync.binding.mapping,
    )
  const from = resolve(anchor.start),
    to = resolve(anchor.end)
  if (from === null || to === null || editor.state.doc.textBetween(from, to, '\n') !== anchor.quote) {
    return false
  }
  return editor.chain().focus().setTextSelection({ from, to }).scrollIntoView().run()
}

export function outline(passages: Passage[], corrections: OutlineCorrection[]) {
  const overrides = new Map(corrections.map((item) => [item.key, item]))
  const rows: Passage[] = []
  for (const line of passages) {
    const override = overrides.get(line.key)
    if (override?.hidden) {
      continue
    }
    const numbered = /^(\d+(?:\.\d+)*)(?:[.)]|\s)\s*\S/.exec(line.text)
    const named = /^(article|section|schedule|appendix|annex)\s+[\w.-]+(?:\s|$|[.:])/i.test(line.text)
    const level = override?.level ?? line.level ?? (numbered ? requiredValue(numbered[1]).split('.').length : named ? 1 : 0)
    if (level) {
      rows.push({ ...line, level, title: override?.title ?? line.title ?? line.text })
    }
  }
  const bookmarks = new Set(rows.filter((row) => row.bookmark).map((row) => row.page + '/' + row.text.trim().toLowerCase()))
  const ordered = rows
    .filter((row) => row.bookmark || !bookmarks.has(row.page + '/' + row.text.trim().toLowerCase()))
    .sort((a, b) => (a.page ?? 0) - (b.page ?? 0) || (a.item ?? -1) - (b.item ?? -1))
  return ordered.length ? ordered : passages.filter((line) => line.page && line.item === undefined && !line.bookmark && !overrides.get(line.key)?.hidden)
}

export function indexEntries(passages: Passage[], query: string, corrections: OutlineCorrection[] = []) {
  const lines = passages.filter((line) => line.position !== undefined || line.item !== undefined)
  const terms = new Map<string, Set<string>>()
  for (const line of lines) {
    for (const match of line.text.matchAll(/(?:[“"]([^"”\n]{1,100})[”"]|^([A-Z][\w -]{0,60}?))\s+(?:means|refers to|shall mean|is defined as)\b/gi)) {
      const word = requiredValue(match[1] ?? match[2])
      const definitions = terms.get(word) ?? new Set<string>()
      definitions.add(line.key)
      terms.set(word, definitions)
    }
  }
  const sections = outline(passages, corrections)
  const entries = new Map<string, Passage[]>()
  function add(label: string, line: Passage, offset: number, text: string, description?: string) {
    const list = entries.get(label) ?? []
    list.push({ ...line, offset, text, ...(description === undefined ? {} : { description }) })
    entries.set(label, list)
  }
  for (const line of lines) {
    const lower = line.text.toLowerCase()
    for (const [term, definitions] of terms) {
      const word = term.toLowerCase()
      for (let at = lower.indexOf(word); at >= 0; at = lower.indexOf(word, at + word.length)) {
        if (/[\p{L}\p{N}_]/u.test(lower[at - 1] ?? '') || /[\p{L}\p{N}_]/u.test(lower[at + word.length] ?? '')) {
          continue
        }
        const description = definitions.has(line.key) ? (definitions.size > 1 ? 'Multiple definitions' : 'Definition') : 'Occurrence'
        add(term, line, at, line.text.slice(at, at + word.length), description)
      }
    }
    for (const ref of line.text.matchAll(/\b(Section|Clause|Article|Schedule)\s+(\d+(?:\.\d+)*|[IVXLCDM]+|[A-Z])\b/gi)) {
      const label = requiredValue(requiredValue(ref[1])[0]).toUpperCase() + requiredValue(ref[1]).slice(1).toLowerCase() + ' ' + ref[2]
      const targets = sections.filter((section) => {
        const number = /^(?:(section|clause|article|schedule)\s+)?(\d+(?:\.\d+)*|[IVXLCDM]+|[A-Z])(?=[\s.):]|$)/i.exec(section.title ?? section.text)
        return (
          number &&
          (!number[1] || number[1].toLowerCase() === requiredValue(ref[1]).toLowerCase()) &&
          requiredValue(number[2]).toLowerCase() === requiredValue(ref[2]).toLowerCase()
        )
      })
      if (!entries.has(label)) {
        for (const target of targets) {
          add(label, target, 0, target.text, targets.length > 1 ? 'Ambiguous target' : 'Target')
        }
      }
      if (!targets.some((target) => target.key === line.key)) {
        add(label, line, ref.index, ref[0], targets.length ? 'Reference' : 'Missing target')
      }
    }
    const needle = query.trim().toLowerCase()
    if (needle && !terms.has(query)) {
      for (let at = lower.indexOf(needle); at >= 0; at = lower.indexOf(needle, at + needle.length)) {
        add('Text matches', line, at, line.text.slice(at, at + needle.length))
      }
    }
  }
  return [...entries].filter(([label]) => label === 'Text matches' || label.toLowerCase().includes(query.toLowerCase())).sort(([a], [b]) => a.localeCompare(b))
}
