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

describe('theme plugin auth gate', () => {
  it('returns 401 on /api/plugins/theme/me with no session', async () => {
    expect((await req('GET', '/api/plugins/theme/me')).status).toBe(401);
    expect((await req('PUT', '/api/plugins/theme/me', { flavor: 'ocean' })).status).toBe(401);
  });

  it('returns 403 on PUT for a non-owner caller', async () => {
    const plainCookie = await createUserWithRoleAndLogin('theme-gate-plain@example.com', 2, 'Plain');
    expect((await req('PUT', '/api/plugins/theme/me', { flavor: 'ocean' }, plainCookie)).status).toBe(403);
  });
});

describe('GET/PUT /api/plugins/theme/me', () => {
  it('defaults to the "default" flavor and is editable for an owner', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-owner-default@example.com', ownerRoleId, 'Owner');
    const res = await req('GET', '/api/plugins/theme/me', undefined, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flavor: string; editable: boolean };
    expect(body.flavor).toBe('default');
    expect(body.editable).toBe(true);
  });

  it('lets an owner set a flavor and read it back', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-owner-set@example.com', ownerRoleId, 'Owner');

    const putRes = await req('PUT', '/api/plugins/theme/me', { flavor: 'ocean' }, ownerCookie);
    expect(putRes.status).toBe(200);

    const getRes = await req('GET', '/api/plugins/theme/me', undefined, ownerCookie);
    const body = (await getRes.json()) as { flavor: string };
    expect(body.flavor).toBe('ocean');
  });

  it('rejects an unknown flavor with 400', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-owner-invalid@example.com', ownerRoleId, 'Owner');
    const res = await req('PUT', '/api/plugins/theme/me', { flavor: 'not-a-flavor' }, ownerCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_flavor');
  });

  it("cascades an owner's flavor to their child user, read-only for that child", async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-owner-cascade@example.com', ownerRoleId, 'Owner');
    await req('PUT', '/api/plugins/theme/me', { flavor: 'forest' }, ownerCookie);

    const childRes = await req(
      'POST',
      '/api/owner/users',
      { email: 'theme-child@example.com', password: 'password123', display_name: 'Child' },
      ownerCookie,
    );
    expect(childRes.status).toBe(201);

    const childCookie = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'theme-child@example.com', password: 'password123' }),
    }).then((res) => res.headers.get('set-cookie')!.split(';')[0]);

    const res = await req('GET', '/api/plugins/theme/me', undefined, childCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flavor: string; editable: boolean };
    expect(body.flavor).toBe('forest');
    expect(body.editable).toBe(false);

    expect((await req('PUT', '/api/plugins/theme/me', { flavor: 'ocean' }, childCookie)).status).toBe(403);
  });
});

describe('GET /api/plugins/theme/owners/:ownerId', () => {
  it("returns an owner's flavor with no auth required", async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-public-owner@example.com', ownerRoleId, 'Owner');
    await req('PUT', '/api/plugins/theme/me', { flavor: 'midnight' }, ownerCookie);
    const me = (await (await req('GET', '/api/auth/me', undefined, ownerCookie)).json()) as { user: { id: number } };

    const res = await req('GET', `/api/plugins/theme/owners/${me.user.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flavor: string };
    expect(body.flavor).toBe('midnight');
  });

  it('falls back to "default" for an unknown owner id', async () => {
    const res = await req('GET', '/api/plugins/theme/owners/999999');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flavor: string };
    expect(body.flavor).toBe('default');
  });

  it("also resolves by the owner's display_name", async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('theme-public-byname@example.com', ownerRoleId, 'NameLookupThemeOwner');
    await req('PUT', '/api/plugins/theme/me', { flavor: 'forest' }, ownerCookie);

    const res = await req('GET', '/api/plugins/theme/owners/NameLookupThemeOwner');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { flavor: string };
    expect(body.flavor).toBe('forest');
  });
});
