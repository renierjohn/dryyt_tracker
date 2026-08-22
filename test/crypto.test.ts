import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, generateToken } from '../worker/crypto';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const { hash, salt } = await hashPassword('correct-password');
    expect(await verifyPassword('correct-password', hash, salt)).toBe(true);
  });

  it('rejects an incorrect password', async () => {
    const { hash, salt } = await hashPassword('correct-password');
    expect(await verifyPassword('wrong-password', hash, salt)).toBe(false);
  });

  it('produces a different salt each time', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a.salt).not.toBe(b.salt);
  });
});

describe('generateToken', () => {
  it('produces distinct, URL-safe tokens', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });
});
