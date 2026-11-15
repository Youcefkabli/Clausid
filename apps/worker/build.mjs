import { build } from 'esbuild'
await build({
  entryPoints: ['src/index.ts'],
  outfile: 'dist/worker.mjs',
  bundle: true,
  format: 'esm',
  platform: 'browser',
  target: 'es2023',
  external: ['cloudflare:workers'],
  loader: { '.woff': 'binary' },
})
