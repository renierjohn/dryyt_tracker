import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  countUsers, createUser, getUserByEmail, getUserById, getRoleById,
  createSession, getSessionWithUser, deleteSession, deleteSessionsForUser,
  createPasswordReset, getPasswordReset, deletePasswordReset, updatePasswordHash,
} from '../worker/db';

describe('users', () => {
  it('creates and looks up a user by email and id', async () => {
    expect(await countUsers(env.DB)).toBe(0);
    const user = await createUser(env.DB, {
      email: 'a@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'A',
    });
    expect(user.id).toBe(1);
    expect(await countUsers(env.DB)).toBe(1);
    expect((await getUserByEmail(env.DB, 'a@example.com'))?.id).toBe(user.id);
    expect((await getUserById(env.DB, user.id))?.email).toBe('a@example.com');
    expect(await getUserByEmail(env.DB, 'missing@example.com')).toBeNull();
  });
});

describe('roles', () => {
  it('looks up a seeded role', async () => {
    const role = await getRoleById(env.DB, 1);
    expect(role?.name).toBe('superadmin');
  });
});

describe('sessions', () => {
  it('creates a session and joins user + role', async () => {
    const user = await createUser(env.DB, {
      email: 'b@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 1, displayName: 'B',
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await createSession(env.DB, 'tok-1', user.id, expiresAt);

    const result = await getSessionWithUser(env.DB, 'tok-1');

    // Assert session fields
    expect(result?.session.token).toBe('tok-1');
    expect(result?.session.user_id).toBe(user.id);
    expect(result?.session.expires_at).toBe(expiresAt);

    // Assert user fields
    expect(result?.user.id).toBe(user.id);
    expect(result?.user.email).toBe('b@example.com');
    expect(result?.user.password_hash).toBe('h');
    expect(result?.user.password_salt).toBe('s');
    expect(result?.user.role_id).toBe(1);
    expect(result?.user.display_name).toBe('B');
    expect(result?.user.avatar_key).toBeNull();
    expect(result?.user.created_at).toBeTruthy();

    // Assert role fields
    expect(result?.role.id).toBe(1);
    expect(result?.role.name).toBe('superadmin');
    expect(result?.role.permissions).toBe('["*"]');
    expect(result?.role.created_at).toBeTruthy();

    await deleteSession(env.DB, 'tok-1');
    expect(await getSessionWithUser(env.DB, 'tok-1')).toBeNull();
  });

  it('deletes all sessions for a user', async () => {
    const user = await createUser(env.DB, {
      email: 'c@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'C',
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await createSession(env.DB, 'tok-2', user.id, expiresAt);
    await createSession(env.DB, 'tok-3', user.id, expiresAt);
    await deleteSessionsForUser(env.DB, user.id);
    expect(await getSessionWithUser(env.DB, 'tok-2')).toBeNull();
    expect(await getSessionWithUser(env.DB, 'tok-3')).toBeNull();
  });
});

describe('password resets', () => {
  it('creates, reads, and deletes a reset token; updates the password hash', async () => {
    const user = await createUser(env.DB, {
      email: 'd@example.com', passwordHash: 'old-hash', passwordSalt: 'old-salt', roleId: 2, displayName: 'D',
    });
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    await createPasswordReset(env.DB, 'reset-1', user.id, expiresAt);

    const reset = await getPasswordReset(env.DB, 'reset-1');
    expect(reset?.user_id).toBe(user.id);

    await updatePasswordHash(env.DB, user.id, 'new-hash', 'new-salt');
    const updatedUser = await getUserById(env.DB, user.id);
    expect(updatedUser?.password_hash).toBe('new-hash');
    expect(updatedUser?.password_salt).toBe('new-salt');

    await deletePasswordReset(env.DB, 'reset-1');
    expect(await getPasswordReset(env.DB, 'reset-1')).toBeNull();
  });
});
