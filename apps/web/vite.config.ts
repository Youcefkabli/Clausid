import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'
import stylex from '@stylexjs/unplugin'

const worker = `http://127.0.0.1:${process.env.CLAUSID_HTTP_PORT ?? '8787'}`

export default defineConfig({
  plugins: [stylex.vite({ useCSSLayers: true, runtimeInjection: false }), react()],
  resolve: { dedupe: ['react', 'react-dom', 'yjs', 'y-protocols', 'lib0'] },
  server: {
    port: Number(process.env.CLAUSID_VITE_PORT ?? 5173),
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
