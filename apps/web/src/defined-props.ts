// Omit absent optional properties at the React/platform boundary without changing present values or evaluating getters twice.
export type DefinedProps<T extends Record<string, unknown>> = {
  [K in keyof T as undefined extends T[K] ? never : K]: T[K]
} & {
  [K in keyof T as undefined extends T[K] ? K : never]?: Exclude<T[K], undefined>
}

export function definedProps<const T extends Record<string, unknown>>(props: T): DefinedProps<T> {
  const prototype: unknown = Object.getPrototypeOf(props)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error('Expected a plain props record.')
  }
  const result: Record<PropertyKey, unknown> = {}
  for (const key of Reflect.ownKeys(props)) {
    if (!Object.prototype.propertyIsEnumerable.call(props, key)) {
      continue
    }
    const value: unknown = Reflect.get(props, key)
    if (value !== undefined) {
      Object.defineProperty(result, key, { value, enumerable: true, writable: true, configurable: true })
    }
  }
  // Validated mapped adapter: the loop retains every present enumerable value unchanged and
  // omits only undefined. Required keys and literal types are preserved by DefinedProps.
  return result as DefinedProps<T>
}
