# Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up a Cloudflare Worker (Hono) backed by D1 that provides the full auth core — register, login, logout, forgot/reset password, roles, superadmin — plus the matching frontend auth pages, all served from one Worker.

**Architecture:** A single Hono app in `worker/index.ts` is the Worker's `main` entry and also serves the built Vite/React app via Workers static assets. Session state and roles live in D1; passwords are hashed with PBKDF2 via Web Crypto. The frontend is a thin React Router shell over `fetch`-based API calls.

**Tech Stack:** Hono, Cloudflare D1, Cloudflare Workers static assets, Web Crypto (PBKDF2), Vite + React + react-router-dom, `@cloudflare/vitest-pool-workers` for backend tests.

**Spec:** `docs/superpowers/specs/2026-08-21-foundation-design.md`

## Global Constraints

- Single Cloudflare Worker serves both the API and the built frontend — no separate Pages project.
- Hono is the Worker's routing/middleware framework.
- Sessions are an opaque random token stored in a D1 `sessions` table, set as an `HttpOnly`/`Secure`/`SameSite=Lax` cookie — not JWT.
- Roles are a `roles` table with a JSON `permissions` array column on it — no `role_permissions` join table.
- User id 1 is superadmin, checked by `id === 1`, and this check bypasses every permission check unconditionally.
- Password reset has no email service yet: the reset link is returned directly in the JSON response (and logged), not emailed.
- Passwords are hashed with PBKDF2 via Web Crypto `SubtleCrypto`: 100,000 iterations, SHA-256, a random 16-byte salt per user.
- Migration tracking uses wrangler's own built-in D1 migrations mechanism only — no custom migrations table/UI.

---

### Task 1: Worker & D1 scaffold with a health check

**Files:**
- Create: `wrangler.jsonc`
- Create: `migrations/0001_init.sql`
- Create: `worker/types.ts`
- Create: `worker/index.ts`
- Create: `vitest.config.ts`
- Create: `test/setup/apply-migrations.ts`
- Create: `test/health.test.ts`
- Create: `tsconfig.worker.json`

**Interfaces:**
- Produces: `Env` (`{ DB: D1Database }`) and `AuthUser` (`{ id, email, display_name, role_id, role_name, permissions: string[] }`) from `worker/types.ts`, used by every later Worker task.
- Produces: default-exported Hono app from `worker/index.ts` with `GET /api/health` — later tasks add middleware/routes to this same app.

- [ ] **Step 1: Install backend dependencies**

```bash
yarn add hono
yarn add -D wrangler @cloudflare/vitest-pool-workers vitest @cloudflare/workers-types
```

- [ ] **Step 2: Create the D1 database**

```bash
npx wrangler login   # if not already authenticated
npx wrangler d1 create dryyt-tracker-db
```

Copy the `database_id` from the command output — you'll need it in Step 3.

- [ ] **Step 3: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "./node_modules/wrangler/config-schema.json",
  "name": "dryyt-tracker",
  "main": "worker/index.ts",
  "compatibility_date": "2026-08-21",
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "dryyt-tracker-db",
      "database_id": "<DATABASE_ID_FROM_STEP_2>",
      "migrations_dir": "./migrations"
    }
  ]
}
```

Replace `<DATABASE_ID_FROM_STEP_2>` with the real id.

- [ ] **Step 4: Write the initial migration**

Create `migrations/0001_init.sql`:

```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  display_name TEXT NOT NULL,
  avatar_key TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE sessions (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_sessions_user ON sessions(user_id);

CREATE TABLE password_resets (
  token TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_resets_user ON password_resets(user_id);

INSERT INTO roles (id, name, permissions) VALUES
  (1, 'superadmin', '["*"]'),
  (2, 'user', '[]');
```

- [ ] **Step 5: Apply the migration locally**

```bash
npx wrangler d1 migrations apply dryyt-tracker-db --local
```

Expected: output confirms `0001_init.sql` applied.

- [ ] **Step 6: Write `worker/types.ts`**

```ts
export interface Env {
  DB: D1Database;
}

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
}

export type AppBindings = {
  Bindings: Env;
  Variables: { user: AuthUser | null };
};
```

- [ ] **Step 7: Write `worker/index.ts`**

```ts
import { Hono } from 'hono';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineWorkersConfig, readD1Migrations } from '@cloudflare/vitest-pool-workers/config';
import path from 'node:path';

export default defineWorkersConfig(async () => {
  const migrationsPath = path.join(__dirname, 'migrations');
  const migrations = await readD1Migrations(migrationsPath);
  return {
    test: {
      setupFiles: ['./test/setup/apply-migrations.ts'],
      poolOptions: {
        workers: {
          wrangler: { configPath: './wrangler.jsonc' },
          miniflare: {
            bindings: { TEST_MIGRATIONS: migrations },
          },
        },
      },
    },
  };
});
```

- [ ] **Step 9: Write `test/setup/apply-migrations.ts`**

```ts
import { applyD1Migrations, env } from 'cloudflare:test';

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

- [ ] **Step 10: Write the failing test — `test/health.test.ts`**

```ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('GET /api/health', () => {
  it('returns ok', async () => {
    const res = await SELF.fetch('https://example.com/api/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 11: Add the test script and run it**

Add to `package.json` `scripts`: `"test": "vitest run"`.

```bash
yarn test
```

Expected: PASS (the route from Step 7 already satisfies it — this step confirms the whole scaffold wires together).

- [ ] **Step 12: Add `tsconfig.worker.json` for editor type-checking**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "lib": ["ES2022"],
    "module": "ES2022",
    "moduleResolution": "Bundler",
    "types": ["@cloudflare/workers-types"],
    "strict": true,
    "skipLibCheck": true,
    "noEmit": true
  },
  "include": ["worker/**/*.ts", "test/**/*.ts"]
}
```

```bash
npx tsc --noEmit -p tsconfig.worker.json
```

Expected: 0 errors.

- [ ] **Step 13: Commit**

```bash
git add wrangler.jsonc migrations worker vitest.config.ts test tsconfig.worker.json package.json yarn.lock
git commit -m "feat: Worker + D1 scaffold with health check"
```

---

### Task 2: Password hashing utility

**Files:**
- Create: `worker/crypto.ts`
- Test: `test/crypto.test.ts`

**Interfaces:**
- Consumes: nothing beyond Web Crypto globals.
- Produces: `hashPassword(password: string): Promise<{ hash: string; salt: string }>`, `verifyPassword(password: string, hash: string, salt: string): Promise<boolean>`, `generateToken(): string` — used by Tasks 4–7.

- [ ] **Step 1: Write the failing tests**

```ts
// test/crypto.test.ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test crypto.test.ts
```

Expected: FAIL — `worker/crypto.ts` does not exist yet.

- [ ] **Step 3: Implement `worker/crypto.ts`**

```ts
const PBKDF2_ITERATIONS = 100_000;
const KEY_LENGTH_BYTES = 32;
const SALT_LENGTH_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(b64: string): Uint8Array {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function toBase64Url(bytes: Uint8Array): string {
  return toBase64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function deriveKey(password: string, salt: Uint8Array): Promise<Uint8Array> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  const derivedBits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    KEY_LENGTH_BYTES * 8,
  );
  return new Uint8Array(derivedBits);
}

export async function hashPassword(password: string): Promise<{ hash: string; salt: string }> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH_BYTES));
  const derived = await deriveKey(password, salt);
  return { hash: toBase64(derived), salt: toBase64(salt) };
}

export async function verifyPassword(password: string, hash: string, salt: string): Promise<boolean> {
  const derived = await deriveKey(password, fromBase64(salt));
  const expected = fromBase64(hash);
  if (derived.length !== expected.length) return false;
  let diff = 0;
  for (let i = 0; i < derived.length; i++) diff |= derived[i] ^ expected[i];
  return diff === 0;
}

export function generateToken(): string {
  return toBase64Url(crypto.getRandomValues(new Uint8Array(32)));
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test crypto.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/crypto.ts test/crypto.test.ts
git commit -m "feat: PBKDF2 password hashing and token generation"
```

---

### Task 3: D1 query helpers

**Files:**
- Create: `worker/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `Env['DB']` (a `D1Database`).
- Produces: `DbUser`, `DbRole` types; `countUsers`, `createUser`, `getUserByEmail`, `getUserById`, `getRoleById`, `createSession`, `getSessionWithUser`, `deleteSession`, `deleteSessionsForUser`, `createPasswordReset`, `getPasswordReset`, `deletePasswordReset`, `updatePasswordHash` — used by Tasks 4–7.

- [ ] **Step 1: Write the failing tests**

```ts
// test/db.test.ts
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
    expect(result?.user.email).toBe('b@example.com');
    expect(result?.role.name).toBe('superadmin');

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
    expect((await getUserById(env.DB, user.id))?.password_hash).toBe('new-hash');

    await deletePasswordReset(env.DB, 'reset-1');
    expect(await getPasswordReset(env.DB, 'reset-1')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test db.test.ts
```

Expected: FAIL — `worker/db.ts` does not exist yet.

- [ ] **Step 3: Implement `worker/db.ts`**

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test db.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add worker/db.ts test/db.test.ts
git commit -m "feat: D1 query helpers for users, roles, sessions, password resets"
```

---

### Task 4: Auth middleware (session loading, requireAuth, requirePermission)

**Files:**
- Create: `worker/util.ts`
- Create: `worker/middleware/auth.ts`
- Test: `test/middleware.test.ts`

**Interfaces:**
- Consumes: `DbUser`, `DbRole`, `createSession`, `getSessionWithUser`, `deleteSession` from `worker/db.ts` (Task 3); `generateToken` from `worker/crypto.ts` (Task 2); `AppBindings`, `AuthUser` from `worker/types.ts` (Task 1).
- Produces: `isValidEmail(email: string): boolean`, `toPublicUser(user: DbUser, role: DbRole): AuthUser` from `worker/util.ts`; `SESSION_COOKIE` constant, `createAndSetSession(c, userId: number): Promise<void>`, `loadSession`, `requireAuth`, `requirePermission(permission: string)` from `worker/middleware/auth.ts` — used by Tasks 5–7.

- [ ] **Step 1: Write `worker/util.ts` (no test needed — trivial, exercised indirectly by every route test)**

```ts
import type { DbRole, DbUser } from './db';
import type { AuthUser } from './types';

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export function toPublicUser(user: DbUser, role: DbRole): AuthUser {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role_id: user.role_id,
    role_name: role.name,
    permissions: JSON.parse(role.permissions) as string[],
  };
}
```

- [ ] **Step 2: Write the failing tests — `test/middleware.test.ts`**

```ts
import { env } from 'cloudflare:test';
import { Hono } from 'hono';
import { describe, it, expect } from 'vitest';
import { createUser } from '../worker/db';
import { loadSession, requireAuth, requirePermission, createAndSetSession } from '../worker/middleware/auth';
import type { AppBindings } from '../worker/types';

function buildTestApp() {
  const app = new Hono<AppBindings>();
  app.use('*', loadSession);
  app.post('/login-as/:id', async (c) => {
    await createAndSetSession(c, Number(c.req.param('id')));
    return c.body(null, 204);
  });
  app.get('/whoami', requireAuth, (c) => c.json({ user: c.get('user') }));
  app.get('/admin-only', requirePermission('manage_users'), (c) => c.json({ ok: true }));
  return app;
}

function extractCookie(res: Response): string {
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header');
  return setCookie.split(';')[0];
}

describe('loadSession + requireAuth', () => {
  it('returns 401 for an unauthenticated request', async () => {
    const app = buildTestApp();
    const res = await app.request('/whoami', {}, env);
    expect(res.status).toBe(401);
  });

  it('returns the user for an authenticated request', async () => {
    const app = buildTestApp();
    const user = await createUser(env.DB, {
      email: 'e@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'E',
    });
    const loginRes = await app.request(`/login-as/${user.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('e@example.com');
  });
});

describe('requirePermission', () => {
  it('user id 1 bypasses the check even without the permission', async () => {
    const app = buildTestApp();
    const superadmin = await createUser(env.DB, {
      email: 'super@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Super',
    });
    expect(superadmin.id).toBe(1);
    const loginRes = await app.request(`/login-as/${superadmin.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });

  it('returns 403 for a role without the permission', async () => {
    const app = buildTestApp();
    await createUser(env.DB, { email: 'first@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'First' });
    const plain = await createUser(env.DB, { email: 'plain@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Plain' });
    const loginRes = await app.request(`/login-as/${plain.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(403);
  });

  it('returns 200 for a role granted the permission', async () => {
    const app = buildTestApp();
    await createUser(env.DB, { email: 'first2@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'First2' });
    const grantedRole = await env.DB
      .prepare("INSERT INTO roles (name, permissions) VALUES (?, ?) RETURNING id")
      .bind('tester_admin', '["manage_users"]')
      .first<{ id: number }>();
    const adminish = await createUser(env.DB, {
      email: 'adminish@example.com', passwordHash: 'h', passwordSalt: 's', roleId: grantedRole!.id, displayName: 'Adminish',
    });
    const loginRes = await app.request(`/login-as/${adminish.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    const res = await app.request('/admin-only', { headers: { Cookie: cookie } }, env);
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

```bash
yarn test middleware.test.ts
```

Expected: FAIL — `worker/middleware/auth.ts` does not exist yet.

- [ ] **Step 4: Implement `worker/middleware/auth.ts`**

```ts
import type { Context, Next } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { createSession, deleteSession, getSessionWithUser } from '../db';
import { generateToken } from '../crypto';
import { toPublicUser } from '../util';
import type { AppBindings } from '../types';

export const SESSION_COOKIE = 'session';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function createAndSetSession(c: Context<AppBindings>, userId: number): Promise<void> {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await createSession(c.env.DB, token, userId, expiresAt);
  const secure = new URL(c.req.url).protocol === 'https:';
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'Lax',
    path: '/',
    maxAge: SESSION_TTL_MS / 1000,
  });
}

export async function clearSession(c: Context<AppBindings>): Promise<void> {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    await deleteSession(c.env.DB, token);
    deleteCookie(c, SESSION_COOKIE, { path: '/' });
  }
}

export async function loadSession(c: Context<AppBindings>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set('user', null);
    return next();
  }
  const result = await getSessionWithUser(c.env.DB, token);
  if (!result || new Date(result.session.expires_at) < new Date()) {
    c.set('user', null);
    return next();
  }
  c.set('user', toPublicUser(result.user, result.role));
  return next();
}

export async function requireAuth(c: Context<AppBindings>, next: Next) {
  if (!c.get('user')) return c.json({ error: 'unauthenticated' }, 401);
  return next();
}

export function requirePermission(permission: string) {
  return async (c: Context<AppBindings>, next: Next) => {
    const user = c.get('user');
    if (!user) return c.json({ error: 'unauthenticated' }, 401);
    if (user.id === 1 || user.permissions.includes('*') || user.permissions.includes(permission)) {
      return next();
    }
    return c.json({ error: 'forbidden' }, 403);
  };
}
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn test middleware.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/util.ts worker/middleware/auth.ts test/middleware.test.ts
git commit -m "feat: session-loading auth middleware with permission gate"
```

---

### Task 5: Register endpoint

**Files:**
- Create: `worker/routes/auth.ts`
- Modify: `worker/index.ts`
- Test: `test/routes/register.test.ts`

**Interfaces:**
- Consumes: `isValidEmail`, `toPublicUser` (Task 4); `createAndSetSession` (Task 4); `hashPassword` (Task 2); `countUsers`, `createUser`, `getUserByEmail`, `getRoleById` (Task 3).
- Produces: `authRoutes` (a Hono instance) exported from `worker/routes/auth.ts`, mounted at `/api/auth` in `worker/index.ts` — Tasks 6–7 add more routes to this same file/instance.

- [ ] **Step 1: Write the failing tests — `test/routes/register.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test register.test.ts
```

Expected: FAIL — `/api/auth/register` doesn't exist yet (404).

- [ ] **Step 3: Implement `worker/routes/auth.ts` (register only for now)**

```ts
import { Hono } from 'hono';
import { hashPassword } from '../crypto';
import { countUsers, createUser, getUserByEmail, getRoleById } from '../db';
import { createAndSetSession } from '../middleware/auth';
import { isValidEmail, toPublicUser } from '../util';
import type { AppBindings } from '../types';

export const authRoutes = new Hono<AppBindings>();

authRoutes.post('/register', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);

  if (await getUserByEmail(c.env.DB, email)) {
    return c.json({ error: 'email_taken' }, 409);
  }

  const roleId = (await countUsers(c.env.DB)) === 0 ? 1 : 2;
  const { hash, salt } = await hashPassword(password);
  const user = await createUser(c.env.DB, { email, passwordHash: hash, passwordSalt: salt, roleId, displayName });

  await createAndSetSession(c, user.id);

  const role = await getRoleById(c.env.DB, user.role_id);
  return c.json({ user: toPublicUser(user, role!) }, 201);
});
```

- [ ] **Step 4: Mount `authRoutes` in `worker/index.ts`**

```ts
import { Hono } from 'hono';
import { loadSession } from './middleware/auth';
import { authRoutes } from './routes/auth';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.use('*', loadSession);
app.route('/api/auth', authRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn test register.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 6: Commit**

```bash
git add worker/routes/auth.ts worker/index.ts test/routes/register.test.ts
git commit -m "feat: register endpoint with superadmin bootstrap"
```

---

### Task 6: Login, logout, and me endpoints

**Files:**
- Modify: `worker/routes/auth.ts`
- Test: `test/routes/login.test.ts`

**Interfaces:**
- Consumes: `getUserByEmail` (Task 3); `verifyPassword` (Task 2); `createAndSetSession`, `clearSession`, `requireAuth` (Task 4).
- Produces: nothing new for later tasks — `authRoutes` still the single export.

- [ ] **Step 1: Write the failing tests — `test/routes/login.test.ts`**

```ts
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
  const setCookie = res.headers.get('set-cookie');
  if (!setCookie) throw new Error('no set-cookie header');
  return setCookie.split(';')[0];
}

describe('POST /api/auth/login', () => {
  it('logs in with correct credentials', async () => {
    await post('/api/auth/register', { email: 'login1@example.com', password: 'password123', display_name: 'L1' });
    const res = await post('/api/auth/login', { email: 'login1@example.com', password: 'password123' });
    expect(res.status).toBe(200);
    expect(res.headers.get('set-cookie')).toMatch(/session=/);
  });

  it('rejects a wrong password with 401', async () => {
    await post('/api/auth/register', { email: 'login2@example.com', password: 'password123', display_name: 'L2' });
    const res = await post('/api/auth/login', { email: 'login2@example.com', password: 'wrong-password' });
    expect(res.status).toBe(401);
  });

  it('rejects an unknown email with 401', async () => {
    const res = await post('/api/auth/login', { email: 'nobody@example.com', password: 'password123' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await SELF.fetch('https://example.com/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the current user when authenticated', async () => {
    const registerRes = await post('/api/auth/register', { email: 'me@example.com', password: 'password123', display_name: 'Me' });
    const cookie = extractCookie(registerRes);
    const res = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.email).toBe('me@example.com');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session so /me becomes unauthenticated', async () => {
    const registerRes = await post('/api/auth/register', { email: 'logout@example.com', password: 'password123', display_name: 'Logout' });
    const cookie = extractCookie(registerRes);

    const logoutRes = await post('/api/auth/logout', undefined, cookie);
    expect(logoutRes.status).toBe(204);

    const meRes = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(meRes.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test login.test.ts
```

Expected: FAIL — these routes don't exist yet (404).

- [ ] **Step 3: Add login/logout/me to `worker/routes/auth.ts`**

Add two new imports alongside the existing ones at the top of the file (do not duplicate the existing `hashPassword`/`countUsers`/etc. imports — just add these):

```ts
import { verifyPassword } from '../crypto';
import { requireAuth, clearSession } from '../middleware/auth';
```

Then append the following handlers after the `register` handler:

```ts
authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  const user = await getUserByEmail(c.env.DB, email);
  if (!user) return c.json({ error: 'invalid_credentials' }, 401);

  const valid = await verifyPassword(password, user.password_hash, user.password_salt);
  if (!valid) return c.json({ error: 'invalid_credentials' }, 401);

  await createAndSetSession(c, user.id);
  const role = await getRoleById(c.env.DB, user.role_id);
  return c.json({ user: toPublicUser(user, role!) });
});

authRoutes.post('/logout', async (c) => {
  await clearSession(c);
  return c.body(null, 204);
});

authRoutes.get('/me', requireAuth, (c) => {
  return c.json({ user: c.get('user') });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test login.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run the full test suite to check for regressions**

```bash
yarn test
```

Expected: all tests across all files still PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/routes/auth.ts test/routes/login.test.ts
git commit -m "feat: login, logout, and me endpoints"
```

---

### Task 7: Forgot-password and reset-password endpoints

**Files:**
- Modify: `worker/routes/auth.ts`
- Test: `test/routes/password-reset.test.ts`

**Interfaces:**
- Consumes: `generateToken` (Task 2); `createPasswordReset`, `getPasswordReset`, `deletePasswordReset`, `updatePasswordHash`, `deleteSessionsForUser` (Task 3); `hashPassword` (Task 2).
- Produces: nothing new for later tasks — Foundation's route set is complete after this task.

- [ ] **Step 1: Write the failing tests — `test/routes/password-reset.test.ts`**

```ts
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
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test password-reset.test.ts
```

Expected: FAIL — these routes don't exist yet (404).

- [ ] **Step 3: Add forgot-password/reset-password to `worker/routes/auth.ts`**

Add these imports alongside the existing ones at the top of the file:

```ts
import { generateToken } from '../crypto';
import {
  createPasswordReset, getPasswordReset, deletePasswordReset,
  updatePasswordHash, deleteSessionsForUser,
} from '../db';
```

(`generateToken` joins the existing `hashPassword` import from `../crypto`; the `db` imports join the existing ones from `../db` — combine into the single existing import lines from that module rather than duplicating them.)

Append the two handlers:

```ts
authRoutes.post('/forgot-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

  const user = await getUserByEmail(c.env.DB, email);
  if (!user) return c.json({ ok: true });

  const token = generateToken();
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  await createPasswordReset(c.env.DB, token, user.id, expiresAt);

  const url = new URL(c.req.url);
  const resetLink = `${url.origin}/reset-password?token=${token}`;
  console.log(`Password reset link for ${email}: ${resetLink}`);
  return c.json({ ok: true, resetLink });
});

authRoutes.post('/reset-password', async (c) => {
  const body = await c.req.json().catch(() => null);
  const token = typeof body?.token === 'string' ? body.token : '';
  const password = typeof body?.password === 'string' ? body.password : '';

  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);

  const reset = await getPasswordReset(c.env.DB, token);
  if (!reset || new Date(reset.expires_at) < new Date()) {
    return c.json({ error: 'invalid_or_expired_token' }, 400);
  }

  const { hash, salt } = await hashPassword(password);
  await updatePasswordHash(c.env.DB, reset.user_id, hash, salt);
  await deletePasswordReset(c.env.DB, token);
  await deleteSessionsForUser(c.env.DB, reset.user_id);

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test password-reset.test.ts
```

Expected: PASS (6 tests).

- [ ] **Step 5: Run the full test suite**

```bash
yarn test
```

Expected: all tests across all files PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/routes/auth.ts test/routes/password-reset.test.ts
git commit -m "feat: forgot-password and reset-password endpoints"
```

---

### Task 8: End-to-end integration test

**Files:**
- Test: `test/integration.test.ts`

**Interfaces:**
- Consumes: the full `authRoutes` route set (Tasks 5–7). No new production code — this task only adds a cross-flow test to catch integration issues the per-route tests wouldn't (e.g. two handlers disagreeing on a field name).

- [ ] **Step 1: Write the integration test**

```ts
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
```

- [ ] **Step 2: Run it**

```bash
yarn test integration.test.ts
```

Expected: PASS (1 test, exercising the whole lifecycle).

- [ ] **Step 3: Run the entire suite one more time**

```bash
yarn test
```

Expected: all tests PASS.

- [ ] **Step 4: Commit**

```bash
git add test/integration.test.ts
git commit -m "test: end-to-end auth lifecycle integration test"
```

---

### Task 9: Frontend scaffolding — router, API client, static assets wiring

**Files:**
- Modify: `wrangler.jsonc`
- Create: `src/lib/api.ts`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Delete: `src/App.css` content replaced by minimal styling (kept as-is otherwise)

**Interfaces:**
- Produces: `apiFetch<T>(path: string, init?: RequestInit): Promise<T>` in `src/lib/api.ts` — thin wrapper that always sends `credentials: 'include'` and throws `ApiError` on non-2xx, parsing `{ error }` from the body. Used by every page component in Task 10.
- Produces: a `<Routes>` shell in `App.tsx` with placeholder elements at `/login`, `/register`, `/forgot-password`, `/reset-password`, `/` — Task 10 replaces the placeholders with real page components.

- [ ] **Step 1: Install the router**

```bash
yarn add react-router-dom
```

- [ ] **Step 2: Write `src/lib/api.ts`**

```ts
export class ApiError extends Error {
  constructor(public status: number, public code: string) {
    super(code);
  }
}

export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
    ...init,
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? 'unknown_error');
  }
  return body as T;
}
```

- [ ] **Step 3: Wire the router in `src/main.tsx`**

```tsx
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
```

- [ ] **Step 4: Write the route shell in `src/App.tsx`**

```tsx
import { Routes, Route } from 'react-router-dom'
import './App.css'

function Placeholder({ name }: { name: string }) {
  return <div>{name} page — implemented in the next task</div>
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Placeholder name="Home" />} />
      <Route path="/login" element={<Placeholder name="Login" />} />
      <Route path="/register" element={<Placeholder name="Register" />} />
      <Route path="/forgot-password" element={<Placeholder name="Forgot password" />} />
      <Route path="/reset-password" element={<Placeholder name="Reset password" />} />
    </Routes>
  )
}

export default App
```

- [ ] **Step 5: Add static assets serving to `wrangler.jsonc`**

Add this key alongside the existing `d1_databases` entry:

```jsonc
"assets": {
  "directory": "./dist",
  "not_found_handling": "single-page-application",
  "run_worker_first": ["/api/*"]
}
```

If `run_worker_first` or `not_found_handling` reject as unknown fields, check `node_modules/wrangler/config-schema.json` for the current field names/shape in your installed wrangler version and adjust to match — the intent is: `/api/*` always reaches the Worker, everything else falls back to `index.html` for client-side routing.

- [ ] **Step 6: Build and manually verify in the browser**

```bash
yarn build
npx wrangler dev
```

Open `http://localhost:8787/` — the Home placeholder renders. Open `http://localhost:8787/api/health` — returns `{"ok":true}`. Open `http://localhost:8787/login` directly (not via client-side nav) — the SPA fallback serves `index.html` and the router renders the Login placeholder, confirming deep-link routing works.

- [ ] **Step 7: Commit**

```bash
git add wrangler.jsonc src/lib/api.ts src/App.tsx src/main.tsx package.json yarn.lock
git commit -m "feat: frontend router shell, API client, static assets wiring"
```

---

### Task 10: Auth pages (Login, Register, ForgotPassword, ResetPassword) and route guards

**Files:**
- Create: `src/pages/Login.tsx`
- Create: `src/pages/Register.tsx`
- Create: `src/pages/ForgotPassword.tsx`
- Create: `src/pages/ResetPassword.tsx`
- Create: `src/pages/AuthedHome.tsx`
- Create: `src/lib/useCurrentUser.ts`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` from `src/lib/api.ts` (Task 9).
- Produces: `useCurrentUser()` hook returning `{ user: AuthUser | null; loading: boolean; refresh: () => Promise<void> }` — the seam later sub-projects' authenticated pages (real dashboard, admin console) will use instead of `AuthedHome`.

- [ ] **Step 1: Write `src/lib/useCurrentUser.ts`**

```ts
import { useCallback, useEffect, useState } from 'react';
import { apiFetch, ApiError } from './api';

export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
}

export function useCurrentUser() {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const body = await apiFetch<{ user: AuthUser }>('/auth/me');
      setUser(body.user);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        setUser(null);
      } else {
        throw err;
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { user, loading, refresh };
}
```

- [ ] **Step 2: Write `src/pages/Login.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function Login({ onLoggedIn }: { onLoggedIn: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
      await onLoggedIn();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Log in</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
      </label>
      <button type="submit">Log in</button>
      <p>
        <a href="/forgot-password">Forgot password?</a> · <a href="/register">Register</a>
      </p>
    </form>
  );
}
```

- [ ] **Step 3: Write `src/pages/Register.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function Register({ onRegistered }: { onRegistered: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName }),
      });
      await onRegistered();
      navigate('/');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Register</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <button type="submit">Register</button>
    </form>
  );
}
```

- [ ] **Step 4: Write `src/pages/ForgotPassword.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { apiFetch } from '../lib/api';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [resetLink, setResetLink] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const body = await apiFetch<{ ok: boolean; resetLink?: string }>('/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
    setSubmitted(true);
    setResetLink(body.resetLink ?? null);
  }

  if (submitted) {
    return (
      <div>
        <p>If that email exists, a reset link has been generated.</p>
        {resetLink && (
          <p>
            Dev mode (no email service yet) — reset link: <a href={resetLink}>{resetLink}</a>
          </p>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Forgot password</h1>
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <button type="submit">Send reset link</button>
    </form>
  );
}
```

- [ ] **Step 5: Write `src/pages/ResetPassword.tsx`**

```tsx
import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

export default function ResetPassword() {
  const [searchParams] = useSearchParams();
  const token = searchParams.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/auth/reset-password', { method: 'POST', body: JSON.stringify({ token, password }) });
      navigate('/login');
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h1>Reset password</h1>
      {error && <p role="alert">{error}</p>}
      <label>
        New password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <button type="submit">Reset password</button>
    </form>
  );
}
```

- [ ] **Step 6: Write `src/pages/AuthedHome.tsx`**

```tsx
import { AuthUser } from '../lib/useCurrentUser';
import { apiFetch } from '../lib/api';

export default function AuthedHome({ user, onLoggedOut }: { user: AuthUser; onLoggedOut: () => Promise<void> }) {
  async function handleLogout() {
    await apiFetch('/auth/logout', { method: 'POST' });
    await onLoggedOut();
  }

  return (
    <div>
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <button onClick={handleLogout}>Log out</button>
      <p>Dashboard, profile editing, and alerts are built in the next sub-project.</p>
    </div>
  );
}
```

- [ ] **Step 7: Wire pages and route guards in `src/App.tsx`**

```tsx
import { Navigate, Routes, Route } from 'react-router-dom'
import { useCurrentUser } from './lib/useCurrentUser'
import Login from './pages/Login'
import Register from './pages/Register'
import ForgotPassword from './pages/ForgotPassword'
import ResetPassword from './pages/ResetPassword'
import AuthedHome from './pages/AuthedHome'
import './App.css'

function App() {
  const { user, loading, refresh } = useCurrentUser()

  if (loading) return <p>Loading…</p>

  return (
    <Routes>
      <Route
        path="/"
        element={user ? <AuthedHome user={user} onLoggedOut={refresh} /> : <Navigate to="/login" replace />}
      />
      <Route
        path="/login"
        element={user ? <Navigate to="/" replace /> : <Login onLoggedIn={refresh} />}
      />
      <Route
        path="/register"
        element={user ? <Navigate to="/" replace /> : <Register onRegistered={refresh} />}
      />
      <Route path="/forgot-password" element={<ForgotPassword />} />
      <Route path="/reset-password" element={<ResetPassword />} />
    </Routes>
  )
}

export default App
```

- [ ] **Step 8: Manually verify the full flow in a browser**

```bash
yarn build
npx wrangler dev
```

Walk through, in the browser at `http://localhost:8787`:
1. Land on `/` while logged out → redirected to `/login`.
2. Go to `/register`, create the first account → redirected to `/` showing "Welcome" and `Role: superadmin`.
3. Click "Log out" → back at `/login`.
4. Log back in with the same credentials → back at `/`.
5. Log out, go to `/forgot-password`, submit the email → dev-mode reset link is shown on the page.
6. Follow that link to `/reset-password?token=...`, set a new password → redirected to `/login`.
7. Log in with the new password → succeeds.

- [ ] **Step 9: Commit**

```bash
git add src/pages src/lib/useCurrentUser.ts src/App.tsx
git commit -m "feat: auth pages and route guards wired to the API"
```

---

## Self-Review Notes

- **Spec coverage:** every route in the Foundation spec (`register`, `login`, `logout`, `me`, `forgot-password`, `reset-password`) has a task with tests (Tasks 5–7); the data model (Task 1), PBKDF2 hashing (Task 2), superadmin-by-id + permission gate (Task 4), and the dev-mode reset-link behavior (Task 7) are all covered. The `Secure` cookie attribute is derived from the request protocol rather than relying on a library auto-detect, which is a correction to the spec's phrasing but preserves its intent (secure cookies in production, working login in local HTTP dev).
- **Deferred by design, not by omission:** dashboard/profile/alerts/R2/admin console (sub-project 2) and the homepage listing (sub-project 3) are intentionally out of scope, per the spec's own "Explicitly deferred" section.
- **Type consistency checked:** `AuthUser` shape (`id, email, display_name, role_id, role_name, permissions`) is identical in `worker/types.ts` and `src/lib/useCurrentUser.ts`; `toPublicUser`'s return shape matches both. `DbUser`/`DbRole` field names used in `worker/db.ts` match exactly what `worker/util.ts` and the route handlers destructure.
