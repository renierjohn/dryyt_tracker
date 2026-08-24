import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../crypto';
import { getUserByEmail, getUserById, updateUserProfile, updatePasswordHash, deleteSessionsForUser } from '../db';
import { requireAuth, createAndSetSession } from '../middleware/auth';
import { isValidEmail, toPublicUser } from '../util';
import { getRoleById } from '../db';
import type { AppBindings } from '../types';

export const profileRoutes = new Hono<AppBindings>();

profileRoutes.use('*', requireAuth);

profileRoutes.get('/', async (c) => {
  const authUser = c.get('user')!;
  const user = await getUserById(c.env.DB, authUser.id);
  const role = await getRoleById(c.env.DB, user!.role_id);
  return c.json({ user: toPublicUser(user!, role!) });
});

profileRoutes.put('/', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;

  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== authUser.id) {
      return c.json({ error: 'email_taken' }, 409);
    }
  }
  if (displayName !== undefined && !displayName) {
    return c.json({ error: 'missing_display_name' }, 400);
  }

  let updated;
  try {
    updated = await updateUserProfile(c.env.DB, authUser.id, { displayName, email });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) {
      return c.json({ error: 'email_taken' }, 409);
    }
    throw err;
  }
  const role = await getRoleById(c.env.DB, updated.role_id);
  return c.json({ user: toPublicUser(updated, role!) });
});

profileRoutes.put('/password', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const currentPassword = typeof body?.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';

  if (newPassword.length < 8) return c.json({ error: 'weak_password' }, 400);

  const user = await getUserById(c.env.DB, authUser.id);
  const valid = await verifyPassword(currentPassword, user!.password_hash, user!.password_salt);
  if (!valid) return c.json({ error: 'invalid_credentials' }, 401);

  const { hash, salt } = await hashPassword(newPassword);
  await updatePasswordHash(c.env.DB, authUser.id, hash, salt);
  await deleteSessionsForUser(c.env.DB, authUser.id);
  await createAndSetSession(c, authUser.id);

  return c.json({ ok: true });
});
