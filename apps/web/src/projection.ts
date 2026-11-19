import type { ResponseSchema } from '@clausid/contracts'

export type Projection<T> = { readonly kind: 'missing' } | { readonly kind: 'ready'; readonly data: T } | { readonly kind: 'invalid'; readonly message: string }

export function parseProjection<T>(value: string | undefined, schema: ResponseSchema<T>): Projection<T> {
  if (value === undefined) {
    return { kind: 'missing' }
  }
  try {
    const data: unknown = JSON.parse(value)
    const parsed = schema.safeParse(data)
    if (parsed.success) {
      return { kind: 'ready', data: parsed.data }
    }
  } catch {
    /* The invalid result uses a safe message, never the document body. */
  }
  return { kind: 'invalid', message: 'The document view could not be read. Retry loading it.' }
}
