import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function registerRequest(body: unknown) {
  return SELF.fetch('https://example.com/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

describe('POST /api/auth/register', () => {
  it('creates the first user as superadmin and sets a session cookie', async () => {
    const res = await registerRequest({ email: 'admin@example.com', password: 'password123', display_name: 'Admin' });
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.user.email).toBe('admin@example.com');
    expect(body.user.role_name).toBe('superadmin');
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
  });

  it('creates a second user with the default user role', async () => {
    await registerRequest({ email: 'first@example.com', password: 'password123', display_name: 'First' });
    const res = await registerRequest({ email: 'second@example.com', password: 'password123', display_name: 'Second' });
    const body = await res.json();
    expect(body.user.role_name).toBe('user');
  });

  it('rejects a duplicate email with 409', async () => {
    const payload = { email: 'dup@example.com', password: 'password123', display_name: 'Dup' };
    await registerRequest(payload);
    const res = await registerRequest(payload);
    expect(res.status).toBe(409);
  });

  it('rejects a password shorter than 8 characters with 400', async () => {
    const res = await registerRequest({ email: 'short@example.com', password: 'short', display_name: 'Short' });
    expect(res.status).toBe(400);
  });

  it('rejects a malformed email with 400', async () => {
    const res = await registerRequest({ email: 'not-an-email', password: 'password123', display_name: 'Bad' });
    expect(res.status).toBe(400);
  });
});
