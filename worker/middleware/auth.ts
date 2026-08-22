import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createSession, deleteSession, getSessionWithUser } from '../db';
import { generateToken } from '../crypto';
import { toPublicUser } from '../util';
import type { AppBindings } from '../types';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createAndSetSession(c: Context<AppBindings>, userId: number): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createSession(c.env.DB, token, userId, expiresAt);
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
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
    return next();
  }
  const result = await getSessionWithUser(c.env.DB, token);
  if (!result || new Date(result.session.expires_at) < new Date()) {
    c.set('user', null);
    return next();
  }
  c.set('user', toPublicUser(result.user, result.role));
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
