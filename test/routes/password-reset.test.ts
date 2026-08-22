import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function post(path: string, body?: unknown) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/auth/forgot-password', () => {
  it('returns a reset link for a known email', async () => {
    await post('/api/auth/register', { email: 'forgot@example.com', password: 'password123', display_name: 'F' });
    const res = await post('/api/auth/forgot-password', { email: 'forgot@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resetLink).toMatch(/reset-password\?token=/);
  });

  it('returns 200 without a resetLink for an unknown email (no enumeration)', async () => {
    const res = await post('/api/auth/forgot-password', { email: 'unknown@example.com' });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.resetLink).toBeUndefined();
  });
});

describe('POST /api/auth/reset-password', () => {
  it('resets the password with a valid token and invalidates existing sessions', async () => {
    const registerRes = await post('/api/auth/register', { email: 'reset@example.com', password: 'password123', display_name: 'R' });
    const oldCookie = registerRes.headers.get('set-cookie')!.split(';')[0];

    const forgotRes = await post('/api/auth/forgot-password', { email: 'reset@example.com' });
    const { resetLink } = await forgotRes.json();
    const token = new URL(resetLink).searchParams.get('token');

    const resetRes = await post('/api/auth/reset-password', { token, password: 'new-password123' });
    expect(resetRes.status).toBe(200);

    const meWithOldCookie = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: oldCookie } });
    expect(meWithOldCookie.status).toBe(401);

    const loginRes = await post('/api/auth/login', { email: 'reset@example.com', password: 'new-password123' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects an unknown token with 400', async () => {
    const res = await post('/api/auth/reset-password', { token: 'not-a-real-token', password: 'new-password123' });
    expect(res.status).toBe(400);
  });

  it('rejects an expired token with 400', async () => {
    await post('/api/auth/register', { email: 'expired@example.com', password: 'password123', display_name: 'Exp' });
    const user = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('expired@example.com').first<{ id: number }>();
    const expiredAt = new Date(Date.now() - 60_000).toISOString();
    await env.DB.prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)')
      .bind('expired-token', user!.id, expiredAt).run();

    const res = await post('/api/auth/reset-password', { token: 'expired-token', password: 'new-password123' });
    expect(res.status).toBe(400);
  });

  it('rejects reusing a token a second time with 400', async () => {
    const registerRes = await post('/api/auth/register', { email: 'reuse@example.com', password: 'password123', display_name: 'Reuse' });
    void registerRes;
    const forgotRes = await post('/api/auth/forgot-password', { email: 'reuse@example.com' });
    const { resetLink } = await forgotRes.json();
    const token = new URL(resetLink).searchParams.get('token');

    const first = await post('/api/auth/reset-password', { token, password: 'first-new-password' });
    expect(first.status).toBe(200);

    const second = await post('/api/auth/reset-password', { token, password: 'second-new-password' });
    expect(second.status).toBe(400);
  });
});
