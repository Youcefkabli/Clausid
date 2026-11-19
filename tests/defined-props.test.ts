// Verify exact-optional React props omit undefined while preserving meaningful falsy values, references and single getter evaluation.
import { expect, it } from 'vite-plus/test'
import { definedProps } from '../apps/web/src/defined-props.ts'

it('keeps required/literal and falsy props while removing only undefined', () => {
  const onClick = () => undefined
  const result = definedProps({ label: 'Retry', status: undefined, disabled: false, count: 0, text: '', value: null, onClick })
  expect(result).toEqual({ label: 'Retry', disabled: false, count: 0, text: '', value: null, onClick })
  expect(Object.hasOwn(result, 'status')).toBe(false)
  expect(result.onClick).toBe(onClick)
})

it('evaluates an own enumerable getter once and preserves symbol props without prototype pollution', () => {
  let reads = 0
  const symbol = Symbol('identity')
  const input = {
    get label() {
      reads++
      return 'Retry'
    },
    [symbol]: 'keep',
  }
  Object.defineProperty(input, '__proto__', { value: 'ordinary data', enumerable: true })
  const result = definedProps(input)
  expect(reads).toBe(1)
  expect(Reflect.get(result, symbol)).toBe('keep')
  expect(Reflect.get(result, '__proto__')).toBe('ordinary data')
  expect(Object.getPrototypeOf(result)).toBe(Object.prototype)
})
