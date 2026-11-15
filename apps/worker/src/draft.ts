import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'

const schema = getSchema([StarterKit.configure({ link: false, undoRedo: false, trailingNode: false })])

export function validateDraft(draft: Doc) {
  const document = yDocToProsemirrorJSON(draft, 'default')
  if (!document.content?.length) return
  schema.nodeFromJSON(document).check()
}
