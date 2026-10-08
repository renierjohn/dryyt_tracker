import type { Context, Next } from 'hono';
import type { AppBindings } from '../types';

const MAX_AGE = 5;
// The owner's transaction list (and everything under it) and the public
// /track lookup must always be fresh.
const NO_CACHE_PREFIXES = ['/api/plugins/workflow/transactions', '/api/plugins/workflow/track'];

// Default 5-second cache for successful GET responses. Routes that set their
// own Cache-Control (e.g. immutable avatars) keep it; responses that set a
// cookie or aren't 200 are never cached.
export async function cacheControl(c: Context<AppBindings>, next: Next): Promise<void> {
  await next();
  if (c.req.method !== 'GET' && c.req.method !== 'HEAD') return;
  if (c.res.status !== 200) return;
  if (c.res.headers.has('Cache-Control') || c.res.headers.has('Set-Cookie')) return;

  const noCache = NO_CACHE_PREFIXES.some((p) => c.req.path === p || c.req.path.startsWith(`${p}/`));
  c.header('Cache-Control', noCache ? 'no-store' : `public, max-age=${MAX_AGE}`);
}
