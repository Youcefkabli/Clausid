import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const engine = new URL('../packages/pdf-engine/', import.meta.url)
if (!['pdf_engine.js', 'pdf_engine_bg.wasm'].every((name) => existsSync(new URL('dist/' + name, engine)))) {
  const result = spawnSync('sh', ['build.sh'], { cwd: fileURLToPath(engine), stdio: 'inherit' })
  if (result.error) {
    throw result.error
  }
  if (result.status !== 0) {
    console.error('Build the PDF engine with the pinned Rust toolchain, wasm32-unknown-unknown, and wasm-bindgen-cli 0.2.130.')
    process.exit(result.status ?? 1)
  }
}
