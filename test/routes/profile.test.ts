import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function post(path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function put(path: string, body: unknown, cookie: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify(body),
  });
}

function extractCookie(res: Response): string {
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function registerAndLogin(email: string, displayName: string): Promise<string> {
  const res = await post('/api/auth/register', { email, password: 'password123', display_name: displayName });
  return extractCookie(res);
}

describe('GET /api/profile', () => {
  it('returns 401 when unauthenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/profile');
    expect(res.status).toBe(401);
  });

  it('returns the caller\'s own profile', async () => {
    const cookie = await registerAndLogin('profile-get@example.com', 'Profile Get');
    const res = await SELF.fetch('https://example.com/api/profile', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { email: string } };
    expect(body.user.email).toBe('profile-get@example.com');
  });
});

describe('PUT /api/profile', () => {
  it('updates display_name and email', async () => {
    const cookie = await registerAndLogin('profile-put@example.com', 'Profile Put');
    const res = await put('/api/profile', { display_name: 'New Name', email: 'profile-put-new@example.com' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json() as { user: { display_name: string; email: string } };
    expect(body.user.display_name).toBe('New Name');
    expect(body.user.email).toBe('profile-put-new@example.com');
  });

  it('rejects an email already taken by someone else with 409', async () => {
    await registerAndLogin('profile-taken@example.com', 'Taken');
    const cookie = await registerAndLogin('profile-wants-taken@example.com', 'Wants Taken');
    const res = await put('/api/profile', { email: 'profile-taken@example.com' }, cookie);
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/profile/password', () => {
  it('changes the password with the correct current password', async () => {
    const cookie = await registerAndLogin('pw-change@example.com', 'PW Change');
    const res = await put('/api/profile/password', { current_password: 'password123', new_password: 'newpassword456' }, cookie);
    expect(res.status).toBe(200);

    const loginRes = await post('/api/auth/login', { email: 'pw-change@example.com', password: 'newpassword456' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects the wrong current password with 401', async () => {
    const cookie = await registerAndLogin('pw-wrong@example.com', 'PW Wrong');
    const res = await put('/api/profile/password', { current_password: 'wrong-password', new_password: 'newpassword456' }, cookie);
    expect(res.status).toBe(401);
  });

  it('invalidates other sessions but keeps the current one', async () => {
    const cookie = await registerAndLogin('pw-sessions@example.com', 'PW Sessions');
    const otherLoginRes = await post('/api/auth/login', { email: 'pw-sessions@example.com', password: 'password123' });
    const otherCookie = extractCookie(otherLoginRes);

    const pwChangeRes = await put('/api/profile/password', { current_password: 'password123', new_password: 'newpassword456' }, cookie);
    const newCookie = extractCookie(pwChangeRes);

    const currentStillWorks = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: newCookie } });
    expect(currentStillWorks.status).toBe(200);

    const otherNowRejected = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: otherCookie } });
    expect(otherNowRejected.status).toBe(401);
  });
});
