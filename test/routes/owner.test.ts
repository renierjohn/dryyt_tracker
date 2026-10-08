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

describe('owner self-service gate', () => {
  it('returns 403 on /api/owner/* for a plain-role caller', async () => {
    const plainCookie = await createUserWithRoleAndLogin('owner-gate-plain@example.com', 2, 'Plain');
    expect((await req('GET', '/api/owner/users', undefined, plainCookie)).status).toBe(403);
    expect(
      (await req('POST', '/api/owner/users', { email: 'x@example.com', password: 'password123', display_name: 'X' }, plainCookie)).status,
    ).toBe(403);
  });

  it('returns 401 with no session at all', async () => {
    expect((await req('GET', '/api/owner/users')).status).toBe(401);
    expect((await req('POST', '/api/owner/users', { email: 'x@example.com', password: 'password123', display_name: 'X' })).status).toBe(401);
  });
});

describe('POST /api/owner/users', () => {
  it('creates a child user with role user and parent_id set to the owner', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('owner-create@example.com', ownerRoleId, 'Owner');
    const res = await req(
      'POST',
      '/api/owner/users',
      { email: 'child@example.com', password: 'password123', display_name: 'Child', contact_number: '09123456789' },
      ownerCookie,
    );
    expect(res.status).toBe(201);
    const body = (await res.json()) as { user: { email: string; display_name: string; contact_number: string } };
    expect(body.user.contact_number).toBe('09123456789');
    expect(body.user.email).toBe('child@example.com');
    expect(body.user.display_name).toBe('Child');
  });

  it('rejects a duplicate email with 409', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('owner-dup@example.com', ownerRoleId, 'Owner');
    await req('POST', '/api/owner/users', { email: 'dup-child@example.com', password: 'password123', display_name: 'Child' }, ownerCookie);
    const res = await req('POST', '/api/owner/users', { email: 'dup-child@example.com', password: 'password123', display_name: 'Child2' }, ownerCookie);
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('email_taken');
  });

  it('rejects a weak password with 400', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('owner-weak-pw@example.com', ownerRoleId, 'Owner');
    const res = await req('POST', '/api/owner/users', { email: 'weak@example.com', password: 'short', display_name: 'Child' }, ownerCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('weak_password');
  });
});

describe('GET /api/owner/users', () => {
  it('only lists the calling owner\'s own child users', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerACookie = await createUserWithRoleAndLogin('owner-a@example.com', ownerRoleId, 'OwnerA');
    const ownerBCookie = await createUserWithRoleAndLogin('owner-b@example.com', ownerRoleId, 'OwnerB');

    await req('POST', '/api/owner/users', { email: 'a-child@example.com', password: 'password123', display_name: 'AChild' }, ownerACookie);
    await req('POST', '/api/owner/users', { email: 'b-child@example.com', password: 'password123', display_name: 'BChild' }, ownerBCookie);

    const res = await req('GET', '/api/owner/users', undefined, ownerACookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { users: Array<{ email: string }> };
    const emails = body.users.map((u) => u.email);
    expect(emails).toContain('a-child@example.com');
    expect(emails).not.toContain('b-child@example.com');
  });

  it('paginates 10 per page with total', async () => {
    const ownerCookie = await createUserWithRoleAndLogin('owner-paged@example.com', await getOwnerRoleId(), 'Paged');
    for (let i = 0; i < 12; i++) {
      await req('POST', '/api/owner/users', { email: `paged-${i}@example.com`, password: 'password123', display_name: `P${i}` }, ownerCookie);
    }
    type Page = { page: number; page_size: number; total: number; users: Array<{ email: string }> };
    const first = (await (await req('GET', '/api/owner/users', undefined, ownerCookie)).json()) as Page;
    expect(first).toMatchObject({ page: 1, page_size: 10, total: 12 });
    expect(first.users).toHaveLength(10);
    const second = (await (await req('GET', '/api/owner/users?page=2', undefined, ownerCookie)).json()) as Page;
    expect(second).toMatchObject({ page: 2, total: 12 });
    expect(second.users).toHaveLength(2);
    expect(second.users.map((u) => u.email)).not.toContain(first.users[0].email);
  });
});

describe('PUT/DELETE /api/owner/users/:id', () => {
  async function setup(prefix: string) {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin(`${prefix}-owner@example.com`, ownerRoleId, 'Owner');
    const res = await req('POST', '/api/owner/users', { email: `${prefix}-child@example.com`, password: 'password123', display_name: 'Child' }, ownerCookie);
    const { user } = (await res.json()) as { user: { id: number } };
    return { ownerCookie, childId: user.id };
  }

  it('edits a child user', async () => {
    const { ownerCookie, childId } = await setup('owner-edit');
    const res = await req('PUT', `/api/owner/users/${childId}`, {
      email: 'owner-edit-new@example.com', display_name: 'Renamed', contact_number: '+63 912 345 6789',
    }, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { user: { email: string; display_name: string; contact_number: string } };
    expect(body.user).toMatchObject({ email: 'owner-edit-new@example.com', display_name: 'Renamed', contact_number: '+63 912 345 6789' });
  });

  it('delete deactivates the child user', async () => {
    const { ownerCookie, childId } = await setup('owner-del');
    expect((await req('DELETE', `/api/owner/users/${childId}`, undefined, ownerCookie)).status).toBe(200);
    const list = (await (await req('GET', '/api/owner/users', undefined, ownerCookie)).json()) as {
      users: Array<{ id: number; is_active: number }>;
    };
    expect(list.users.find((u) => u.id === childId)?.is_active).toBe(0);
  });

  it("returns 404 for another owner's user", async () => {
    const { childId } = await setup('owner-other-a');
    const otherCookie = await createUserWithRoleAndLogin('owner-other-b@example.com', await getOwnerRoleId(), 'OwnerB');
    expect((await req('PUT', `/api/owner/users/${childId}`, { display_name: 'X' }, otherCookie)).status).toBe(404);
    expect((await req('DELETE', `/api/owner/users/${childId}`, undefined, otherCookie)).status).toBe(404);
  });
});
