// PDF.js exposes outline destinations/children through any; narrow only the values navigation consumes.
function field(value: object, key: string): unknown {
  return Reflect.get(value, key)
}

export function pdfBookmark(value: unknown) {
  if (value === null || typeof value !== 'object') {
    return undefined
  }
  const title = field(value, 'title'),
    destination = field(value, 'dest'),
    children = field(value, 'items')
  if (typeof title !== 'string') {
    return undefined
  }
  const items: readonly unknown[] = Array.isArray(children) ? children : []
  return { title, destination, items }
}

export function pdfPageTarget(value: unknown): number | { num: number; gen: number } | undefined {
  if (!Array.isArray(value)) {
    return undefined
  }
  const first: unknown = value[0]
  if (typeof first === 'number') {
    return Number.isInteger(first) && first >= 0 ? first : undefined
  }
  if (first === null || typeof first !== 'object') {
    return undefined
  }
  const num = field(first, 'num'),
    gen = field(first, 'gen')
  return typeof num === 'number' && Number.isInteger(num) && num >= 0 && typeof gen === 'number' && Number.isInteger(gen) && gen >= 0 ? { num, gen } : undefined
}
