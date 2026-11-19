// Require programmer-owned state explicitly; external operating data still needs its boundary parser.
export function requiredValue<T>(value: T | null | undefined, message = 'Required internal state is missing.'): T {
  if (value === undefined || value === null) {
    throw new Error(message)
  }
  return value
}
