import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function post(path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(res: Response): string {
  return res.headers.get('set-cookie')!.split(';')[0];
}

describe('full auth lifecycle', () => {
  it('register -> me -> logout -> login -> forgot -> reset -> login with new password', async () => {
    const registerRes = await post('/api/auth/register', {
      email: 'lifecycle@example.com', password: 'password123', display_name: 'Lifecycle',
    });
    expect(registerRes.status).toBe(201);
    let cookie = extractCookie(registerRes);

    const meRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect((await meRes.json()).user.email).toBe('lifecycle@example.com');

    const logoutRes = await post('/api/auth/logout', undefined, cookie);
    expect(logoutRes.status).toBe(204);

    const loginRes = await post('/api/auth/login', { email: 'lifecycle@example.com', password: 'password123' });
    expect(loginRes.status).toBe(200);
    cookie = extractCookie(loginRes);

    const forgotRes = await post('/api/auth/forgot-password', { email: 'lifecycle@example.com' });
    const { resetLink } = await forgotRes.json();
    const token = new URL(resetLink).searchParams.get('token');

    const resetRes = await post('/api/auth/reset-password', { token, password: 'brand-new-password' });
    expect(resetRes.status).toBe(200);

    const staleMeRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(staleMeRes.status).toBe(401);

    const finalLoginRes = await post('/api/auth/login', { email: 'lifecycle@example.com', password: 'brand-new-password' });
    expect(finalLoginRes.status).toBe(200);
  });
});
