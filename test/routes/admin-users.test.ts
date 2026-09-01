import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getAdminRoleId } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('admin console permission gate', () => {
  it('returns 403 on every /api/admin/* route for a plain-role caller', async () => {
    const plainCookie = await createUserWithRoleAndLogin('admin-gate-plain@example.com', 2, 'Plain');
    expect((await req('GET', '/api/admin/users', undefined, plainCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users', { email: 'x@example.com', password: 'password123', display_name: 'X', role_id: 2 }, plainCookie)).status).toBe(403);
    expect((await req('PUT', '/api/admin/users/2', { display_name: 'Y' }, plainCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users/2/deactivate', undefined, plainCookie)).status).toBe(403);
  });

  it('returns 403 on every /api/admin/* route for the admin role (only superadmin may access the console)', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-gate-admin-role@example.com', adminRoleId, 'AdminRole');
    expect((await req('GET', '/api/admin/users', undefined, adminCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users', { email: 'y@example.com', password: 'password123', display_name: 'Y', role_id: 2 }, adminCookie)).status).toBe(403);
    expect((await req('PUT', '/api/admin/users/2', { display_name: 'Z' }, adminCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users/2/deactivate', undefined, adminCookie)).status).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('lists users with role names and never leaks password fields', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-list@example.com', 1, 'Admin List');
    const res = await req('GET', '/api/admin/users', undefined, superadminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      users: Array<{ email: string; role_name: string; password_hash?: unknown; password_salt?: unknown }>;
    };
    const found = body.users.find((u) => u.email === 'admin-list@example.com')!;
    expect(found.role_name).toBe('superadmin');
    expect(found.password_hash).toBeUndefined();
    expect(found.password_salt).toBeUndefined();
  });
});

describe('POST /api/admin/users', () => {
  it('creates a user with an admin-chosen role and initial password', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-creator@example.com', 1, 'Admin Creator');
    const res = await req('POST', '/api/admin/users', {
      email: 'admin-created@example.com', password: 'initialpass123', display_name: 'Admin Created', role_id: 2,
    }, superadminCookie);
    expect(res.status).toBe(201);

    const loginRes = await req('POST', '/api/auth/login', { email: 'admin-created@example.com', password: 'initialpass123' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects a duplicate email with 409', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-dup@example.com', 1, 'Admin Dup');
    const res = await req('POST', '/api/admin/users', {
      email: 'admin-dup@example.com', password: 'password123', display_name: 'Dup', role_id: 2,
    }, superadminCookie);
    expect(res.status).toBe(409);
  });

  it('rejects creating a user with role_id 1 (superadmin) with 400', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-no-escalate@example.com', 1, 'Admin');
    const res = await req('POST', '/api/admin/users', {
      email: 'admin-escalate-attempt@example.com', password: 'password123', display_name: 'Escalate', role_id: 1,
    }, superadminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cannot_assign_superadmin_role');
  });
});

describe('PUT /api/admin/users/:id', () => {
  it('updates display_name, email, and role_id for a non-superadmin target', async () => {
    const adminRoleId = await getAdminRoleId();
    const superadminCookie = await createUserWithRoleAndLogin('admin-editor@example.com', 1, 'Admin Editor');
    const targetCookie = await createUserWithRoleAndLogin('admin-edit-target@example.com', 2, 'Edit Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('PUT', `/api/admin/users/${targetMe.user.id}`, { display_name: 'Renamed', role_id: adminRoleId }, superadminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { display_name: string; role_name: string } };
    expect(body.user.display_name).toBe('Renamed');
    expect(body.user.role_name).toBe('admin');
  });

  it('rejects changing user id 1\'s role_id with 400', async () => {
    // The very first user ever registered in this test's isolated DB becomes id 1/superadmin.
    const superadminCookie = await createUserWithRoleAndLogin('will-be-id-1@example.com', 1, 'Superadmin');
    const res = await req('PUT', '/api/admin/users/1', { role_id: 2 }, superadminCookie);
    expect(res.status).toBe(400);
  });

  it('rejects promoting any user to role_id 1 (superadmin) with 400', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-no-promote@example.com', 1, 'Admin');
    const targetCookie = await createUserWithRoleAndLogin('target-no-escalate@example.com', 2, 'Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('PUT', `/api/admin/users/${targetMe.user.id}`, { role_id: 1 }, superadminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('cannot_assign_superadmin_role');
  });

  it('rejects an empty display_name with 400 (Finding 5)', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-empty-name@example.com', 1, 'Admin');
    const targetCookie = await createUserWithRoleAndLogin('empty-name-target@example.com', 2, 'Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('PUT', `/api/admin/users/${targetMe.user.id}`, { display_name: '' }, superadminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_display_name');
  });

  it('rejects a whitespace-only display_name with 400 (Finding 5)', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-whitespace-name@example.com', 1, 'Admin');
    const targetCookie = await createUserWithRoleAndLogin('whitespace-name-target@example.com', 2, 'Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('PUT', `/api/admin/users/${targetMe.user.id}`, { display_name: '   ' }, superadminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_display_name');
  });
});

describe('POST /api/admin/users/:id/deactivate and /reactivate', () => {
  it('deactivates a user, killing their sessions, then reactivates them', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-deactivator@example.com', 1, 'Deactivator');
    const targetCookie = await createUserWithRoleAndLogin('deactivate-target@example.com', 2, 'Deactivate Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };
    const targetId = targetMe.user.id;

    const deactivateRes = await req('POST', `/api/admin/users/${targetId}/deactivate`, undefined, superadminCookie);
    expect(deactivateRes.status).toBe(200);

    const meAfterDeactivate = await req('GET', '/api/auth/me', undefined, targetCookie);
    expect(meAfterDeactivate.status).toBe(401);

    const publicPageRes = await SELF.fetch(`https://example.com/api/users/${targetId}/public`);
    expect(publicPageRes.status).toBe(404);

    const reactivateRes = await req('POST', `/api/admin/users/${targetId}/reactivate`, undefined, superadminCookie);
    expect(reactivateRes.status).toBe(200);

    const loginAfterReactivate = await req('POST', '/api/auth/login', { email: 'deactivate-target@example.com', password: 'password123' });
    expect(loginAfterReactivate.status).toBe(200);
  });

  it('rejects deactivating user id 1 with 400', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('will-be-id-1-b@example.com', 1, 'Superadmin B');
    const res = await req('POST', '/api/admin/users/1/deactivate', undefined, superadminCookie);
    expect(res.status).toBe(400);
  });
});
