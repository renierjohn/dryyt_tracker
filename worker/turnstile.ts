import type { Env } from './types';

const SITEVERIFY = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

// Verifies a Turnstile token server-side. Fails closed: a missing/oversized token,
// a siteverify outage, or a token minted for another action or hostname all reject.
// The frontend is served by this same Worker, so the token's hostname must match the
// request's. With no secret configured, only DEV_MODE (local + tests) skips the check.
export async function verifyTurnstile(env: Env, req: Request, token: unknown, action: string): Promise<boolean> {
  if (!env.TURNSTILE_SECRET_KEY) return env.DEV_MODE === 'true';
  if (typeof token !== 'string' || token.length === 0 || token.length > 2048) return false;

  let result: { success?: boolean; action?: string; hostname?: string };
  try {
    const res = await fetch(SITEVERIFY, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      signal: AbortSignal.timeout(10_000),
      body: new URLSearchParams({
        secret: env.TURNSTILE_SECRET_KEY,
        response: token,
        remoteip: req.headers.get('CF-Connecting-IP') ?? '',
      }),
    });
    if (!res.ok) return false;
    result = await res.json();
  } catch {
    return false;
  }
  return result.success === true && result.action === action && result.hostname === new URL(req.url).hostname;
}
