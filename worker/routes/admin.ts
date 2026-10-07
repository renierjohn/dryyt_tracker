import { Hono } from 'hono';
import { getUserById, searchUsersWithRoles, userStats, updateUserAdminFields, setUserActive, getUserByEmail, getRoleById, listRoles, createUser, deleteSessionsForUser, listSessions, deleteExpiredSessions } from '../db';
import { requireRole, startMasquerade } from '../middleware/auth';
import { hashPassword } from '../crypto';
import { isValidEmail, toPublicUser } from '../util';
import type { AppBindings } from '../types';
import { likePattern, parsePage, PAGE_SIZE } from '../pagination';

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', requireRole('superadmin'));

// Paginated: ?page=, ?q= (name/email), ?role= (role name), ?status=active|inactive.
adminRoutes.get('/users', async (c) => {
  const { page, limit, offset } = parsePage(c.req.query('page'));
  const q = c.req.query('q')?.trim() ?? '';
  const role = c.req.query('role') || null;
  const status = c.req.query('status');
  const active = status === 'active' ? true : status === 'inactive' ? false : null;
  const [{ users, total }, stats] = await Promise.all([
    searchUsersWithRoles(c.env.DB, { q: q ? likePattern(q) : '', role, active, limit, offset }),
    userStats(c.env.DB),
  ]);
  return c.json({
    page,
    page_size: PAGE_SIZE,
    total,
    stats,
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      avatar_key: u.avatar_key,
      role_id: u.role_id,
      role_name: u.role_name,
      parent_id: u.parent_id,
      is_active: u.is_active,
      created_at: u.created_at,
    })),
  });
});

const SESSIONS_LIMIT = 200;

// Every login session, split into active and expired (each newest first, at
// most SESSIONS_LIMIT rows; the totals are exact).
adminRoutes.get('/sessions', async (c) => {
  const { active, expired, activeTotal, expiredTotal } = await listSessions(c.env.DB, SESSIONS_LIMIT);
  return c.json({ active, expired, active_total: activeTotal, expired_total: expiredTotal });
});

// Expired sessions are already rejected at sign-in (loadSession); this just
// clears the rows out.
adminRoutes.delete('/sessions/expired', async (c) => {
  return c.json({ deleted: await deleteExpiredSessions(c.env.DB) });
});

// Superadmin (id 1) is excluded: it can never be assigned via the create/edit
// forms (both reject role_id 1 with cannot_assign/change_superadmin_role).
adminRoutes.get('/roles', async (c) => {
  const roles = await listRoles(c.env.DB);
  return c.json({ roles: roles.filter((r) => r.id !== 1).map((r) => ({ id: r.id, name: r.name })) });
});

adminRoutes.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  const roleId = typeof body?.role_id === 'number' ? body.role_id : NaN;

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  if (Number.isInteger(roleId) && roleId === 1) return c.json({ error: 'cannot_assign_superadmin_role' }, 400);
  const role = Number.isInteger(roleId) ? await getRoleById(c.env.DB, roleId) : null;
  if (!role) return c.json({ error: 'invalid_role' }, 400);

  if (await getUserByEmail(c.env.DB, email)) return c.json({ error: 'email_taken' }, 409);

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUser(c.env.DB, { email, passwordHash: hash, passwordSalt: salt, roleId, displayName });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  return c.json({ user: toPublicUser(user, role) }, 201);
});

adminRoutes.put('/users/:id', async (c) => {
  const targetId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const roleId = typeof body?.role_id === 'number' ? body.role_id : undefined;

  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  if (displayName !== undefined && !displayName) {
    return c.json({ error: 'missing_display_name' }, 400);
  }

  if (roleId !== undefined && roleId === 1) {
    return c.json({ error: 'cannot_assign_superadmin_role' }, 400);
  }
  if (roleId !== undefined && targetId === 1) {
    return c.json({ error: 'cannot_change_superadmin_role' }, 400);
  }
  const newRole = roleId !== undefined ? await getRoleById(c.env.DB, roleId) : null;
  if (roleId !== undefined && !newRole) return c.json({ error: 'invalid_role' }, 400);

  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== targetId) return c.json({ error: 'email_taken' }, 409);
  }

  const updated = await updateUserAdminFields(c.env.DB, targetId, { displayName, email, roleId });
  const role = await getRoleById(c.env.DB, updated.role_id);
  return c.json({ user: toPublicUser(updated, role!) });
});

adminRoutes.post('/users/:id/deactivate', async (c) => {
  const targetId = Number(c.req.param('id'));
  if (targetId === 1) return c.json({ error: 'cannot_deactivate_superadmin' }, 400);

  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  await setUserActive(c.env.DB, targetId, false);
  await deleteSessionsForUser(c.env.DB, targetId);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/masquerade', async (c) => {
  const admin = c.get('user')!;
  const targetId = Number(c.req.param('id'));

  if (targetId === admin.id) return c.json({ error: 'cannot_masquerade_as_self' }, 400);
  if (targetId === 1) return c.json({ error: 'cannot_masquerade_as_superadmin' }, 400);

  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);
  if (!target.is_active) return c.json({ error: 'user_deactivated' }, 400);

  await startMasquerade(c, target.id, admin.id);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/reactivate', async (c) => {
  const targetId = Number(c.req.param('id'));
  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  await setUserActive(c.env.DB, targetId, true);
  return c.json({ ok: true });
});
