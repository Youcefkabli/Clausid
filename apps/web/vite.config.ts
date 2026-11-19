import { existsSync, realpathSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

const worker = `http://127.0.0.1:${process['env']['CLAUSID_HTTP_PORT'] ?? '8787'}`
const workspaceRoot = fileURLToPath(new URL('../../', import.meta.url))
const dependencyStore = join(workspaceRoot, 'node_modules', '.pnpm')

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true, runtimeInjection: false }), react()],
  resolve: { dedupe: ['react', 'react-dom', 'yjs', 'y-protocols', 'lib0'] },
  server: {
    // Verification snapshots reuse the installed store; workspace source stays in the snapshot.
    fs: { allow: [workspaceRoot, ...(existsSync(dependencyStore) ? [realpathSync(dependencyStore)] : [])] },
    port: Number(process['env']['CLAUSID_VITE_PORT'] ?? 5173),
    strictPort: true,
    proxy: {
      '/api': {
        target: worker,
        ws: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            request.setHeader('X-Clausid-Client-IP', incoming.socket.remoteAddress ?? '127.0.0.1')
          })
        },
      },
      '/healthz': worker,
    },
  },
})
