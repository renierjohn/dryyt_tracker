import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getOwnerRoleId } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

const DAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'];
function hours(overrides: Record<string, unknown> = {}) {
  return Object.fromEntries(DAYS.map((d) => [d, { open: d !== 'sun', from: '09:00', to: '17:00', ...overrides }]));
}

const STORE = { address: '1 Main St, Springfield', lat: 14.5995, lng: 120.9842, opening_hours: hours() };

describe('/api/owner/store', () => {
  it('returns 403 for a plain-role caller', async () => {
    const cookie = await createUserWithRoleAndLogin('store-plain@example.com', 2, 'Plain');
    expect((await req('GET', '/api/owner/store', undefined, cookie)).status).toBe(403);
    expect((await req('PUT', '/api/owner/store', STORE, cookie)).status).toBe(403);
  });

  it('starts empty, then saves and returns address, pin and hours', async () => {
    const cookie = await createUserWithRoleAndLogin('store-owner@example.com', await getOwnerRoleId(), 'Store A');
    const empty = (await (await req('GET', '/api/owner/store', undefined, cookie)).json()) as { store: unknown };
    expect(empty.store).toEqual({ address: null, lat: null, lng: null, opening_hours: null });

    expect((await req('PUT', '/api/owner/store', STORE, cookie)).status).toBe(200);
    const saved = (await (await req('GET', '/api/owner/store', undefined, cookie)).json()) as { store: unknown };
    expect(saved.store).toEqual(STORE);
  });

  it('rejects malformed hours and out-of-range coordinates', async () => {
    const cookie = await createUserWithRoleAndLogin('store-bad@example.com', await getOwnerRoleId(), 'Store B');
    const badTime = await req('PUT', '/api/owner/store', { ...STORE, opening_hours: hours({ from: '25:00' }) }, cookie);
    expect(badTime.status).toBe(400);
    expect(((await badTime.json()) as { error: string }).error).toBe('invalid_opening_hours');

    const backwards = await req('PUT', '/api/owner/store', { ...STORE, opening_hours: hours({ from: '18:00' }) }, cookie);
    expect(backwards.status).toBe(400);

    const badLat = await req('PUT', '/api/owner/store', { ...STORE, lat: 120 }, cookie);
    expect(((await badLat.json()) as { error: string }).error).toBe('invalid_location');
  });
});

describe('public store details', () => {
  it('exposes the address on /api/owners and full details on /api/owners/:identifier/store', async () => {
    const cookie = await createUserWithRoleAndLogin('store-public@example.com', await getOwnerRoleId(), 'Store Public');
    await req('PUT', '/api/owner/store', STORE, cookie);

    const list = (await (await req('GET', '/api/owners')).json()) as { owners: { display_name: string; address: string | null }[] };
    const listed = list.owners.find((o) => o.display_name === 'Store Public');
    expect(listed?.address).toBe(STORE.address);
    expect(listed).toHaveProperty('avatar_key', null);
    expect(listed).toHaveProperty('contact_number', null);

    const res = await req('GET', '/api/owners/Store%20Public/store');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { store: unknown; contact: unknown };
    expect(body.store).toEqual(STORE);
    expect(body.contact).toEqual({ email: 'store-public@example.com', contact_number: null });
    expect((body as unknown as { alerts: unknown[] }).alerts).toEqual([]);
    expect((body as unknown as { social_links: unknown[] }).social_links).toEqual([]);
  });

  it("includes the owner's social media links", async () => {
    const cookie = await createUserWithRoleAndLogin('store-social@example.com', await getOwnerRoleId(), 'Store Social');
    const links = [{ platform: 'facebook', url: 'https://facebook.com/storesocial' }];
    await req('PUT', '/api/profile', { social_links: links }, cookie);
    const body = (await (await req('GET', '/api/owners/Store%20Social/store')).json()) as { social_links: unknown };
    expect(body.social_links).toEqual(links);
  });

  it("includes the owner's public alerts but not dashboard-only ones", async () => {
    await createUserWithRoleAndLogin('store-alerts@example.com', await getOwnerRoleId(), 'Store Alerts');
    const owner = await env.DB.prepare("SELECT id FROM users WHERE email = 'store-alerts@example.com'").first<{ id: number }>();
    for (const [visibility, html] of [['public', '<p>Public</p>'], ['dashboard', '<p>Private</p>']]) {
      await env.DB.prepare('INSERT INTO alerts (user_id, created_by, type, visibility, body_html) VALUES (?, ?, ?, ?, ?)')
        .bind(owner!.id, owner!.id, 'info', visibility, html)
        .run();
    }
    const body = (await (await req('GET', '/api/owners/Store%20Alerts/store')).json()) as { alerts: { body_html: string }[] };
    expect(body.alerts.map((a) => a.body_html).sort()).toEqual(['<p>Public</p>']);
  });

  it('404s for an unknown owner', async () => {
    expect((await req('GET', '/api/owners/nobody-here/store')).status).toBe(404);
  });

  it('PUT /coordinates saves or clears just lat/lng, leaving the rest alone', async () => {
    const cookie = await createUserWithRoleAndLogin('coords-owner@example.com', await getOwnerRoleId(), 'CoordsOwner');
    const put = (path: string, body: unknown) =>
      SELF.fetch(`https://example.com/api/owner${path}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });
    const get = async () =>
      ((await (await SELF.fetch('https://example.com/api/owner/store', { headers: { Cookie: cookie } })).json()) as {
        store: { address: string | null; lat: number | null; lng: number | null };
      }).store;

    await put('/store', { address: '1 Main St', lat: null, lng: null, opening_hours: null });
    expect((await put('/coordinates', { lat: 14.5995, lng: 120.9842 })).status).toBe(200);
    expect(await get()).toMatchObject({ address: '1 Main St', lat: 14.5995, lng: 120.9842 });

    expect((await put('/coordinates', { lat: 91, lng: 0 })).status).toBe(400);
    expect((await put('/coordinates', { lat: 14 })).status).toBe(400);

    expect((await put('/coordinates', { lat: null, lng: null })).status).toBe(200);
    expect(await get()).toMatchObject({ address: '1 Main St', lat: null, lng: null });
  });
});
