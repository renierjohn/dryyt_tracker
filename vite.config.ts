import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      // apiFetch() calls same-origin `/api/...` paths — proxy them to `wrangler dev`
      // (the worker) so `yarn dev` (vite, HMR) can exercise the real backend instead
      // of 404ing against vite's own dev server.
      '/api': {
        target: 'http://localhost:8788',
        changeOrigin: true,
        // /track's live status WebSocket (/api/plugins/workflow/track/:code/ws).
        ws: true,
      },
    },
  },
})
