import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../crypto';
import { createUserWithBootstrapRole, getUserByEmail, getRoleById } from '../db';
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
  const user = await createUserWithBootstrapRole(c.env.DB, { email, passwordHash: hash, passwordSalt: salt, displayName });

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
