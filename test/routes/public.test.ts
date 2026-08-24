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

describe('GET /api/users/:id/public', () => {
  it('returns display name, avatar, and only public/both alerts, with no auth required', async () => {
    const cookie = await createUserWithRoleAndLogin('public-page@example.com', 2, 'Public Page');
    const me = (await (await req('GET', '/api/auth/me', undefined, cookie)).json()) as any;
    const id = me.user.id;

    await req('POST', '/api/alerts', { type: 'info', visibility: 'dashboard', body_html: '<p>private</p>' }, cookie);
    await req('POST', '/api/alerts', { type: 'warning', visibility: 'public', body_html: '<p>public</p>' }, cookie);

    const res = await SELF.fetch(`https://example.com/api/users/${id}/public`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.display_name).toBe('Public Page');
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].visibility).toBe('public');
  });

  it('returns 404 for a nonexistent user', async () => {
    const res = await SELF.fetch('https://example.com/api/users/999999/public');
    expect(res.status).toBe(404);
  });
});
