export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  password_salt: string;
  role_id: number;
  display_name: string;
  avatar_key: string | null;
  is_active: number;
  parent_id: number | null;
  contact_number: string | null;
  address: string | null;
  lat: number | null;
  lng: number | null;
  opening_hours: string | null;
  // JSON — see worker/socialLinks.ts. Not read by getSessionWithUser.
  social_links?: string | null;
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
  impersonator_id: number | null;
}

export interface DbPasswordReset {
  token: string;
  user_id: number;
  expires_at: string;
}

export interface DbDevLoginToken {
  token: string;
  user_id: number;
  expires_at: string;
}

// Not used by registration (would reconstruct a count-then-insert race) — see createUserWithBootstrapRole.
export async function countUsers(db: D1Database): Promise<number> {
  const row = await db.prepare('SELECT COUNT(*) as count FROM users').first<{ count: number }>();
  return row?.count ?? 0;
}

// Not used by registration (would reconstruct a count-then-insert race) — see createUserWithBootstrapRole.
export async function createUser(
  db: D1Database,
  params: {
    email: string;
    passwordHash: string;
    passwordSalt: string;
    roleId: number;
    displayName: string;
    parentId?: number | null;
    contactNumber?: string | null;
  },
): Promise<DbUser> {
  const result = await db
    .prepare(
      'INSERT INTO users (email, password_hash, password_salt, role_id, display_name, parent_id, contact_number) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(
      params.email,
      params.passwordHash,
      params.passwordSalt,
      params.roleId,
      params.displayName,
      params.parentId ?? null,
      params.contactNumber ?? null,
    )
    .first<DbUser>();
  if (!result) throw new Error('failed to create user');
  if (params.parentId) await linkOwnerCustomer(db, params.parentId, result.id);
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

export async function listRoles(db: D1Database): Promise<DbRole[]> {
  const { results } = await db.prepare('SELECT * FROM roles ORDER BY id').all<DbRole>();
  return results;
}

export async function getRoleByName(db: D1Database, name: string): Promise<DbRole | null> {
  const row = await db.prepare('SELECT * FROM roles WHERE name = ?').bind(name).first<DbRole>();
  return row ?? null;
}

export async function listActiveOwners(db: D1Database): Promise<DbUser[]> {
  const { results } = await db
    .prepare(
      `SELECT u.* FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = 1
       ORDER BY u.display_name`,
    )
    .all<DbUser>();
  return results;
}

// Resolves the public /owner/:identifier and /plugins/workflow/:identifier
// routes — identifier is either a numeric id (the original, still-linkable
// form) or an owner's display_name (the newer /owner/<name> alias). Display
// names aren't unique, so a name lookup takes whichever active owner matches
// first; only ever returns an active 'owner'-role user, never any other role.
export async function getActiveOwnerByIdentifier(db: D1Database, identifier: string): Promise<DbUser | null> {
  const asId = Number(identifier);
  if (Number.isInteger(asId) && String(asId) === identifier) {
    const user = await getUserById(db, asId);
    if (!user || !user.is_active) return null;
    const role = await getRoleById(db, user.role_id);
    return role?.name === 'owner' ? user : null;
  }

  const row = await db
    .prepare(
      `SELECT u.* FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'owner' AND u.is_active = 1 AND u.display_name = ?
       LIMIT 1`,
    )
    .bind(identifier)
    .first<DbUser>();
  return row ?? null;
}

// An owner's customers: everyone linked in owner_customers, which includes
// customers shared with other owners (parent_id is only the home owner).
export async function listOwnerCustomers(db: D1Database, ownerId: number): Promise<DbUser[]> {
  const { results } = await db
    .prepare(
      `SELECT u.* FROM users u JOIN owner_customers oc ON oc.customer_id = u.id
       WHERE oc.owner_id = ? ORDER BY u.created_at DESC, u.id DESC`,
    )
    .bind(ownerId)
    .all<DbUser>();
  return results;
}

// One page of listOwnerCustomers, plus the owner's total customer count.
export async function pageOwnerCustomers(
  db: D1Database,
  ownerId: number,
  params: { limit: number; offset: number },
): Promise<{ users: DbUser[]; total: number }> {
  const from = 'FROM users u JOIN owner_customers oc ON oc.customer_id = u.id WHERE oc.owner_id = ?';
  const [page, count] = await db.batch([
    db.prepare(`SELECT u.* ${from} ORDER BY u.created_at DESC, u.id DESC LIMIT ? OFFSET ?`).bind(ownerId, params.limit, params.offset),
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(ownerId),
  ]);
  return {
    users: page.results as DbUser[],
    total: (count.results[0] as { n: number }).n,
  };
}

export async function isOwnerCustomer(db: D1Database, ownerId: number, customerId: number): Promise<boolean> {
  const row = await db
    .prepare('SELECT 1 FROM owner_customers WHERE owner_id = ? AND customer_id = ?')
    .bind(ownerId, customerId)
    .first();
  return row !== null;
}

// Links a customer to an owner (no-op if already linked); a customer with no
// home owner yet gets this one as parent_id.
export async function linkOwnerCustomer(db: D1Database, ownerId: number, customerId: number): Promise<void> {
  await db.batch([
    db.prepare('INSERT OR IGNORE INTO owner_customers (owner_id, customer_id) VALUES (?, ?)').bind(ownerId, customerId),
    db.prepare('UPDATE users SET parent_id = ? WHERE id = ? AND parent_id IS NULL').bind(ownerId, customerId),
  ]);
}

// Removes one owner's link, but only while the customer has another owner;
// returns false (and keeps the link) when this owner is the last one. If the
// removed owner was the home owner, the earliest remaining one takes over.
export async function unlinkSharedCustomer(db: D1Database, ownerId: number, customerId: number): Promise<boolean> {
  const others = await db
    .prepare('SELECT COUNT(*) AS n FROM owner_customers WHERE customer_id = ? AND owner_id != ?')
    .bind(customerId, ownerId)
    .first<{ n: number }>();
  if (!others?.n) return false;
  await db.batch([
    db.prepare('DELETE FROM owner_customers WHERE owner_id = ? AND customer_id = ?').bind(ownerId, customerId),
    db
      .prepare(
        `UPDATE users SET parent_id = (
           SELECT owner_id FROM owner_customers WHERE customer_id = ?1 ORDER BY created_at, owner_id LIMIT 1
         ) WHERE id = ?1 AND parent_id = ?2`,
      )
      .bind(customerId, ownerId),
  ]);
  return true;
}

// The active 'user'-role account with this contact number (compared by digits
// only, so "0917 111-2222" = "09171112222"), under any owner or none —
// preferring one already linked to ownerId.
export async function findCustomerByContact(db: D1Database, contactDigits: string, ownerId: number): Promise<DbUser | null> {
  const row = await db
    .prepare(
      `SELECT u.* FROM users u JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'user' AND u.is_active = 1
         AND REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(REPLACE(u.contact_number, ' ', ''), '-', ''), '(', ''), ')', ''), '.', ''), '+', '') = ?1
       ORDER BY EXISTS (SELECT 1 FROM owner_customers oc WHERE oc.owner_id = ?2 AND oc.customer_id = u.id) DESC, u.id
       LIMIT 1`,
    )
    .bind(contactDigits, ownerId)
    .first<DbUser>();
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

export async function createMasqueradeSession(
  db: D1Database,
  token: string,
  userId: number,
  expiresAt: string,
  impersonatorId: number,
): Promise<void> {
  await db
    .prepare('INSERT INTO sessions (token, user_id, expires_at, impersonator_id) VALUES (?, ?, ?, ?)')
    .bind(token, userId, expiresAt, impersonatorId)
    .run();
}

export async function getSessionWithUser(
  db: D1Database,
  token: string,
): Promise<{ session: DbSession; user: DbUser; role: DbRole } | null> {
  const row = await db
    .prepare(
      `SELECT s.token as s_token, s.user_id as s_user_id, s.expires_at as s_expires_at,
              s.impersonator_id as s_impersonator_id,
              u.id as u_id, u.email as u_email, u.password_hash as u_password_hash,
              u.password_salt as u_password_salt, u.role_id as u_role_id,
              u.display_name as u_display_name, u.avatar_key as u_avatar_key, u.is_active as u_is_active,
              u.parent_id as u_parent_id, u.contact_number as u_contact_number, u.address as u_address, u.lat as u_lat, u.lng as u_lng,
              u.opening_hours as u_opening_hours, u.created_at as u_created_at,
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
    session: {
      token: row.s_token as string,
      user_id: row.s_user_id as number,
      expires_at: row.s_expires_at as string,
      impersonator_id: (row.s_impersonator_id as number | null) ?? null,
    },
    user: {
      id: row.u_id as number,
      email: row.u_email as string,
      password_hash: row.u_password_hash as string,
      password_salt: row.u_password_salt as string,
      role_id: row.u_role_id as number,
      display_name: row.u_display_name as string,
      avatar_key: row.u_avatar_key as string | null,
      is_active: row.u_is_active as number,
      parent_id: (row.u_parent_id as number | null) ?? null,
      contact_number: (row.u_contact_number as string | null) ?? null,
      address: (row.u_address as string | null) ?? null,
      lat: (row.u_lat as number | null) ?? null,
      lng: (row.u_lng as number | null) ?? null,
      opening_hours: (row.u_opening_hours as string | null) ?? null,
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

export interface AdminSessionRow {
  id: number;
  user_id: number;
  user_name: string;
  user_email: string;
  role_name: string;
  impersonator_name: string | null;
  created_at: string;
  expires_at: string;
}

// Sessions for the superadmin's Sessions tab, newest first, capped per group.
// The token is never selected — it's the bearer credential; rowid stands in as
// a display id. expires_at is ISO; datetime() normalizes it to SQLite's format.
export async function listSessions(
  db: D1Database,
  limit: number,
): Promise<{ active: AdminSessionRow[]; expired: AdminSessionRow[]; activeTotal: number; expiredTotal: number }> {
  const select = (expired: boolean) =>
    db
      .prepare(
        `SELECT s.rowid AS id, s.user_id, u.display_name AS user_name, u.email AS user_email, r.name AS role_name,
                i.display_name AS impersonator_name, s.created_at, datetime(s.expires_at) AS expires_at
         FROM sessions s
         JOIN users u ON u.id = s.user_id
         JOIN roles r ON r.id = u.role_id
         LEFT JOIN users i ON i.id = s.impersonator_id
         WHERE datetime(s.expires_at) ${expired ? '<=' : '>'} datetime('now')
         ORDER BY s.created_at DESC, s.rowid DESC LIMIT ?`,
      )
      .bind(limit);
  const count = (expired: boolean) =>
    db.prepare(
      `SELECT COUNT(*) AS n FROM sessions WHERE datetime(expires_at) ${expired ? '<=' : '>'} datetime('now')`,
    );
  const [active, expired, activeTotal, expiredTotal] = await db.batch([select(false), select(true), count(false), count(true)]);
  return {
    active: active.results as AdminSessionRow[],
    expired: expired.results as AdminSessionRow[],
    activeTotal: (activeTotal.results[0] as { n: number }).n,
    expiredTotal: (expiredTotal.results[0] as { n: number }).n,
  };
}

export async function deleteExpiredSessions(db: D1Database): Promise<number> {
  const result = await db.prepare("DELETE FROM sessions WHERE datetime(expires_at) <= datetime('now')").run();
  return result.meta.changes;
}

// Deletes sessions by display id (rowid), never the caller's own token so a
// superadmin can't sign themselves out from the Sessions tab. Chunked to stay
// under D1's 100 bound parameters per statement.
export async function deleteSessionsByIds(db: D1Database, ids: number[], keepToken: string): Promise<number> {
  const statements = [];
  for (let i = 0; i < ids.length; i += 90) {
    const chunk = ids.slice(i, i + 90);
    statements.push(
      db
        .prepare(`DELETE FROM sessions WHERE rowid IN (${chunk.map(() => '?').join(', ')}) AND token != ?`)
        .bind(...chunk, keepToken),
    );
  }
  if (statements.length === 0) return 0;
  const results = await db.batch(statements);
  return results.reduce((n, r) => n + r.meta.changes, 0);
}

export async function deleteAllPasswordResetsForUser(db: D1Database, userId: number): Promise<void> {
  await db.prepare('DELETE FROM password_resets WHERE user_id = ?').bind(userId).run();
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

// Atomically deletes and returns the token row in one statement, so two concurrent
// requests for the same token can't both observe it as valid (only one gets the row back).
export async function consumePasswordReset(db: D1Database, token: string): Promise<DbPasswordReset | null> {
  const row = await db
    .prepare('DELETE FROM password_resets WHERE token = ? RETURNING *')
    .bind(token)
    .first<DbPasswordReset>();
  return row ?? null;
}

export async function createDevLoginToken(
  db: D1Database,
  token: string,
  userId: number,
  expiresAt: string,
): Promise<void> {
  await db
    .prepare('INSERT INTO dev_login_tokens (token, user_id, expires_at) VALUES (?, ?, ?)')
    .bind(token, userId, expiresAt)
    .run();
}

// Atomically deletes and returns the token row in one statement (same single-use
// pattern as consumePasswordReset) so the link can only mint one session.
export async function consumeDevLoginToken(db: D1Database, token: string): Promise<DbDevLoginToken | null> {
  const row = await db
    .prepare('DELETE FROM dev_login_tokens WHERE token = ? RETURNING *')
    .bind(token)
    .first<DbDevLoginToken>();
  return row ?? null;
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

export async function updateUserProfile(
  db: D1Database,
  userId: number,
  // contactNumber: undefined leaves it unchanged, null clears it.
  // socialLinks (JSON): likewise.
  params: { displayName?: string; email?: string; contactNumber?: string | null; socialLinks?: string | null },
): Promise<DbUser> {
  const result = await db
    .prepare(
      `UPDATE users SET
         display_name = COALESCE(?, display_name),
         email = COALESCE(?, email),
         contact_number = CASE WHEN ? THEN ? ELSE contact_number END,
         social_links = CASE WHEN ? THEN ? ELSE social_links END
       WHERE id = ?
       RETURNING *`,
    )
    .bind(
      params.displayName ?? null,
      params.email ?? null,
      params.contactNumber !== undefined ? 1 : 0,
      params.contactNumber ?? null,
      params.socialLinks !== undefined ? 1 : 0,
      params.socialLinks ?? null,
      userId,
    )
    .first<DbUser>();
  if (!result) throw new Error('user not found');
  return result;
}

export async function updateStoreDetails(
  db: D1Database,
  userId: number,
  params: { address: string | null; lat: number | null; lng: number | null; openingHours: string | null },
): Promise<void> {
  await db
    .prepare('UPDATE users SET address = ?, lat = ?, lng = ?, opening_hours = ? WHERE id = ?')
    .bind(params.address, params.lat, params.lng, params.openingHours, userId)
    .run();
}

export async function updateCoordinates(db: D1Database, userId: number, lat: number | null, lng: number | null): Promise<void> {
  await db.prepare('UPDATE users SET lat = ?, lng = ? WHERE id = ?').bind(lat, lng, userId).run();
}

export async function setUserAvatarKey(db: D1Database, userId: number, avatarKey: string | null): Promise<void> {
  await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(avatarKey, userId).run();
}

export interface DbAlert {
  id: number;
  user_id: number;
  created_by: number;
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: 'dashboard' | 'public';
  body_html: string;
  created_at: string;
  updated_at: string;
}

export async function createAlert(
  db: D1Database,
  params: { userId: number; createdBy: number; type: DbAlert['type']; visibility: DbAlert['visibility']; bodyHtml: string },
): Promise<DbAlert> {
  const result = await db
    .prepare(
      `INSERT INTO alerts (user_id, created_by, type, visibility, body_html)
       VALUES (?, ?, ?, ?, ?) RETURNING *`,
    )
    .bind(params.userId, params.createdBy, params.type, params.visibility, params.bodyHtml)
    .first<DbAlert>();
  if (!result) throw new Error('failed to create alert');
  return result;
}

export async function getAlertById(db: D1Database, id: number): Promise<DbAlert | null> {
  const row = await db.prepare('SELECT * FROM alerts WHERE id = ?').bind(id).first<DbAlert>();
  return row ?? null;
}

export async function getAlertsForUser(db: D1Database, userId: number): Promise<DbAlert[]> {
  const { results } = await db
    .prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY created_at DESC')
    .bind(userId)
    .all<DbAlert>();
  return results;
}

export interface AdminAlertRow extends DbAlert {
  user_name: string;
  user_email: string;
  created_by_name: string | null;
}

// Every user's alerts for the superadmin's Alerts tab, newest first.
export async function listAllAlerts(db: D1Database): Promise<AdminAlertRow[]> {
  const { results } = await db
    .prepare(
      `SELECT a.*, u.display_name AS user_name, u.email AS user_email, c.display_name AS created_by_name
       FROM alerts a
       JOIN users u ON u.id = a.user_id
       LEFT JOIN users c ON c.id = a.created_by
       ORDER BY a.created_at DESC, a.id DESC`,
    )
    .all<AdminAlertRow>();
  return results;
}

export async function getPublicAlertsForUser(db: D1Database, userId: number): Promise<DbAlert[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM alerts WHERE user_id = ? AND visibility = 'public' ORDER BY created_at DESC`,
    )
    .bind(userId)
    .all<DbAlert>();
  return results;
}

export async function updateAlert(
  db: D1Database,
  id: number,
  params: { type: DbAlert['type']; visibility: DbAlert['visibility']; bodyHtml: string },
): Promise<DbAlert> {
  const result = await db
    .prepare(
      `UPDATE alerts SET type = ?, visibility = ?, body_html = ?, updated_at = datetime('now')
       WHERE id = ? RETURNING *`,
    )
    .bind(params.type, params.visibility, params.bodyHtml, id)
    .first<DbAlert>();
  if (!result) throw new Error('alert not found');
  return result;
}

export async function deleteAlert(db: D1Database, id: number): Promise<void> {
  await db.prepare('DELETE FROM alerts WHERE id = ?').bind(id).run();
}

export async function listUsersWithRoles(db: D1Database): Promise<(DbUser & { role_name: string })[]> {
  const { results } = await db
    .prepare(
      `SELECT u.*, r.name as role_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       ORDER BY u.id ASC`,
    )
    .all<DbUser & { role_name: string }>();
  return results;
}

// One page of the admin console's user list, filtered by search text
// (name/email), role name and active status, plus the matching total. Sorted
// by role rank (superadmin, admin, owner, user, then any other), then by id.
export async function searchUsersWithRoles(
  db: D1Database,
  params: { q: string; role: string | null; active: boolean | null; limit: number; offset: number },
): Promise<{ users: (DbUser & { role_name: string })[]; total: number }> {
  const where: string[] = [];
  const binds: unknown[] = [];
  if (params.q) {
    where.push("(u.display_name LIKE ? ESCAPE '\\' OR u.email LIKE ? ESCAPE '\\')");
    binds.push(params.q, params.q);
  }
  if (params.role) {
    where.push('r.name = ?');
    binds.push(params.role);
  }
  if (params.active !== null) {
    where.push('u.is_active = ?');
    binds.push(params.active ? 1 : 0);
  }
  const from = `FROM users u JOIN roles r ON r.id = u.role_id ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const [page, count] = await db.batch([
    db.prepare(`SELECT u.*, r.name as role_name ${from} ORDER BY CASE r.name WHEN 'superadmin' THEN 0 WHEN 'admin' THEN 1 WHEN 'owner' THEN 2 WHEN 'user' THEN 3 ELSE 4 END, u.id ASC LIMIT ? OFFSET ?`).bind(...binds, params.limit, params.offset),
    db.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds),
  ]);
  return {
    users: page.results as (DbUser & { role_name: string })[],
    total: (count.results[0] as { n: number }).n,
  };
}

// Headline counts for the admin console, independent of any filter.
export async function userStats(
  db: D1Database,
): Promise<{ total: number; active: number; owners: number; customers: number; role_names: string[] }> {
  const [totals, roles] = await db.batch([
    db.prepare(
      `SELECT COUNT(*) AS total,
              COALESCE(SUM(u.is_active), 0) AS active,
              COALESCE(SUM(r.name = 'owner'), 0) AS owners,
              COALESCE(SUM(r.name = 'user'), 0) AS customers
       FROM users u JOIN roles r ON r.id = u.role_id`,
    ),
    db.prepare('SELECT DISTINCT r.name FROM users u JOIN roles r ON r.id = u.role_id ORDER BY r.name'),
  ]);
  const t = totals.results[0] as { total: number; active: number; owners: number; customers: number };
  return { ...t, role_names: (roles.results as { name: string }[]).map((r) => r.name) };
}

export async function updateUserAdminFields(
  db: D1Database,
  userId: number,
  params: { displayName?: string; email?: string; roleId?: number },
): Promise<DbUser> {
  const result = await db
    .prepare(
      `UPDATE users SET
         display_name = COALESCE(?, display_name),
         email = COALESCE(?, email),
         role_id = COALESCE(?, role_id)
       WHERE id = ?
       RETURNING *`,
    )
    .bind(params.displayName ?? null, params.email ?? null, params.roleId ?? null, userId)
    .first<DbUser>();
  if (!result) throw new Error('user not found');
  return result;
}

export async function setUserActive(db: D1Database, userId: number, isActive: boolean): Promise<void> {
  await db.prepare('UPDATE users SET is_active = ? WHERE id = ?').bind(isActive ? 1 : 0, userId).run();
}
