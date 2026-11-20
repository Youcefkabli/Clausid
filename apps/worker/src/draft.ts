import { initProseMirrorDoc, relativePositionToAbsolutePosition, updateYFragment } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'

import * as Y from 'yjs'
import type { NativeAnchor } from '@clausid/contracts'
import { draftSchema as schema, validateDraft } from './native-schema.ts'
export { validateDraft } from './native-schema.ts'
import { decode, HttpError } from './http.ts'

export function reviewPassage(draft: Doc, anchor: NativeAnchor, replacement?: string) {
  const fragment = draft.getXmlFragment('default')
  const { doc, mapping, meta } = initProseMirrorDoc(fragment, schema)
  const resolve = (encoded: string) => relativePositionToAbsolutePosition(draft, fragment, Y.decodeRelativePosition(decode(encoded)), mapping)
  let from, to
  try {
    from = resolve(anchor.start)
    to = resolve(anchor.end)
  } catch {
    throw new HttpError(422, 'Invalid passage location.')
  }
  if (from === null || to === null || to <= from || doc.textBetween(from, to, '\n') !== anchor.quote) {
    throw new HttpError(409, 'The selected passage changed. Select it again to make a new suggestion.')
  }
  if (replacement === undefined) {
    return
  }
  // Select All around one text block includes its outer boundaries. Normalize
  // those positions to the inline content before inserting replacement text.
  const block = doc.nodeAt(from)
  if (doc.resolve(from).depth === 0 && block?.isTextblock && from + block.nodeSize === to) {
    from += 1
    to -= 1
  }
  if (!doc.resolve(from).sameParent(doc.resolve(to)) || !doc.resolve(from).parent.isTextblock) {
    throw new HttpError(422, 'Select text in one paragraph for a replacement.')
  }
  // Preserve marks shared by the replaced text, including non-inclusive links
  // at a paragraph end. marksAcross intentionally drops those at that boundary.
  let inherited: typeof doc.marks | undefined
  doc.nodesBetween(from, to, (node) => {
    if (node.isText) {
      inherited = inherited === undefined ? node.marks : inherited.filter((mark) => mark.isInSet(node.marks))
    }
  })
  const content = replacement ? schema.text(replacement, inherited ?? []) : undefined
  const slice = schema.node('doc', null, schema.node('paragraph', null, content)).slice(1, 1 + replacement.length)
  updateYFragment(draft, fragment, doc.replace(from, to, slice), meta)
  validateDraft(draft)
}
