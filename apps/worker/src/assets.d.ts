declare module '*.woff' {
  const data: Uint8Array
  export default data
}

declare module '*.wasm' {
  const module: WebAssembly.Module
  export default module
}

declare module '*pdf_engine.js' {
  export function initSync(input: { module: WebAssembly.Module }): unknown
  export function inspect(bytes: Uint8Array): string
  export function plan(bytes: Uint8Array, metadata: string): void
  export function apply(bytes: Uint8Array, metadata: string): { take_pdf(): Uint8Array; free(): void }
}
