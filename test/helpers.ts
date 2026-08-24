import { SELF, env } from 'cloudflare:test';
import { createUser } from '../worker/db';
import { hashPassword } from '../worker/crypto';

export const TEST_PASSWORD = 'password123';

/**
 * Creates a user with an explicit role (bypassing the public register endpoint,
 * which always assigns role 1/2 via the bootstrap logic) and logs in as them,
 * returning the session cookie.
 */
export async function createUserWithRoleAndLogin(
  email: string,
  roleId: number,
  displayName: string,
): Promise<string> {
  const { hash, salt } = await hashPassword(TEST_PASSWORD);
  await createUser(env.DB, { email, passwordHash: hash, passwordSalt: salt, roleId, displayName });

  const res = await SELF.fetch('https://example.com/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: TEST_PASSWORD }),
  });
  return res.headers.get('set-cookie')!.split(';')[0];
}

export async function getAdminRoleId(): Promise<number> {
  const row = await env.DB.prepare("SELECT id FROM roles WHERE name = 'admin'").first<{ id: number }>();
  return row!.id;
}
