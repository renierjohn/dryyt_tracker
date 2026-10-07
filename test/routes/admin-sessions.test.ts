import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getAdminRoleId } from '../helpers';

function req(method: string, path: string, cookie: string) {
  return SELF.fetch(`https://example.com${path}`, { method, headers: { Cookie: cookie } });
}

type SessionsBody = {
  active: Array<{ user_email: string; expires_at: string; token?: unknown }>;
  expired: Array<{ user_email: string }>;
  active_total: number;
  expired_total: number;
};

describe('/api/admin/sessions', () => {
  it('lists sessions grouped by active/expired without exposing tokens, and deletes the expired ones', async () => {
    const superadmin = await createUserWithRoleAndLogin('sessions-super@example.com', 1, 'Sessions Super');
    await createUserWithRoleAndLogin('sessions-old@example.com', await getAdminRoleId(), 'Sessions Old');
    await env.DB.prepare(
      `UPDATE sessions SET expires_at = '2020-01-01T00:00:00.000Z'
       WHERE user_id = (SELECT id FROM users WHERE email = 'sessions-old@example.com')`,
    ).run();

    const body = (await (await req('GET', '/api/admin/sessions', superadmin)).json()) as SessionsBody;
    expect(body.active.map((s) => s.user_email)).toContain('sessions-super@example.com');
    expect(body.active.map((s) => s.user_email)).not.toContain('sessions-old@example.com');
    expect(body.expired.map((s) => s.user_email)).toContain('sessions-old@example.com');
    expect(body.active[0].token).toBeUndefined();
    expect(body.active[0].expires_at).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);

    const del = (await (await req('DELETE', '/api/admin/sessions/expired', superadmin)).json()) as { deleted: number };
    expect(del.deleted).toBeGreaterThanOrEqual(1);
    const after = (await (await req('GET', '/api/admin/sessions', superadmin)).json()) as SessionsBody;
    expect(after.expired_total).toBe(0);
    // Active sessions survive — the superadmin is still signed in.
    expect(after.active.map((s) => s.user_email)).toContain('sessions-super@example.com');
  });

  it('is superadmin-only', async () => {
    const admin = await createUserWithRoleAndLogin('sessions-admin@example.com', await getAdminRoleId(), 'Sessions Admin');
    expect((await req('GET', '/api/admin/sessions', admin)).status).toBe(403);
    expect((await req('DELETE', '/api/admin/sessions/expired', admin)).status).toBe(403);
  });
});
