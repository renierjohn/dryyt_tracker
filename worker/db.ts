export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  password_salt: string;
  role_id: number;
  display_name: string;
  avatar_key: string | null;
  created_at: string;
}

export interface DbRole {
  id: number;
  name: string;
  permissions: string;
  created_at: string;
}

export interface DbSession {
  token: string;
  user_id: number;
  expires_at: string;
}

export interface DbPasswordReset {
  token: string;
  user_id: number;
  expires_at: string;
}

export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

export async function createUser(
  db: D1Database,
  params: { email: string; passwordHash: string; passwordSalt: string; roleId: number; displayName: string },
): Promise<DbUser> {
  const result = await db
    .prepare(
      'INSERT INTO users (email, password_hash, password_salt, role_id, display_name) VALUES (?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(params.email, params.passwordHash, params.passwordSalt, params.roleId, params.displayName)
    .first<DbUser>();
  if (!result) throw new Error('failed to create user');
  return result;
}

export async function createUserWithBootstrapRole(
  db: D1Database,
  params: { email: string; passwordHash: string; passwordSalt: string; displayName: string },
): Promise<DbUser> {
  const result = await db
    .prepare(
      `INSERT INTO users (email, password_hash, password_salt, role_id, display_name)
       VALUES (?, ?, ?, (SELECT CASE WHEN (SELECT COUNT(*) FROM users) = 0 THEN 1 ELSE 2 END), ?)
       RETURNING *`,
    )
    .bind(params.email, params.passwordHash, params.passwordSalt, params.displayName)
    .first<DbUser>();
  if (!result) throw new Error('failed to create user');
  return result;
}

export async function getUserByEmail(db: D1Database, email: string): Promise<DbUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE email = ?').bind(email).first<DbUser>();
  return row ?? null;
}

export async function getUserById(db: D1Database, id: number): Promise<DbUser | null> {
  const row = await db.prepare('SELECT * FROM users WHERE id = ?').bind(id).first<DbUser>();
  return row ?? null;
}

export async function getRoleById(db: D1Database, id: number): Promise<DbRole | null> {
  const row = await db.prepare('SELECT * FROM roles WHERE id = ?').bind(id).first<DbRole>();
  return row ?? null;
}

export async function createSession(
  db: D1Database,
  token: string,
  userId: number,
  expiresAt: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
}

export async function getSessionWithUser(
  db: D1Database,
  token: string,
): Promise<{ session: DbSession; user: DbUser; role: DbRole } | null> {
  const row = await db
    .prepare(
      `SELECT s.token as s_token, s.user_id as s_user_id, s.expires_at as s_expires_at,
              u.id as u_id, u.email as u_email, u.password_hash as u_password_hash,
              u.password_salt as u_password_salt, u.role_id as u_role_id,
              u.display_name as u_display_name, u.avatar_key as u_avatar_key, u.created_at as u_created_at,
              r.id as r_id, r.name as r_name, r.permissions as r_permissions, r.created_at as r_created_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       JOIN roles r ON r.id = u.role_id
       WHERE s.token = ?`,
    )
    .bind(token)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return {
    session: { token: row.s_token as string, user_id: row.s_user_id as number, expires_at: row.s_expires_at as string },
    user: {
      id: row.u_id as number,
      email: row.u_email as string,
      password_hash: row.u_password_hash as string,
      password_salt: row.u_password_salt as string,
      role_id: row.u_role_id as number,
      display_name: row.u_display_name as string,
      avatar_key: row.u_avatar_key as string | null,
      created_at: row.u_created_at as string,
    },
    role: {
      id: row.r_id as number,
      name: row.r_name as string,
      permissions: row.r_permissions as string,
      created_at: row.r_created_at as string,
    },
  };
}

export async function deleteSession(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE token = ?').bind(token).run();
}

export async function deleteSessionsForUser(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM sessions WHERE user_id = ?').bind(userId).run();
}

export async function createPasswordReset(
  db: D1Database,
  token: string,
  userId: number,
  expiresAt: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO password_resets (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
}

export async function getPasswordReset(db: D1Database, token: string): Promise<DbPasswordReset | null> {
  const row = await db.prepare('SELECT * FROM password_resets WHERE token = ?').bind(token).first<DbPasswordReset>();
  return row ?? null;
}

export async function deletePasswordReset(db: D1Database, token: string): Promise<void> {
  await db.prepare('DELETE FROM password_resets WHERE token = ?').bind(token).run();
}

export async function updatePasswordHash(
  db: D1Database,
  userId: number,
  passwordHash: string,
  passwordSalt: string,
): Promise<void> {
  await db
    .prepare('UPDATE users SET password_hash = ?, password_salt = ? WHERE id = ?')
    .bind(passwordHash, passwordSalt, userId)
    .run();
}
