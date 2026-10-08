import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'

// Static legal pages live in public/ as privacy.html / terms.html. In
// production Workers Static Assets serves them at /privacy and /terms; vite's
// dev server only knows the .html paths, so map the clean ones to them.
const STATIC_PAGES = ['/privacy', '/terms'];
function staticPages(): Plugin {
  return {
    name: 'static-pages',
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        const path = req.url?.split('?')[0].replace(/\/$/, '');
        if (path && STATIC_PAGES.includes(path)) req.url = `${path}.html`;
        next();
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [staticPages(), react()],
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
