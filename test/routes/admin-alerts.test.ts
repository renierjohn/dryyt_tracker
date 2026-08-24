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
  it('lets a manage_users-permission caller inject an alert onto another user\'s page', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-inject@example.com', adminRoleId, 'Admin Inject');
    const targetCookie = await createUserWithRoleAndLogin('inject-target@example.com', 2, 'Inject Target');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as any;
    const targetId = targetMe.user.id;

    const res = await req('POST', `/api/admin/users/${targetId}/alerts`, {
      type: 'warning', visibility: 'both', body_html: '<p>heads up</p>',
    }, adminCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as any;
    expect(body.alert.user_id).toBe(targetId);
    expect(body.alert.created_by).not.toBe(targetId);

    const targetAlerts = (await (await req('GET', '/api/alerts', undefined, targetCookie)).json()) as any;
    expect(targetAlerts.alerts.some((a: { id: number }) => a.id === body.alert.id)).toBe(true);
  });

  it('returns 403 for a caller without manage_users', async () => {
    const plainCookie = await createUserWithRoleAndLogin('plain-inject@example.com', 2, 'Plain');
    const targetCookie = await createUserWithRoleAndLogin('inject-target2@example.com', 2, 'Target 2');
    const targetMe = (await (await req('GET', '/api/auth/me', undefined, targetCookie)).json()) as any;

    const res = await req('POST', `/api/admin/users/${targetMe.user.id}/alerts`, {
      type: 'info', visibility: 'public', body_html: '<p>x</p>',
    }, plainCookie);
    expect(res.status).toBe(403);
  });
});
