import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { initProseMirrorDoc, relativePositionToAbsolutePosition, updateYFragment, yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'

import * as Y from 'yjs'
import type { NativeAnchor } from '@clausid/contracts'
import { decode, HttpError } from './http.ts'

const schema = getSchema([StarterKit.configure({ link: false, undoRedo: false, trailingNode: false })])

export function validateDraft(draft: Doc) {
  const document = yDocToProsemirrorJSON(draft, 'default')
  if (!document.content?.length) {
    return
  }
  schema.nodeFromJSON(document).check()
}

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
  if (!doc.resolve(from).sameParent(doc.resolve(to))) {
    throw new HttpError(422, 'Select text in one paragraph for a replacement.')
  }
  const content = replacement ? schema.text(replacement, doc.resolve(from).marksAcross(doc.resolve(to)) ?? []) : undefined
  const slice = schema.node('doc', null, schema.node('paragraph', null, content)).slice(1, 1 + replacement.length)
  updateYFragment(draft, fragment, doc.replace(from, to, slice), meta)
  validateDraft(draft)
}
