import * as Y from 'yjs'
import { serverMessageSchema } from '@clausid/contracts'
import { ProtocolError } from './response.ts'

// Stage the whole envelope and binary update before a caller can publish either part.
export function parseServerFrame(raw: unknown, document: Y.Doc) {
  try {
    if (typeof raw !== 'string') {
      throw new ProtocolError()
    }
    const value: unknown = JSON.parse(raw)
    const message = serverMessageSchema.parse(value)
    const encoded = message.type === 'edit' ? message.update : message.type === 'state' ? message.draft : undefined
    if (encoded === undefined) {
      return { message }
    }
    const update = Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0))
    const candidate = new Y.Doc()
    try {
      Y.applyUpdate(candidate, Y.encodeStateAsUpdate(document))
      Y.applyUpdate(candidate, update)
      if (candidate.store.pendingStructs || candidate.store.pendingDs) {
        throw new ProtocolError()
      }
    } finally {
      candidate.destroy()
    }
    return { message, update }
  } catch {
    throw new ProtocolError()
  }
}
