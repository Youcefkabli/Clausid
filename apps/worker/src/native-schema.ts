import { getSchema } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import { TextStyle, Color } from '@tiptap/extension-text-style'
import { yDocToProsemirrorJSON } from '@tiptap/y-tiptap'
import type { Doc } from 'yjs'
import { nativeColorSchema, nativeLinkOptions, nativeLinkSchema } from '@clausid/contracts'

export const draftSchema = getSchema([StarterKit.configure({ link: nativeLinkOptions, undoRedo: false, trailingNode: false }), TextStyle, Color])

export function validateDraft(draft: Doc) {
  const document = yDocToProsemirrorJSON(draft, 'default')
  if (!document.content?.length) {
    return
  }
  const parsed = draftSchema.nodeFromJSON(document)
  parsed.check()
  parsed.descendants((node) => {
    for (const mark of node.marks) {
      if (mark.type.name === 'link') {
        nativeLinkSchema.parse(mark.attrs['href'])
      }
      if (mark.type.name === 'textStyle' && mark.attrs['color'] != null) {
        nativeColorSchema.parse(mark.attrs['color'])
      }
    }
  })
}
