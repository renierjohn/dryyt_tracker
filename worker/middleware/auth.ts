import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createSession, createMasqueradeSession, deleteSession, getSessionWithUser } from '../db';
import { generateToken } from '../crypto';
import { toPublicUser } from '../util';
import type { AppBindings } from '../types';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

function setSessionCookie(c: Context<AppBindings>, token: string): void {
  // Derive from hostname, not protocol: a misconfigured proxy or a workers.dev host
  // without "Always Use HTTPS" would otherwise see `http:` in production and issue a
  // non-Secure cookie. Only actual local dev gets a non-Secure cookie.
  const hostname = new URL(c.req.url).hostname;
  const secure = hostname !== 'localhost' && hostname !== '127.0.0.1';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function createAndSetSession(c: Context<AppBindings>, userId: number): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createSession(c.env.DB, token, userId, expiresAt);
  setSessionCookie(c, token);
}

// Swaps the caller's cookie to a session logged in as `targetUserId`, tagged with
// `impersonatorId` so returnFromMasquerade (auth routes) can find its way back. The
// admin's own session row is left untouched (not deleted) — same "multiple valid
// sessions per user" model as logging in from two browsers, just entered differently.
export async function startMasquerade(c: Context<AppBindings>, targetUserId: number, impersonatorId: number): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createMasqueradeSession(c.env.DB, token, targetUserId, expiresAt, impersonatorId);
  setSessionCookie(c, token);
}

// Ends the current masquerade session and mints a fresh one for the original
// impersonator. Returns the impersonator's user id, or null if the caller wasn't
// masquerading (nothing to return from) — impersonatorId comes from the session row
// loadSession already validated, not from anything client-supplied.
export async function returnFromMasquerade(c: Context<AppBindings>): Promise<number | null> {
  const token = getCookie(c, SESSION_COOKIE);
  const impersonatorId = c.get('impersonatorId');
  if (!token || impersonatorId === null) return null;
  await deleteSession(c.env.DB, token);
  await createAndSetSession(c, impersonatorId);
  return impersonatorId;
}

export async function clearSession(c: Context<AppBindings>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await deleteSession(c.env.DB, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
  }
}

export async function loadSession(c: Context<AppBindings>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set('user', null);
    c.set('impersonatorId', null);
    return next();
  }
  const result = await getSessionWithUser(c.env.DB, token);
  if (!result || new Date(result.session.expires_at) < new Date() || !result.user.is_active) {
    c.set('user', null);
    c.set('impersonatorId', null);
    return next();
  }
  c.set('user', toPublicUser(result.user, result.role));
  c.set('impersonatorId', result.session.impersonator_id);
  return next();
}

export async function requireAuth(c: Context<AppBindings>, next: Next) {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  return next();
}

export function requirePermission(permission: string) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (user.id === 1 || user.permissions.includes('*') || user.permissions.includes(permission)) {
      return next();
    }
    return c.json({ error: 'forbidden' }, 403);
  };
}

// Unlike requirePermission, this checks the caller's role by name rather than their
// granted permissions — a role can never gain access by being handed a permission
// string, only by literally being renamed/reassigned to `roleName`.
export function requireRole(roleName: string) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (user.role_name === roleName) return next();
    return c.json({ error: 'forbidden' }, 403);
  };
}
