import { build } from 'esbuild'
import '../../scripts/build-pdf-engine.mjs'
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  external: ['cloudflare:workers'],
  loader: { '.woff': 'binary' },
  plugins: [{
    name: 'workerd-pdf-wasm',
    setup(build) {
      build.onResolve({ filter: /pdf_engine_bg\.wasm$/ }, () => ({ path: './pdf_engine_bg.wasm', external: true }))
    },
  }],
})
