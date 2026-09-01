import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/alerts', () => {
  it('creates an alert for the caller and sanitizes the body', async () => {
    const cookie = await createUserWithRoleAndLogin('alert-create@example.com', 1, 'Alert Tester');
    const res = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>hi</p><script>alert(1)</script>' }, cookie);
    expect(res.status).toBe(201);
    const body = await res.json() as { alert: { body_html: string } };
    expect(body.alert.body_html).toContain('<p>hi</p>');
    expect(body.alert.body_html).not.toContain('script');
  });

  it('rejects an invalid type with 400', async () => {
    const cookie = await createUserWithRoleAndLogin('alert-badtype@example.com', 1, 'Alert Tester');
    const res = await req('POST', '/api/alerts', { type: 'not-a-type', visibility: 'public', body_html: '<p>x</p>' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>x</p>' });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a plain user (only admin/superadmin may create alerts)', async () => {
    const cookie = await createUserWithRoleAndLogin('alert-plain-create@example.com', 2, 'Plain');
    const res = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>x</p>' }, cookie);
    expect(res.status).toBe(403);
  });
});

describe('GET /api/alerts', () => {
  it('lists only the caller\'s own alerts', async () => {
    const cookieA = await createUserWithRoleAndLogin('alert-list-a@example.com', 1, 'Alert Tester A');
    const cookieB = await createUserWithRoleAndLogin('alert-list-b@example.com', 1, 'Alert Tester B');
    await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>a</p>' }, cookieA);
    await req('POST', '/api/alerts', { type: 'warning', visibility: 'public', body_html: '<p>b</p>' }, cookieB);

    const res = await SELF.fetch('https://example.com/api/alerts', { headers: { Cookie: cookieA } });
    const body = await res.json() as { alerts: Array<{ type: string }> };
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe('info');
  });
});

describe('PUT/DELETE /api/alerts/:id ownership', () => {
  it('lets the owner edit and delete their own alert', async () => {
    const cookie = await createUserWithRoleAndLogin('alert-owner@example.com', 1, 'Alert Owner');
    const createRes = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>old</p>' }, cookie);
    const id = (await createRes.json() as { alert: { id: number } }).alert.id;

    const putRes = await req('PUT', `/api/alerts/${id}`, { type: 'danger', visibility: 'dashboard', body_html: '<p>new</p>' }, cookie);
    expect(putRes.status).toBe(200);

    const deleteRes = await req('DELETE', `/api/alerts/${id}`, undefined, cookie);
    expect(deleteRes.status).toBe(204);
  });

  it('forbids a different plain user from editing or deleting someone else\'s alert', async () => {
    const ownerCookie = await createUserWithRoleAndLogin('alert-victim@example.com', 1, 'Alert Victim');
    const attackerCookie = await createUserWithRoleAndLogin('alert-attacker@example.com', 2, 'Alert Attacker');
    const createRes = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>mine</p>' }, ownerCookie);
    const id = (await createRes.json() as { alert: { id: number } }).alert.id;

    const putRes = await req('PUT', `/api/alerts/${id}`, { type: 'danger', visibility: 'public', body_html: '<p>hacked</p>' }, attackerCookie);
    expect(putRes.status).toBe(403);

    const deleteRes = await req('DELETE', `/api/alerts/${id}`, undefined, attackerCookie);
    expect(deleteRes.status).toBe(403);
  });

  it('returns 404 for a nonexistent alert', async () => {
    const cookie = await createUserWithRoleAndLogin('alert-404@example.com', 2, 'Plain');
    const res = await req('DELETE', '/api/alerts/999999', undefined, cookie);
    expect(res.status).toBe(404);
  });
});
