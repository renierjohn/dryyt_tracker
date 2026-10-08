import { cors } from 'hono/cors';
import type { AppBindings } from '../types';

// CORS for /api/*: Access-Control-Allow-Origin echoes the request's Origin when
// it's listed in CORS_ORIGINS (comma-separated, e.g.
// "https://dryyt.com,https://www.dryyt.com"); any other origin gets no CORS
// headers. Credentials are allowed so the session cookie works cross-origin.
export const apiCors = cors({
  origin: (origin, c) => {
    const allowed = (c.env as AppBindings['Bindings']).CORS_ORIGINS?.split(',').map((o) => o.trim()) ?? [];
    return allowed.includes(origin) ? origin : null;
  },
  credentials: true,
});
