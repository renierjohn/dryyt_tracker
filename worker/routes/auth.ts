import { Hono } from 'hono';
import { hashPassword, verifyPassword, generateToken } from '../crypto';
import {
  createUserWithBootstrapRole, getUserByEmail, getRoleById,
  createPasswordReset, consumePasswordReset,
  updatePasswordHash, deleteSessionsForUser, deleteAllPasswordResetsForUser,
} from '../db';
import { createAndSetSession, requireAuth, clearSession } from '../middleware/auth';
import { isValidEmail, toPublicUser } from '../util';
import type { AppBindings } from '../types';

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);

  if (await getUserByEmail(c.env.DB, email)) {
    return c.json({ error: 'email_taken' }, 409);
  }

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUserWithBootstrapRole(c.env.DB, { email, passwordHash: hash, passwordSalt: salt, displayName });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'email_taken' }, 409);
    }
    throw err;
  }

  await createAndSetSession(c, user.id);

  const role = await getRoleById(c.env.DB, user.role_id);
  return c.json({ user: toPublicUser(user, role!) }, 201);
});

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const user = await getUserByEmail(c.env.DB, email);
  if (!user) return c.json({ error: 'invalid_credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) return c.json({ error: 'invalid_credentials' }, 401);

  await createAndSetSession(c, user.id);
  const role = await getRoleById(c.env.DB, user.role_id);
  return c.json({ user: toPublicUser(user, role!) });
});

authRoutes.post('/logout', async (c) => {
  await clearSession(c);
  return c.body(null, 204);
});

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') });
});

authRoutes.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  const devMode = c.env.DEV_MODE === 'true';
  const user = await getUserByEmail(c.env.DB, email);
  if (!user) return c.json({ ok: true });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await createPasswordReset(c.env.DB, token, user.id, expiresAt);

  const url = new URL(c.req.url);
  const resetLink = `${url.origin}/reset-password?token=${token}`;
  console.log(`Password reset link for ${email}: ${resetLink}`);
  return c.json(devMode ? { ok: true, resetLink } : { ok: true });
});

authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);

  // Consume the token atomically (DELETE ... RETURNING) so a concurrent replay of the
  // same token can't both observe it as valid — only the request that deletes the row
  // gets it back. An expired token is still consumed here; that's fine, it's still rejected.
  const reset = await consumePasswordReset(c.env.DB, token);
  if (!reset || new Date(reset.expires_at) < new Date()) {
    return c.json({ error: 'invalid_or_expired_token' }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  await updatePasswordHash(c.env.DB, reset.user_id, hash, salt);
  await deleteSessionsForUser(c.env.DB, reset.user_id);
  await deleteAllPasswordResetsForUser(c.env.DB, reset.user_id);

  return c.json({ ok: true });
});
