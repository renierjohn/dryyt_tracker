import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getOwnerRoleId } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/users/:id/public', () => {
  it('returns display name, avatar, and only public/both alerts, with no auth required', async () => {
    const cookie = await createUserWithRoleAndLogin('public-page@example.com', 1, 'Public Page');
    const me = (await (await req('GET', '/api/auth/me', undefined, cookie)).json()) as { user: { id: number } };
    const id = me.user.id;

    await req('POST', '/api/alerts', { type: 'info', visibility: 'dashboard', body_html: '<p>private</p>' }, cookie);
    await req('POST', '/api/alerts', { type: 'warning', visibility: 'public', body_html: '<p>public</p>' }, cookie);

    const res = await SELF.fetch(`https://example.com/api/users/${id}/public`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { display_name: string; alerts: Array<{ visibility: string }> };
    expect(body.display_name).toBe('Public Page');
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].visibility).toBe('public');
  });

  it('returns 404 for a nonexistent user', async () => {
    const res = await SELF.fetch('https://example.com/api/users/999999/public');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/owners', () => {
  it('lists active owners with no auth required, excluding non-owner roles', async () => {
    const ownerRoleId = await getOwnerRoleId();
    await createUserWithRoleAndLogin('public-owners-owner@example.com', ownerRoleId, 'Public Owner');
    await createUserWithRoleAndLogin('public-owners-plain@example.com', 2, 'Plain User');

    const res = await SELF.fetch('https://example.com/api/owners');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owners: Array<{ display_name: string; email: string }> };
    const names = body.owners.map((o) => o.display_name);
    expect(names).toContain('Public Owner');
    expect(names).not.toContain('Plain User');
    expect(body.owners.find((o) => o.display_name === 'Public Owner')?.email).toBe('public-owners-owner@example.com');
  });

  it('excludes a deactivated owner', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const cookie = await createUserWithRoleAndLogin('public-owners-inactive@example.com', ownerRoleId, 'Inactive Owner');
    const me = (await (await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } })).json()) as {
      user: { id: number };
    };
    const superadminCookie = await createUserWithRoleAndLogin('public-owners-superadmin@example.com', 1, 'Superadmin');
    await SELF.fetch(`https://example.com/api/admin/users/${me.user.id}/deactivate`, {
      method: 'POST',
      headers: { Cookie: superadminCookie },
    });

    const res = await SELF.fetch('https://example.com/api/owners');
    const body = (await res.json()) as { owners: Array<{ display_name: string }> };
    expect(body.owners.map((o) => o.display_name)).not.toContain('Inactive Owner');
  });
});
