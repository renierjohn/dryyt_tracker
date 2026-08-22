import { env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
  countUsers, createUser, getUserByEmail, getUserById, getRoleById,
  createSession, getSessionWithUser, deleteSession, deleteSessionsForUser,
  createPasswordReset, getPasswordReset, deletePasswordReset, updatePasswordHash,
  updateUserProfile, setUserAvatarKey,
  createAlert, getAlertById, getAlertsForUser, getPublicAlertsForUser, updateAlert, deleteAlert,
  listUsersWithRoles, updateUserAdminFields, setUserActive,
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

describe('is_active column and alerts table (migration 0002)', () => {
  it('defaults is_active to 1 for a new user', async () => {
    const user = await createUser(env.DB, {
      email: 'active-check@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Active Check',
    });
    const row = await env.DB.prepare('SELECT is_active FROM users WHERE id = ?').bind(user.id).first<{ is_active: number }>();
    expect(row?.is_active).toBe(1);
  });

  it('has a queryable alerts table with the expected columns', async () => {
    const user = await createUser(env.DB, {
      email: 'alert-owner@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alert Owner',
    });
    const inserted = await env.DB.prepare(
      `INSERT INTO alerts (user_id, created_by, type, visibility, body_html) VALUES (?, ?, 'info', 'public', '<p>hi</p>') RETURNING *`,
    ).bind(user.id, user.id).first<Record<string, unknown>>();
    expect(inserted?.type).toBe('info');
    expect(inserted?.visibility).toBe('public');
  });

  it('seeded an admin role with manage_users permission', async () => {
    const role = await env.DB.prepare("SELECT * FROM roles WHERE name = 'admin'").first<{ permissions: string }>();
    expect(JSON.parse(role!.permissions)).toEqual(['manage_users']);
  });
});

describe('updateUserProfile', () => {
  it('updates display_name and email', async () => {
    const user = await createUser(env.DB, {
      email: 'before@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Before',
    });
    const updated = await updateUserProfile(env.DB, user.id, { displayName: 'After', email: 'after@example.com' });
    expect(updated.display_name).toBe('After');
    expect(updated.email).toBe('after@example.com');
  });

  it('updates only the provided field', async () => {
    const user = await createUser(env.DB, {
      email: 'partial@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Partial',
    });
    const updated = await updateUserProfile(env.DB, user.id, { displayName: 'Changed' });
    expect(updated.display_name).toBe('Changed');
    expect(updated.email).toBe('partial@example.com');
  });
});

describe('setUserAvatarKey', () => {
  it('sets and clears the avatar key', async () => {
    const user = await createUser(env.DB, {
      email: 'avatar@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Avatar',
    });
    await setUserAvatarKey(env.DB, user.id, 'avatars/1/photo.jpg');
    expect((await getUserById(env.DB, user.id))?.avatar_key).toBe('avatars/1/photo.jpg');

    await setUserAvatarKey(env.DB, user.id, null);
    expect((await getUserById(env.DB, user.id))?.avatar_key).toBeNull();
  });
});

describe('alerts CRUD', () => {
  it('creates and lists a user\'s own alerts', async () => {
    const user = await createUser(env.DB, {
      email: 'alerts1@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alerts1',
    });
    const alert = await createAlert(env.DB, {
      userId: user.id, createdBy: user.id, type: 'info', visibility: 'public', bodyHtml: '<p>hi</p>',
    });
    expect(alert.type).toBe('info');
    const list = await getAlertsForUser(env.DB, user.id);
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe(alert.id);
  });

  it('filters public alerts by visibility', async () => {
    const user = await createUser(env.DB, {
      email: 'alerts2@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alerts2',
    });
    await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'info', visibility: 'dashboard', bodyHtml: '<p>a</p>' });
    await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'warning', visibility: 'public', bodyHtml: '<p>b</p>' });
    await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'danger', visibility: 'both', bodyHtml: '<p>c</p>' });

    const publicAlerts = await getPublicAlertsForUser(env.DB, user.id);
    expect(publicAlerts).toHaveLength(2);
    expect(publicAlerts.map((a) => a.visibility).sort()).toEqual(['both', 'public']);
  });

  it('gets a single alert by id, or null if missing', async () => {
    const user = await createUser(env.DB, {
      email: 'alerts3@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alerts3',
    });
    const alert = await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'info', visibility: 'public', bodyHtml: '<p>x</p>' });
    expect((await getAlertById(env.DB, alert.id))?.id).toBe(alert.id);
    expect(await getAlertById(env.DB, 999999)).toBeNull();
  });

  it('updates an alert', async () => {
    const user = await createUser(env.DB, {
      email: 'alerts4@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alerts4',
    });
    const alert = await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'info', visibility: 'public', bodyHtml: '<p>old</p>' });
    const updated = await updateAlert(env.DB, alert.id, { type: 'danger', visibility: 'dashboard', bodyHtml: '<p>new</p>' });
    expect(updated.type).toBe('danger');
    expect(updated.visibility).toBe('dashboard');
    expect(updated.body_html).toBe('<p>new</p>');
  });

  it('deletes an alert', async () => {
    const user = await createUser(env.DB, {
      email: 'alerts5@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Alerts5',
    });
    const alert = await createAlert(env.DB, { userId: user.id, createdBy: user.id, type: 'info', visibility: 'public', bodyHtml: '<p>x</p>' });
    await deleteAlert(env.DB, alert.id);
    expect(await getAlertById(env.DB, alert.id)).toBeNull();
  });
});

describe('admin user management', () => {
  it('lists users with their role name', async () => {
    const user = await createUser(env.DB, {
      email: 'listme@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'List Me',
    });
    const list = await listUsersWithRoles(env.DB);
    const found = list.find((u) => u.id === user.id);
    expect(found?.role_name).toBe('user');
  });

  it('updates admin-editable fields including role_id', async () => {
    const user = await createUser(env.DB, {
      email: 'editme@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Edit Me',
    });
    const updated = await updateUserAdminFields(env.DB, user.id, { displayName: 'Edited', roleId: 1 });
    expect(updated.display_name).toBe('Edited');
    expect(updated.role_id).toBe(1);
  });

  it('sets is_active on and off', async () => {
    const user = await createUser(env.DB, {
      email: 'deactivateme@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Deactivate Me',
    });
    await setUserActive(env.DB, user.id, false);
    expect((await getUserById(env.DB, user.id))?.is_active).toBe(0);
    await setUserActive(env.DB, user.id, true);
    expect((await getUserById(env.DB, user.id))?.is_active).toBe(1);
  });
});
