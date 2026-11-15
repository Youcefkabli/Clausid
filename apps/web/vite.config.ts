import { defineConfig } from 'vite-plus'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: { dedupe: ['react', 'react-dom', 'yjs', 'y-protocols', 'lib0'] },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8787',
        ws: true,
        configure(proxy) {
          proxy.on('proxyReq', (request, incoming) => {
            request.setHeader('X-Clausid-Client-IP', incoming.socket.remoteAddress ?? '127.0.0.1')
          })
        },
      },
      '/healthz': 'http://127.0.0.1:8787',
    },
  },
})
