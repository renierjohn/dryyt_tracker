import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, TEST_PASSWORD } from '../helpers';

function post(path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header');
  return setCookie.split(';')[0];
}

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    await post('/api/auth/register', { email: 'login1@example.com', password: 'password123', display_name: 'L1' });
    const res = await post('/api/auth/login', { email: 'login1@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
  });

  it('sets a session cookie with HttpOnly and SameSite=Lax', async () => {
    await post('/api/auth/register', { email: 'cookieflags@example.com', password: 'password123', display_name: 'CF' });
    const res = await post('/api/auth/login', { email: 'cookieflags@example.com', password: 'password123' });
    const setCookie = res.headers.get('set-cookie');
    // Secure is intentionally not asserted here: this test runs against https://example.com
    // (SELF.fetch's default host), and the Secure flag is protocol/hostname-derived, not
    // deterministic in this harness the way HttpOnly/SameSite are. See middleware/auth.ts.
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/i);
  });

  it('rejects a wrong password with 401', async () => {
    await post('/api/auth/register', { email: 'login2@example.com', password: 'password123', display_name: 'L2' });
    const res = await post('/api/auth/login', { email: 'login2@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await post('/api/auth/login', { email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });

  it('rejects a deactivated user with 401 instead of logging them in (Finding 3)', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('login-deactivate-admin@example.com', 1, 'Admin');
    const targetCookie = await createUserWithRoleAndLogin('login-deactivate-target@example.com', 2, 'Target');

    const targetMeRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: targetCookie } });
    const targetMe = (await targetMeRes.json()) as { user: { id: number } };

    const deactivateRes = await post(`/api/admin/users/${targetMe.user.id}/deactivate`, undefined, superadminCookie);
    expect(deactivateRes.status).toBe(200);

    const loginRes = await post('/api/auth/login', { email: 'login-deactivate-target@example.com', password: TEST_PASSWORD });
    expect(loginRes.status).toBe(401);
    const body = (await loginRes.json()) as { error: string };
    expect(body.error).toBe('invalid_credentials');
    expect(loginRes.headers.get('set-cookie')).toBeNull();
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user when authenticated', async () => {
    const registerRes = await post('/api/auth/register', { email: 'me@example.com', password: 'password123', display_name: 'Me' });
    const cookie = extractCookie(registerRes);
    const res = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string } };
    expect(body.user.email).toBe('me@example.com');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session so /me becomes unauthenticated', async () => {
    const registerRes = await post('/api/auth/register', { email: 'logout@example.com', password: 'password123', display_name: 'Logout' });
    const cookie = extractCookie(registerRes);

    const logoutRes = await post('/api/auth/logout', undefined, cookie);
    expect(logoutRes.status).toBe(204);

    const meRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(401);
  });
});
