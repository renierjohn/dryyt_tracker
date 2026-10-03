import { Hono } from 'hono';
import { createUser, getUserByEmail, getRoleByName, listUsersByParent } from '../db';
import { requireRole } from '../middleware/auth';
import { hashPassword } from '../crypto';
import { isValidEmail } from '../util';
import type { AppBindings } from '../types';

// Self-service: an 'owner' role user creates and lists their own child accounts
// (always role 'user', parent_id set to the owner), separate from the
// superadmin-only /admin/users console.
export const ownerRoutes = new Hono<AppBindings>();

ownerRoutes.use('*', requireRole('owner'));

ownerRoutes.get('/users', async (c) => {
  const owner = c.get('user')!;
  const users = await listUsersByParent(c.env.DB, owner.id);
  return c.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      is_active: u.is_active,
      created_at: u.created_at,
    })),
  });
});

ownerRoutes.post('/users', async (c) => {
  const owner = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (await getUserByEmail(c.env.DB, email)) return c.json({ error: 'email_taken' }, 409);

  const userRole = await getRoleByName(c.env.DB, 'user');
  if (!userRole) return c.json({ error: 'role_not_configured' }, 500);

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUser(c.env.DB, {
      email,
      passwordHash: hash,
      passwordSalt: salt,
      roleId: userRole.id,
      displayName,
      parentId: owner.id,
    });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  return c.json(
    {
      user: {
        id: user.id,
        email: user.email,
        display_name: user.display_name,
        is_active: user.is_active,
        created_at: user.created_at,
      },
    },
    201,
  );
});

export default ownerRoutes;
