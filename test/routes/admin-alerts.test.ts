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

describe('POST /api/admin/users/:id/alerts', () => {
  it('lets a superadmin inject an alert onto another user\'s page', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-inject@example.com', 1, 'Admin Inject');
    const targetCookie = await createUserWithRoleAndLogin('inject-target@example.com', 2, 'Inject Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };
    const targetId = targetMe.user.id;

    const res = await req('POST', `/api/admin/users/${targetId}/alerts`, {
      type: 'warning', visibility: 'both', body_html: '<p>heads up</p>',
    }, superadminCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { alert: { id: number; user_id: number; created_by: number } };
    expect(body.alert.user_id).toBe(targetId);
    expect(body.alert.created_by).not.toBe(targetId);

    const targetAlerts = (await (await req('GET', '/api/alerts', undefined, targetCookie)).json()) as { alerts: Array<{ id: number }> };
    expect(targetAlerts.alerts.some((a) => a.id === body.alert.id)).toBe(true);
  });

  it('returns 403 for a caller without the superadmin role', async () => {
    const plainCookie = await createUserWithRoleAndLogin('plain-inject@example.com', 2, 'Plain');
    const targetCookie = await createUserWithRoleAndLogin('inject-target2@example.com', 2, 'Target 2');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('POST', `/api/admin/users/${targetMe.user.id}/alerts`, {
      type: 'info', visibility: 'public', body_html: '<p>x</p>',
    }, plainCookie);
    expect(res.status).toBe(403);
  });

  it('returns 403 for the admin role (only superadmin may access the console)', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-role-inject@example.com', adminRoleId, 'Admin Role Inject');
    const targetCookie = await createUserWithRoleAndLogin('inject-target3@example.com', 2, 'Target 3');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as { user: { id: number } };

    const res = await req('POST', `/api/admin/users/${targetMe.user.id}/alerts`, {
      type: 'info', visibility: 'public', body_html: '<p>x</p>',
    }, adminCookie);
    expect(res.status).toBe(403);
  });

  it('returns 404 when trying to inject to a nonexistent user', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('admin-nonexistent@example.com', 1, 'Admin Nonexistent');

    const res = await req('POST', '/api/admin/users/999999/alerts', {
      type: 'warning', visibility: 'public', body_html: '<p>target gone</p>',
    }, superadminCookie);
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('not_found');
  });
});
