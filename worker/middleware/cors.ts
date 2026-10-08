import { cors } from 'hono/cors';
import type { AppBindings } from '../types';

// CORS for /api/*, from wrangler.jsonc's CORS_ORIGINS var (comma-separated,
// e.g. "https://dryyt.com,https://www.dryyt.com"). Every response carries
// Access-Control-Allow-Origin: the request's Origin when it's listed, else the
// first listed domain (which the browser then rejects for any other origin).
// Credentials are allowed so the session cookie works cross-origin.
export const apiCors = cors({
  origin: (origin, c) => {
    const allowed = ((c.env as AppBindings['Bindings']).CORS_ORIGINS ?? '')
      .split(',')
      .map((o) => o.trim())
      .filter(Boolean);
    return allowed.includes(origin) ? origin : (allowed[0] ?? null);
  },
  credentials: true,
});
