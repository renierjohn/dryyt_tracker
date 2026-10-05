import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getOwnerRoleId } from './helpers';

describe('Cache-Control middleware', () => {
  it('marks successful GETs public for 60s', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.headers.get('cache-control')).toBe('public, max-age=60');
  });

  it('marks the workflow transactions list no-store', async () => {
    const cookie = await createUserWithRoleAndLogin('cache-owner@example.com', await getOwnerRoleId(), 'CacheOwner');
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/transactions', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
  });

  it('does not cache non-200 or non-GET responses', async () => {
    const unauth = await SELF.fetch('https://example.com/api/auth/me');
    expect(unauth.status).toBe(401);
    expect(unauth.headers.get('cache-control')).toBeNull();

    const post = await SELF.fetch('https://example.com/api/auth/logout', { method: 'POST' });
    expect(post.headers.get('cache-control')).toBeNull();
  });
});
