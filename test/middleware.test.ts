import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, it, expect, beforeEach } from 'vitest';
import { createUser, setUserActive } from '../worker/db';
import { loadSession, requireAuth, requirePermission, createAndSetSession } from '../worker/middleware/auth';
import type { AppBindings } from '../worker/types';

// This file's tests create users directly via createUser() (bypassing /register) and some
// assert on specific ids (e.g. id 1 for the superadmin-bypass check in requirePermission),
// so tests within this file are not independent of each other's leftover rows — unlike the
// route-level tests, which use unique emails per test and never depend on numeric ids.
// Reset users/sessions between tests. Roles are seeded once by migrations and never deleted
// by these tests, so they don't need re-seeding here.
beforeEach(async () => {
  await env.DB.prepare('DELETE FROM sessions').run();
  await env.DB.prepare('DELETE FROM users').run();
});

function buildTestApp() {
  const app = new Hono<AppBindings>();
  app.use('*', loadSession);
  app.post('/login-as/:id', async (c) => {
    await createAndSetSession(c, Number(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/whoami', requireAuth, (c) => c.json({ user: c.get('user') }));
  app.get('/admin-only', requirePermission('manage_users'), (c) => c.json({ ok: true }));
  return app;
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header');
  return setCookie.split(';')[0];
}

describe('loadSession + requireAuth', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const app = buildTestApp();
    const res = await app.request('/whoami', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the user for an authenticated request', async () => {
    const app = buildTestApp();
    const user = await createUser(env.DB, {
      email: 'e@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'E',
    });
    const loginRes = await app.request(`/login-as/${user.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string } };
    expect(body.user.email).toBe('e@example.com');
  });
});

describe('requirePermission', () => {
  it('user id 1 bypasses the check even without the permission', async () => {
    const app = buildTestApp();
    const superadmin = await createUser(env.DB, {
      email: 'super@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Super',
    });
    expect(superadmin.id).toBe(1);
    const loginRes = await app.request(`/login-as/${superadmin.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });

  it('returns 403 for a role without the permission', async () => {
    const app = buildTestApp();
    await createUser(env.DB, { email: 'first@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'First' });
    const plain = await createUser(env.DB, { email: 'plain@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Plain' });
    const loginRes = await app.request(`/login-as/${plain.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
  });

  it('returns 200 for a role granted the permission', async () => {
    const app = buildTestApp();
    await createUser(env.DB, { email: 'first2@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'First2' });
    const grantedRole = await env.DB
      .prepare("INSERT INTO roles (name, permissions) VALUES (?, ?) RETURNING id")
      .bind('tester_admin', '["manage_users"]')
      .first<{ id: number }>();
    const adminish = await createUser(env.DB, {
      email: 'adminish@example.com', passwordHash: 'h', passwordSalt: 's', roleId: grantedRole!.id, displayName: 'Adminish',
    });
    const loginRes = await app.request(`/login-as/${adminish.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });
});

describe('loadSession + deactivated users', () => {
  it('treats a deactivated user as unauthenticated, even with a valid session cookie', async () => {
    const app = buildTestApp();
    const user = await createUser(env.DB, {
      email: 'deactivated-mw@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Deactivated',
    });
    const loginRes = await app.request(`/login-as/${user.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    // Confirm the session works before deactivation
    const beforeRes = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(beforeRes.status).toBe(200);

    await setUserActive(env.DB, user.id, false);

    const afterRes = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(afterRes.status).toBe(401);
  });
});
