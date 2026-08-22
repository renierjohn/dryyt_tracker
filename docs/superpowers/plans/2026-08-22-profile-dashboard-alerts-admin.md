# Profile, Dashboard, Alerts & Admin Console Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add profile editing, R2 avatar upload, a self/admin alerts system rendered via CKEditor5, a public per-user page, and a permission-gated admin console — all on top of the Foundation auth core already merged to `develop`.

**Architecture:** Same single Hono Worker + D1 + React frontend as Foundation. New pieces: an R2 bucket bound to the Worker for avatars, a Workers-native `HTMLRewriter`-based HTML sanitizer (no DOM/jsdom dependency needed), new D1 tables/columns, new route groups mounted on the existing `authRoutes`-style pattern, and new React pages/components.

**Tech Stack:** Hono, D1, Cloudflare R2, `HTMLRewriter` (built into the Workers runtime), `ckeditor5` + `@ckeditor/ckeditor5-react` (GPL license), React Router.

**Spec:** `docs/superpowers/specs/2026-08-21-profile-dashboard-alerts-admin-design.md`

## Global Constraints

- Avatar upload goes through the Worker (multipart POST → validate → R2 `put`), not a presigned URL.
- Avatars are served via a Worker proxy route (`GET /api/avatars/:key`), not a public R2 bucket.
- Avatar limit: 5MB, `image/jpeg`/`image/png`/`image/webp` only, validated by actual magic bytes — not the declared `Content-Type`.
- Alerts: one `alerts` table for both self-authored and admin-injected alerts, with a `visibility` column (`dashboard` | `public` | `both`). Self-authored defaults to `public`. Owner or anyone with `manage_users`/`*` can edit/delete.
- Admin console is gated by the `manage_users` permission string (or superadmin's `*`/id-1 bypass), never hardcoded to user id 1.
- User "deletion" is a soft `is_active` flag. Deactivating kills all of that user's sessions immediately. User id 1 can never be deactivated or have its `role_id` changed, enforced server-side.
- CKEditor 5 toolbar is restricted to exactly what the server-side sanitizer allows (bold, italic, link, lists) — `licenseKey: 'GPL'`.
- Sanitizer strips `script`/`style`/`iframe` (tag and contents), strips every attribute except `a[href,title]`, strips `javascript:` hrefs, and unwraps (keeps text, drops the tag) any other disallowed element. Allowed tags: `p, br, strong, em, b, i, ul, ol, li, a`.
- Every new route follows Foundation's error convention: `{ error: string }` JSON body, 400/401/403/404/409/500, no stack traces leaked.

## Current state this plan builds on (verified on `develop` before writing this plan)

- `worker/db.ts` exports: `DbUser`, `DbRole`, `DbSession`, `DbPasswordReset`, `countUsers`, `createUser`, `createUserWithBootstrapRole`, `getUserByEmail`, `getUserById`, `getRoleById`, `createSession`, `getSessionWithUser`, `deleteSession`, `deleteSessionsForUser`, `deleteAllPasswordResetsForUser`, `createPasswordReset`, `getPasswordReset`, `deletePasswordReset`, `consumePasswordReset`, `updatePasswordHash`.
- `worker/types.ts`: `Env = { DB: D1Database; DEV_MODE?: 'true' | 'false' }`, `AuthUser = { id, email, display_name, role_id, role_name, permissions: string[] }`, `AppBindings = { Bindings: Env; Variables: { user: AuthUser | null } }`.
- `worker/middleware/auth.ts` exports `SESSION_COOKIE`, `createAndSetSession`, `clearSession`, `loadSession`, `requireAuth`, `requirePermission(permission)`.
- `worker/routes/auth.ts` (mounted at `/api/auth` in `worker/index.ts`) has `register`/`login`/`logout`/`me`/`forgot-password`/`reset-password`.
- `worker/util.ts` exports `isValidEmail`, `toPublicUser`.
- `src/lib/api.ts` exports `apiFetch<T>(path, init?)` and `ApiError` — always sends `Content-Type: application/json` and `credentials: 'include'`; **this plan's Task 12 fixes it to skip the JSON content-type when the body is `FormData`**, otherwise a multipart avatar upload's boundary header gets clobbered.
- `src/lib/useCurrentUser.ts` exports `useCurrentUser()` → `{ user, loading, refresh }`, `AuthUser` type (same shape as `worker/types.ts`'s).
- `src/App.tsx` renders `AuthedHome` at `/` for an authenticated user (a placeholder — **this plan's Task 13 replaces it with `Dashboard.tsx`**), plus `/login`, `/register`, `/forgot-password`, `/reset-password`.
- `migrations/0001_init.sql` is the only migration so far (`roles`, `users`, `sessions`, `password_resets`). **This plan adds `migrations/0002_profile_alerts_admin.sql`.**

---

### Task 1: Migration 0002, R2 bucket, and wrangler config

**Files:**
- Create: `migrations/0002_profile_alerts_admin.sql`
- Modify: `wrangler.jsonc`
- Modify: `wrangler.toml.example`
- Modify: `worker/types.ts`
- Test: `test/db.test.ts` (extend — smoke-test the new columns/table exist and are queryable)

**Interfaces:**
- Produces: `users.is_active` column; `alerts` table (`id, user_id, created_by, type, visibility, body_html, created_at, updated_at`); seeded `admin` role (`permissions: '["manage_users"]'`); an `AVATARS` R2 binding in `Env`. Every later task in this plan depends on these.

- [ ] **Step 1: Create the R2 bucket**

```bash
npx wrangler r2 bucket create dryyt-tracker-avatars
```

Expected: confirmation the bucket was created in your Cloudflare account.

- [ ] **Step 2: Write the migration**

Create `migrations/0002_profile_alerts_admin.sql`:

```sql
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),
  created_by INTEGER NOT NULL REFERENCES users(id),
  type TEXT NOT NULL CHECK (type IN ('info','success','warning','danger')),
  visibility TEXT NOT NULL CHECK (visibility IN ('dashboard','public','both')) DEFAULT 'public',
  body_html TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alerts_user ON alerts(user_id);

INSERT INTO roles (name, permissions) VALUES ('admin', '["manage_users"]');
```

- [ ] **Step 3: Apply the migration locally**

```bash
npx wrangler d1 migrations apply dryyt-tracker-db --local
```

Expected: confirms `0002_profile_alerts_admin.sql` applied (alongside the already-applied `0001_init.sql`).

- [ ] **Step 4: Add the R2 binding to `wrangler.jsonc`**

Add this key alongside the existing `d1_databases` entry (both at the top level AND inside `env.production` — recall from Foundation that `d1_databases` is NOT inherited by environments; the same is true for `r2_buckets`, verify with the dry-run in Step 6):

```jsonc
"r2_buckets": [
  { "binding": "AVATARS", "bucket_name": "dryyt-tracker-avatars" }
]
```

- [ ] **Step 5: Add `AVATARS` to `Env` in `worker/types.ts`**

```ts
export interface Env {
  DB: D1Database;
  AVATARS: R2Bucket;
  DEV_MODE?: 'true' | 'false';
}
```

- [ ] **Step 6: Verify both environments resolve the new bindings**

```bash
npx wrangler deploy --dry-run
npx wrangler deploy --dry-run --env production
```

Expected: both show `env.AVATARS (dryyt-tracker-avatars) R2 Bucket` in the bindings table alongside `env.DB` and `env.DEV_MODE`. If `env.production`'s output is missing the R2 binding, add `r2_buckets` inside the `env.production` block too (same pattern Foundation used for `d1_databases`), and re-run the dry-run until both are clean.

- [ ] **Step 7: Mirror the R2 binding in `wrangler.toml.example`**

Add (in both the top-level and `[env.production]` sections, matching whatever Step 6 determined is actually required):

```toml
[[r2_buckets]]
binding = "AVATARS"
bucket_name = "<YOUR_R2_BUCKET_NAME>"
```

- [ ] **Step 8: Write a smoke test for the new schema — append to `test/db.test.ts`**

```ts
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
```

Note: `createUser` is already imported in `test/db.test.ts` from Foundation — no new import needed for these tests beyond what's already there (they use `env.DB` directly for the raw-SQL assertions, same pattern as Foundation's `test/routes/password-reset.test.ts` expired-token test).

- [ ] **Step 9: Run the tests**

```bash
yarn test db.test.ts
```

Expected: PASS, including the 3 new tests.

- [ ] **Step 10: Commit**

```bash
git add migrations/0002_profile_alerts_admin.sql wrangler.jsonc wrangler.toml.example worker/types.ts test/db.test.ts
git commit -m "feat: profile/alerts/admin migration, R2 bucket binding"
```

---

### Task 2: HTML sanitizer

**Files:**
- Create: `worker/sanitize.ts`
- Test: `test/sanitize.test.ts`

**Interfaces:**
- Consumes: the Workers-native `HTMLRewriter` global (no import needed, part of the Workers runtime types via `@cloudflare/workers-types`).
- Produces: `sanitizeHtml(html: string): Promise<string>` — used by Task 4 (alerts DB/route layer) to sanitize `body_html` before every insert/update.

- [ ] **Step 1: Write the failing tests**

```ts
// test/sanitize.test.ts
import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../worker/sanitize';

describe('sanitizeHtml', () => {
  it('keeps allowed tags and text', async () => {
    const result = await sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(result).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('removes script tags and their content entirely', async () => {
    const result = await sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<p>safe</p>');
  });

  it('removes style and iframe tags and their content entirely', async () => {
    const result = await sanitizeHtml('<style>body{color:red}</style><iframe src="evil"></iframe><p>ok</p>');
    expect(result).not.toContain('style');
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('color:red');
    expect(result).toContain('<p>ok</p>');
  });

  it('unwraps disallowed tags but keeps their text content', async () => {
    const result = await sanitizeHtml('<div>keep this text</div>');
    expect(result).not.toContain('<div>');
    expect(result).toContain('keep this text');
  });

  it('strips on* attributes from allowed tags', async () => {
    const result = await sanitizeHtml('<p onclick="evil()">text</p>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('<p>text</p>');
  });

  it('keeps href and title on links but strips other attributes', async () => {
    const result = await sanitizeHtml('<a href="https://example.com" title="Example" class="evil">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('title="Example"');
    expect(result).not.toContain('class');
  });

  it('strips javascript: hrefs', async () => {
    const result = await sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('preserves lists', async () => {
    const result = await sanitizeHtml('<ul><li>one</li><li>two</li></ul>');
    expect(result).toBe('<ul><li>one</li><li>two</li></ul>');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test sanitize.test.ts
```

Expected: FAIL — `worker/sanitize.ts` does not exist yet.

- [ ] **Step 3: Implement `worker/sanitize.ts`**

```ts
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'a']);
const DROP_ENTIRELY_TAGS = new Set(['script', 'style', 'iframe']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
};

export async function sanitizeHtml(html: string): Promise<string> {
  const rewriter = new HTMLRewriter().on('*', {
    element(el) {
      const tag = el.tagName.toLowerCase();

      if (DROP_ENTIRELY_TAGS.has(tag)) {
        el.remove();
        return;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        el.removeAndKeepContent();
        return;
      }

      const allowedAttrs = ALLOWED_ATTRS[tag] ?? new Set<string>();
      for (const [name] of [...el.attributes]) {
        if (!allowedAttrs.has(name)) {
          el.removeAttribute(name);
        }
      }

      if (tag === 'a') {
        const href = el.getAttribute('href');
        if (href && /^\s*javascript:/i.test(href)) {
          el.removeAttribute('href');
        }
      }
    },
  });

  const response = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  return await response.text();
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test sanitize.test.ts
```

Expected: PASS (8 tests). If `removeAndKeepContent` behaves unexpectedly (e.g. reorders text relative to siblings), check the actual `HTMLRewriter` type definitions in `node_modules/@cloudflare/workers-types` for the exact method name/behavior in the installed version before changing the test's expectations — this API has been stable for a long time, but verify rather than assume if a test fails in a surprising way.

- [ ] **Step 5: Commit**

```bash
git add worker/sanitize.ts test/sanitize.test.ts
git commit -m "feat: HTMLRewriter-based HTML sanitizer for alert bodies"
```

---

### Task 3: DB helpers — profile fields and avatar key

**Files:**
- Modify: `worker/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `DbUser` (existing).
- Produces: `updateUserProfile(db, userId, { displayName?, email? }): Promise<DbUser>`, `setUserAvatarKey(db, userId, avatarKey: string | null): Promise<void>` — used by Task 7 (profile routes) and Task 8 (avatar routes). Also adds `avatar_key` to `AuthUser` (both `worker/types.ts` and `src/lib/useCurrentUser.ts`) and to `toPublicUser`'s output — every later task that renders "the current user" (Task 13's Dashboard avatar preview, in particular) needs this field, and it isn't sensitive, so there's no reason `toPublicUser` should keep excluding it.

- [ ] **Step 1: Write the failing tests**

```ts
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
```

Add `updateUserProfile` and `setUserAvatarKey` to the existing import line from `../db` in `test/db.test.ts` (it already imports `createUser`, `getUserById`, etc. — extend that same import statement).

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test db.test.ts
```

Expected: FAIL — the two new functions don't exist yet.

- [ ] **Step 3: Implement in `worker/db.ts`**

Append these two functions:

```ts
export async function updateUserProfile(
  db: D1Database,
  userId: number,
  params: { displayName?: string; email?: string },
): Promise<DbUser> {
  const result = await db
    .prepare(
      `UPDATE users SET
         display_name = COALESCE(?, display_name),
         email = COALESCE(?, email)
       WHERE id = ?
       RETURNING *`,
    )
    .bind(params.displayName ?? null, params.email ?? null, userId)
    .first<DbUser>();
  if (!result) throw new Error('user not found');
  return result;
}

export async function setUserAvatarKey(db: D1Database, userId: number, avatarKey: string | null): Promise<void> {
  await db.prepare('UPDATE users SET avatar_key = ? WHERE id = ?').bind(avatarKey, userId).run();
}
```

- [ ] **Step 4: Add `avatar_key` to `AuthUser` and `toPublicUser`**

In `worker/types.ts`, add one field to `AuthUser`:

```ts
export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
  avatar_key: string | null;
}
```

In `worker/util.ts`, update `toPublicUser` to include it:

```ts
export function toPublicUser(user: DbUser, role: DbRole): AuthUser {
  return {
    id: user.id,
    email: user.email,
    display_name: user.display_name,
    role_id: user.role_id,
    role_name: role.name,
    permissions: JSON.parse(role.permissions) as string[],
    avatar_key: user.avatar_key,
  };
}
```

In `src/lib/useCurrentUser.ts`, add the same field to its (structurally identical, separately-defined) `AuthUser` interface:

```ts
export interface AuthUser {
  id: number;
  email: string;
  display_name: string;
  role_id: number;
  role_name: string;
  permissions: string[];
  avatar_key: string | null;
}
```

- [ ] **Step 5: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS — `AuthUser` gained a field; every existing test that checks specific fields on a returned `user` object still passes, since nothing already-asserted was removed or renamed. `yarn build` should also still be clean (run it too, since this touches types consumed across both `worker/` and `src/`):

```bash
yarn build
```

- [ ] **Step 6: Commit**

```bash
git add worker/db.ts worker/types.ts worker/util.ts src/lib/useCurrentUser.ts test/db.test.ts
git commit -m "feat: profile-update and avatar-key D1 helpers; add avatar_key to AuthUser"
```

---

### Task 4: DB helpers — alerts CRUD

**Files:**
- Modify: `worker/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `DbAlert` type; `createAlert`, `getAlertById`, `getAlertsForUser`, `getPublicAlertsForUser`, `updateAlert`, `deleteAlert` — used by Task 9 (self alert routes) and Task 10 (admin injection + public page route).

- [ ] **Step 1: Write the failing tests**

```ts
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
```

Add `createAlert`, `getAlertById`, `getAlertsForUser`, `getPublicAlertsForUser`, `updateAlert`, `deleteAlert` to the existing `../db` import in `test/db.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test db.test.ts
```

Expected: FAIL — none of these functions exist yet.

- [ ] **Step 3: Implement in `worker/db.ts`**

Append:

```ts
export interface DbAlert {
  id: number;
  user_id: number;
  created_by: number;
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: 'dashboard' | 'public' | 'both';
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

export async function getPublicAlertsForUser(db: D1Database, userId: number): Promise<DbAlert[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM alerts WHERE user_id = ? AND visibility IN ('public', 'both') ORDER BY created_at DESC`,
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test db.test.ts
```

Expected: PASS (5 new tests, all prior tests still passing).

- [ ] **Step 5: Commit**

```bash
git add worker/db.ts test/db.test.ts
git commit -m "feat: alerts CRUD D1 helpers"
```

---

### Task 5: DB helpers — admin user management

**Files:**
- Modify: `worker/db.ts`
- Test: `test/db.test.ts`

**Interfaces:**
- Consumes: `DbUser`, `createUser` (existing).
- Produces: `listUsersWithRoles(db): Promise<(DbUser & { role_name: string })[]>`, `updateUserAdminFields(db, userId, { displayName?, email?, roleId? }): Promise<DbUser>`, `setUserActive(db, userId, isActive: boolean): Promise<void>` — used by Task 11 (admin console routes).

- [ ] **Step 1: Write the failing tests**

```ts
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
```

Note: `getUserById`'s return type (`DbUser`) doesn't currently include `is_active` — add it to the `DbUser` interface in this step too (it's a real column since Task 1's migration; the interface was never updated to reflect it). Add `is_active: number;` to `DbUser` in `worker/db.ts`, and add `is_active` to the `RETURNING *`-based rows it already flows through (no query changes needed — `RETURNING *`/`SELECT *` already include it; only the TypeScript interface needs the field).

Add `listUsersWithRoles`, `updateUserAdminFields`, `setUserActive` to the existing `../db` import in `test/db.test.ts`.

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test db.test.ts
```

Expected: FAIL — the three new functions don't exist yet.

- [ ] **Step 3: Update `DbUser` and implement in `worker/db.ts`**

Update the `DbUser` interface (add one field):

```ts
export interface DbUser {
  id: number;
  email: string;
  password_hash: string;
  password_salt: string;
  role_id: number;
  display_name: string;
  avatar_key: string | null;
  is_active: number;
  created_at: string;
}
```

Append the three functions:

```ts
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
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test db.test.ts
```

Expected: PASS (3 new tests, all prior `db.test.ts` tests — including Task 1's `is_active` smoke test — still passing).

- [ ] **Step 5: Run the full suite to check for `DbUser` interface-change regressions**

```bash
yarn test
```

Expected: all tests across all files still PASS (`DbUser` gained a field; nothing narrowed or removed, so nothing else should break — confirm this rather than assume it).

- [ ] **Step 6: Commit**

```bash
git add worker/db.ts test/db.test.ts
git commit -m "feat: admin user-management D1 helpers, add is_active to DbUser"
```

---

### Task 6: Auth middleware — reject deactivated users

**Files:**
- Modify: `worker/middleware/auth.ts`
- Test: `test/middleware.test.ts`

**Interfaces:**
- Consumes: `getSessionWithUser` (existing — its returned `user.is_active` field is now populated per Task 5's `DbUser` change).
- Produces: no new exports — `loadSession`'s behavior changes; every route using `requireAuth`/`requirePermission` benefits automatically.

- [ ] **Step 1: Write the failing test**

Append to `test/middleware.test.ts` (reuse the existing `buildTestApp`/`extractCookie` helpers already defined in that file):

```ts
describe('loadSession + deactivated users', () => {
  it('treats a deactivated user as unauthenticated, even with a valid session cookie', async () => {
    const app = buildTestApp();
    const user = await createUser(env.DB, {
      email: 'deactivated-mw@example.com', passwordHash: 'h', passwordSalt: 's', roleId: 2, displayName: 'Deactivated',
    });
    const loginRes = await app.request(`/login-as/${user.id}`, { method: 'POST' }, env);
    const cookie = extractCookie(loginRes);

    // Confirm the session works before deactivation
    const beforeRes = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(beforeRes.status).toBe(200);

    await setUserActive(env.DB, user.id, false);

    const afterRes = await app.request('/whoami', { headers: { Cookie: cookie } }, env);
    expect(afterRes.status).toBe(401);
  });
});
```

Add `setUserActive` to the existing `../db` import at the top of `test/middleware.test.ts`.

- [ ] **Step 2: Run the test to verify it fails**

```bash
yarn test middleware.test.ts
```

Expected: FAIL — the "after" request still returns 200, since `loadSession` doesn't check `is_active` yet.

- [ ] **Step 3: Update `loadSession` in `worker/middleware/auth.ts`**

Change the body of `loadSession` from:

```ts
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
```

to:

```ts
export async function loadSession(c: Context<AppBindings>, next: Next) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) {
    c.set('user', null);
    return next();
  }
  const result = await getSessionWithUser(c.env.DB, token);
  if (!result || new Date(result.session.expires_at) < new Date() || !result.user.is_active) {
    c.set('user', null);
    return next();
  }
  c.set('user', toPublicUser(result.user, result.role));
  return next();
}
```

(One line changed: the `||` condition gains `!result.user.is_active`. Everything else is identical.)

- [ ] **Step 4: Run the test to verify it passes**

```bash
yarn test middleware.test.ts
```

Expected: PASS (the new test, plus all 5 prior tests in this file).

- [ ] **Step 5: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS — no other test creates a deactivated user, so nothing else should be affected.

- [ ] **Step 6: Commit**

```bash
git add worker/middleware/auth.ts test/middleware.test.ts
git commit -m "feat: reject deactivated users in loadSession"
```

---

### Task 7: Profile routes

**Files:**
- Create: `worker/routes/profile.ts`
- Modify: `worker/index.ts`
- Test: `test/routes/profile.test.ts`

**Interfaces:**
- Consumes: `requireAuth` (existing); `updateUserProfile`, `getUserByEmail`, `getUserById`, `updatePasswordHash`, `deleteSessionsForUser` (existing/Task 3); `hashPassword`, `verifyPassword` (existing); `isValidEmail`, `toPublicUser` (existing); `getRoleById` (existing).
- Produces: `profileRoutes` (a Hono instance), mounted at `/api/profile` in `worker/index.ts` — Task 8 (avatar routes) extends this same file/instance.

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes/profile.test.ts
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
    const body = await res.json();
    expect(body.user.email).toBe('profile-get@example.com');
  });
});

describe('PUT /api/profile', () => {
  it('updates display_name and email', async () => {
    const cookie = await registerAndLogin('profile-put@example.com', 'Profile Put');
    const res = await put('/api/profile', { display_name: 'New Name', email: 'profile-put-new@example.com' }, cookie);
    expect(res.status).toBe(200);
    const body = await res.json();
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

    await put('/api/profile/password', { current_password: 'password123', new_password: 'newpassword456' }, cookie);

    const currentStillWorks = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: cookie } });
    expect(currentStillWorks.status).toBe(200);

    const otherNowRejected = await SELF.fetch('https://example.com/api/auth/me', { headers: { Cookie: otherCookie } });
    expect(otherNowRejected.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
yarn test profile.test.ts
```

Expected: FAIL — `/api/profile*` routes don't exist yet (404).

- [ ] **Step 3: Implement `worker/routes/profile.ts`**

Note on "invalidate other sessions but keep the current one": Foundation's `deleteSessionsForUser` deletes ALL sessions for a user, including the caller's own current one. To keep the current session alive, re-issue a fresh session for the caller immediately after wiping all sessions (matches the pattern already established for register/login — `createAndSetSession` — rather than adding a new "delete all except one" DB function).

```ts
import { Hono } from 'hono';
import { hashPassword, verifyPassword } from '../crypto';
import { getUserByEmail, getUserById, updateUserProfile, updatePasswordHash, deleteSessionsForUser } from '../db';
import { requireAuth, createAndSetSession } from '../middleware/auth';
import { isValidEmail, toPublicUser } from '../util';
import { getRoleById } from '../db';
import type { AppBindings } from '../types';

export const profileRoutes = new Hono<AppBindings>();

profileRoutes.use('*', requireAuth);

profileRoutes.get('/', async (c) => {
  const authUser = c.get('user')!;
  const user = await getUserById(c.env.DB, authUser.id);
  const role = await getRoleById(c.env.DB, user!.role_id);
  return c.json({ user: toPublicUser(user!, role!) });
});

profileRoutes.put('/', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;

  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== authUser.id) {
      return c.json({ error: 'email_taken' }, 409);
    }
  }
  if (displayName !== undefined && !displayName) {
    return c.json({ error: 'missing_display_name' }, 400);
  }

  const updated = await updateUserProfile(c.env.DB, authUser.id, { displayName, email });
  const role = await getRoleById(c.env.DB, updated.role_id);
  return c.json({ user: toPublicUser(updated, role!) });
});

profileRoutes.put('/password', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const currentPassword = typeof body?.current_password === 'string' ? body.current_password : '';
  const newPassword = typeof body?.new_password === 'string' ? body.new_password : '';

  if (newPassword.length < 8) return c.json({ error: 'weak_password' }, 400);

  const user = await getUserById(c.env.DB, authUser.id);
  const valid = await verifyPassword(currentPassword, user!.password_hash, user!.password_salt);
  if (!valid) return c.json({ error: 'invalid_credentials' }, 401);

  const { hash, salt } = await hashPassword(newPassword);
  await updatePasswordHash(c.env.DB, authUser.id, hash, salt);
  await deleteSessionsForUser(c.env.DB, authUser.id);
  await createAndSetSession(c, authUser.id);

  return c.json({ ok: true });
});
```

- [ ] **Step 4: Mount `profileRoutes` in `worker/index.ts`**

```ts
import { Hono } from 'hono';
import { loadSession } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { profileRoutes } from './routes/profile';
import type { AppBindings } from './types';

const app = new Hono<AppBindings>();

app.use('*', loadSession);
app.route('/api/auth', authRoutes);
app.route('/api/profile', profileRoutes);

app.get('/api/health', (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: 'internal_error' }, 500);
});

export default app;
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn test profile.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 6: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS, no regressions.

- [ ] **Step 7: Commit**

```bash
git add worker/routes/profile.ts worker/index.ts test/routes/profile.test.ts
git commit -m "feat: profile GET/PUT and password-change endpoints"
```

---

### Task 8: Avatar upload and serving

**Files:**
- Create: `worker/image.ts`
- Create: `worker/routes/avatars.ts`
- Modify: `worker/routes/profile.ts`
- Modify: `worker/index.ts`
- Test: `test/image.test.ts`
- Test: `test/routes/avatars.test.ts`

**Interfaces:**
- Produces: `detectImageMimeType(bytes: Uint8Array): 'image/jpeg' | 'image/png' | 'image/webp' | null` from `worker/image.ts`.
- Produces: `avatarRoutes` (a Hono instance), mounted at `/api/avatars` in `worker/index.ts`.
- Consumes: `setUserAvatarKey`, `getUserById` (Task 3/existing); `requireAuth` (existing); `c.env.AVATARS` (Task 1's R2 binding).

- [ ] **Step 1: Write the failing tests for magic-byte detection**

```ts
// test/image.test.ts
import { describe, it, expect } from 'vitest';
import { detectImageMimeType } from '../worker/image';

describe('detectImageMimeType', () => {
  it('detects a JPEG by its magic bytes', () => {
    expect(detectImageMimeType(new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe('image/jpeg');
  });

  it('detects a PNG by its magic bytes', () => {
    expect(detectImageMimeType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
  });

  it('detects a WEBP by its magic bytes', () => {
    const bytes = new Uint8Array(12);
    bytes.set([0x52, 0x49, 0x46, 0x46], 0); // "RIFF"
    bytes.set([0, 0, 0, 0], 4); // file size, irrelevant to detection
    bytes.set([0x57, 0x45, 0x42, 0x50], 8); // "WEBP"
    expect(detectImageMimeType(bytes)).toBe('image/webp');
  });

  it('returns null for non-image bytes, even if they look plausible', () => {
    expect(detectImageMimeType(new TextEncoder().encode('<html>not an image</html>'))).toBeNull();
  });

  it('returns null for empty or too-short input', () => {
    expect(detectImageMimeType(new Uint8Array([]))).toBeNull();
    expect(detectImageMimeType(new Uint8Array([0xff]))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify it fails**

```bash
yarn test image.test.ts
```

Expected: FAIL — `worker/image.ts` doesn't exist yet.

- [ ] **Step 3: Implement `worker/image.ts`**

```ts
export type ImageMimeType = 'image/jpeg' | 'image/png' | 'image/webp';

export function detectImageMimeType(bytes: Uint8Array): ImageMimeType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }

  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) {
    return 'image/png';
  }

  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    return 'image/webp';
  }

  return null;
}
```

- [ ] **Step 4: Run to verify it passes**

```bash
yarn test image.test.ts
```

Expected: PASS (5 tests).

- [ ] **Step 5: Write the failing tests for the avatar routes**

```ts
// test/routes/avatars.test.ts
import { SELF, env } from 'cloudflare:test';
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

async function registerAndLogin(email: string): Promise<string> {
  const res = await post('/api/auth/register', { email, password: 'password123', display_name: 'Avatar Tester' });
  return extractCookie(res);
}

// Real JPEG magic bytes followed by arbitrary padding — enough for detectImageMimeType,
// not a decodable image, which is fine: only the header is validated, not full decoding.
function jpegBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function uploadAvatar(cookie: string, bytes: Uint8Array, filename: string, declaredType: string) {
  const formData = new FormData();
  formData.append('file', new File([bytes], filename, { type: declaredType }));
  // Deliberately no Content-Type header here — fetch sets the multipart boundary
  // itself from the FormData body; setting one manually breaks the boundary parsing.
  return SELF.fetch('https://example.com/api/profile/avatar', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
}

describe('POST /api/profile/avatar', () => {
  it('accepts a valid JPEG and stores it in R2', async () => {
    const cookie = await registerAndLogin('avatar-upload@example.com');
    const res = await uploadAvatar(cookie, jpegBytes(), 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.avatar_key).toBeTruthy();
    const stored = await env.AVATARS.get(body.avatar_key);
    expect(stored).not.toBeNull();
  });

  it('rejects a file over 5MB with 400', async () => {
    const cookie = await registerAndLogin('avatar-toobig@example.com');
    const res = await uploadAvatar(cookie, jpegBytes(6 * 1024 * 1024), 'big.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('file_too_large');
  });

  it('rejects non-image content even with a spoofed image Content-Type', async () => {
    const cookie = await registerAndLogin('avatar-spoofed@example.com');
    const fakeBytes = new TextEncoder().encode('this is not an image');
    const res = await uploadAvatar(cookie, fakeBytes, 'fake.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe('unsupported_file_type');
  });

  it('replaces the previous avatar object in R2 on a second upload', async () => {
    const cookie = await registerAndLogin('avatar-replace@example.com');
    const firstRes = await uploadAvatar(cookie, jpegBytes(), 'first.jpg', 'image/jpeg');
    const firstKey = (await firstRes.json()).avatar_key;

    const secondRes = await uploadAvatar(cookie, jpegBytes(), 'second.jpg', 'image/jpeg');
    const secondKey = (await secondRes.json()).avatar_key;

    expect(secondKey).not.toBe(firstKey);
    expect(await env.AVATARS.get(firstKey)).toBeNull();
    expect(await env.AVATARS.get(secondKey)).not.toBeNull();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await uploadAvatar('', jpegBytes(), 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/avatars/:key', () => {
  it('streams a stored avatar with the correct content type', async () => {
    const cookie = await registerAndLogin('avatar-serve@example.com');
    const uploadRes = await uploadAvatar(cookie, jpegBytes(), 'photo.jpg', 'image/jpeg');
    const key = (await uploadRes.json()).avatar_key;

    const res = await SELF.fetch(`https://example.com/api/avatars/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('returns 404 for a missing key', async () => {
    const res = await SELF.fetch('https://example.com/api/avatars/does-not-exist.jpg');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 6: Run to verify they fail**

```bash
yarn test avatars.test.ts
```

Expected: FAIL — the routes don't exist yet.

- [ ] **Step 7: Implement `worker/routes/avatars.ts`**

```ts
import { Hono } from 'hono';
import type { AppBindings } from '../types';

export const avatarRoutes = new Hono<AppBindings>();

avatarRoutes.get('/:key', async (c) => {
  const key = c.req.param('key');
  const object = await c.env.AVATARS.get(key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': object.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'public, max-age=31536000, immutable',
    },
  });
});
```

- [ ] **Step 8: Add the upload handler to `worker/routes/profile.ts`**

Add these two imports alongside the existing ones at the top of the file:

```ts
import { setUserAvatarKey } from '../db';
import { detectImageMimeType } from '../image';
import { generateToken } from '../crypto';
```

(`generateToken` joins the existing `hashPassword, verifyPassword` import from `../crypto`; `setUserAvatarKey` joins the existing `../db` import.)

Append:

```ts
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const EXTENSION_BY_MIME_TYPE: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

profileRoutes.post('/avatar', async (c) => {
  const authUser = c.get('user')!;
  const body = await c.req.parseBody();
  const file = body['file'];

  if (!(file instanceof File)) return c.json({ error: 'missing_file' }, 400);
  if (file.size > MAX_AVATAR_BYTES) return c.json({ error: 'file_too_large' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) return c.json({ error: 'unsupported_file_type' }, 400);

  const user = await getUserById(c.env.DB, authUser.id);
  const previousKey = user!.avatar_key;

  const key = `${authUser.id}-${generateToken()}.${EXTENSION_BY_MIME_TYPE[mimeType]}`;
  await c.env.AVATARS.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  await setUserAvatarKey(c.env.DB, authUser.id, key);

  if (previousKey) {
    await c.env.AVATARS.delete(previousKey);
  }

  return c.json({ avatar_key: key });
});
```

- [ ] **Step 9: Mount `avatarRoutes` in `worker/index.ts`**

Add the import and route registration alongside the existing ones:

```ts
import { avatarRoutes } from './routes/avatars';
// ...
app.route('/api/avatars', avatarRoutes);
```

- [ ] **Step 10: Run the tests to verify they pass**

```bash
yarn test avatars.test.ts
```

Expected: PASS (7 tests).

- [ ] **Step 11: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS.

- [ ] **Step 12: Commit**

```bash
git add worker/image.ts worker/routes/avatars.ts worker/routes/profile.ts worker/index.ts test/image.test.ts test/routes/avatars.test.ts
git commit -m "feat: avatar upload (R2) with magic-byte validation, and serving route"
```

---

### Task 9: Self alert routes

**Files:**
- Create: `worker/routes/alerts.ts`
- Modify: `worker/index.ts`
- Test: `test/routes/alerts.test.ts`

**Interfaces:**
- Consumes: `sanitizeHtml` (Task 2); `createAlert`, `getAlertsForUser`, `getAlertById`, `updateAlert`, `deleteAlert`, `DbAlert` (Task 4); `requireAuth` (existing); `AuthUser` (existing, from `../types`).
- Produces: `alertRoutes` (a Hono instance), mounted at `/api/alerts` — Task 10 reuses this file's `canManageAlert` helper conceptually (re-implemented inline there for the admin-injection route, since that route's ownership rule is different — an admin creates FOR another user, not for themselves).

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes/alerts.test.ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(res: Response): string {
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function registerAndLogin(email: string): Promise<string> {
  const res = await req('POST', '/api/auth/register', { email, password: 'password123', display_name: 'Alert Tester' });
  return extractCookie(res);
}

describe('POST /api/alerts', () => {
  it('creates an alert for the caller and sanitizes the body', async () => {
    const cookie = await registerAndLogin('alert-create@example.com');
    const res = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>hi</p><script>alert(1)</script>' }, cookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alert.body_html).toContain('<p>hi</p>');
    expect(body.alert.body_html).not.toContain('script');
  });

  it('rejects an invalid type with 400', async () => {
    const cookie = await registerAndLogin('alert-badtype@example.com');
    const res = await req('POST', '/api/alerts', { type: 'not-a-type', visibility: 'public', body_html: '<p>x</p>' }, cookie);
    expect(res.status).toBe(400);
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>x</p>' });
    expect(res.status).toBe(401);
  });
});

describe('GET /api/alerts', () => {
  it('lists only the caller\'s own alerts', async () => {
    const cookieA = await registerAndLogin('alert-list-a@example.com');
    const cookieB = await registerAndLogin('alert-list-b@example.com');
    await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>a</p>' }, cookieA);
    await req('POST', '/api/alerts', { type: 'warning', visibility: 'public', body_html: '<p>b</p>' }, cookieB);

    const res = await SELF.fetch('https://example.com/api/alerts', { headers: { Cookie: cookieA } });
    const body = await res.json();
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].type).toBe('info');
  });
});

describe('PUT/DELETE /api/alerts/:id ownership', () => {
  it('lets the owner edit and delete their own alert', async () => {
    const cookie = await registerAndLogin('alert-owner@example.com');
    const createRes = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>old</p>' }, cookie);
    const id = (await createRes.json()).alert.id;

    const putRes = await req('PUT', `/api/alerts/${id}`, { type: 'danger', visibility: 'dashboard', body_html: '<p>new</p>' }, cookie);
    expect(putRes.status).toBe(200);

    const deleteRes = await req('DELETE', `/api/alerts/${id}`, undefined, cookie);
    expect(deleteRes.status).toBe(204);
  });

  it('forbids a different plain user from editing or deleting someone else\'s alert', async () => {
    const ownerCookie = await registerAndLogin('alert-victim@example.com');
    const attackerCookie = await registerAndLogin('alert-attacker@example.com');
    const createRes = await req('POST', '/api/alerts', { type: 'info', visibility: 'public', body_html: '<p>mine</p>' }, ownerCookie);
    const id = (await createRes.json()).alert.id;

    const putRes = await req('PUT', `/api/alerts/${id}`, { type: 'danger', visibility: 'public', body_html: '<p>hacked</p>' }, attackerCookie);
    expect(putRes.status).toBe(403);

    const deleteRes = await req('DELETE', `/api/alerts/${id}`, undefined, attackerCookie);
    expect(deleteRes.status).toBe(403);
  });

  it('returns 404 for a nonexistent alert', async () => {
    const cookie = await registerAndLogin('alert-404@example.com');
    const res = await req('DELETE', '/api/alerts/999999', undefined, cookie);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

```bash
yarn test alerts.test.ts
```

Expected: FAIL — `/api/alerts*` routes don't exist yet.

- [ ] **Step 3: Implement `worker/routes/alerts.ts`**

```ts
import { Hono } from 'hono';
import { sanitizeHtml } from '../sanitize';
import { createAlert, getAlertsForUser, getAlertById, updateAlert, deleteAlert } from '../db';
import type { DbAlert } from '../db';
import { requireAuth } from '../middleware/auth';
import type { AppBindings, AuthUser } from '../types';

export const alertRoutes = new Hono<AppBindings>();

alertRoutes.use('*', requireAuth);

const ALERT_TYPES = new Set(['info', 'success', 'warning', 'danger']);
const ALERT_VISIBILITIES = new Set(['dashboard', 'public', 'both']);

function canManageAlert(user: AuthUser, alert: DbAlert): boolean {
  if (alert.user_id === user.id) return true;
  return user.id === 1 || user.permissions.includes('*') || user.permissions.includes('manage_users');
}

alertRoutes.get('/', async (c) => {
  const user = c.get('user')!;
  const alerts = await getAlertsForUser(c.env.DB, user.id);
  return c.json({ alerts });
});

alertRoutes.post('/', async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : '';
  const visibility = typeof body?.visibility === 'string' ? body.visibility : 'public';
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : '';

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);
  if (!bodyHtml.trim()) return c.json({ error: 'missing_body' }, 400);

  const sanitized = await sanitizeHtml(bodyHtml);
  const alert = await createAlert(c.env.DB, {
    userId: user.id,
    createdBy: user.id,
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert }, 201);
});

alertRoutes.put('/:id', async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const alert = await getAlertById(c.env.DB, id);
  if (!alert) return c.json({ error: 'not_found' }, 404);
  if (!canManageAlert(user, alert)) return c.json({ error: 'forbidden' }, 403);

  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : alert.type;
  const visibility = typeof body?.visibility === 'string' ? body.visibility : alert.visibility;
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : alert.body_html;

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);

  const sanitized = await sanitizeHtml(bodyHtml);
  const updated = await updateAlert(c.env.DB, id, {
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert: updated });
});

alertRoutes.delete('/:id', async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const alert = await getAlertById(c.env.DB, id);
  if (!alert) return c.json({ error: 'not_found' }, 404);
  if (!canManageAlert(user, alert)) return c.json({ error: 'forbidden' }, 403);

  await deleteAlert(c.env.DB, id);
  return c.body(null, 204);
});
```

Note: this task adds `AuthUser` to the exports consumed from `worker/types.ts` — `AuthUser` is already exported there (Foundation); this file just imports it for the first time.

- [ ] **Step 4: Mount `alertRoutes` in `worker/index.ts`**

```ts
import { alertRoutes } from './routes/alerts';
// ...
app.route('/api/alerts', alertRoutes);
```

- [ ] **Step 5: Run the tests to verify they pass**

```bash
yarn test alerts.test.ts
```

Expected: PASS (8 tests).

- [ ] **Step 6: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS.

- [ ] **Step 7: Commit**

```bash
git add worker/routes/alerts.ts worker/index.ts test/routes/alerts.test.ts
git commit -m "feat: self alert CRUD routes with sanitization and ownership checks"
```

---

### Task 10: Admin alert injection and the public per-user page

**Files:**
- Create: `worker/routes/admin.ts`
- Create: `worker/routes/public.ts`
- Modify: `worker/index.ts`
- Test: `test/routes/admin-alerts.test.ts`
- Test: `test/routes/public.test.ts`
- Test helper: `test/helpers.ts`

**Interfaces:**
- Consumes: `sanitizeHtml` (Task 2); `createAlert`, `DbAlert` (Task 4); `getUserById`, `getPublicAlertsForUser` (Task 3/4); `requirePermission` (existing); `createUser`, `hashPassword` (existing — used by the new test helper).
- Produces: `adminRoutes` (mounted at `/api/admin`, extended by Task 11 with user-management routes); `publicRoutes` (mounted at `/api`, providing `GET /api/users/:id/public`); a shared test helper `createUserWithRole` in `test/helpers.ts` for creating a user with an arbitrary role and logging in as them — needed by every admin-permission test from here through Task 11.

- [ ] **Step 1: Write the shared test helper**

```ts
// test/helpers.ts
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
```

- [ ] **Step 2: Write the failing tests for admin alert injection**

```ts
// test/routes/admin-alerts.test.ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getAdminRoleId } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('POST /api/admin/users/:id/alerts', () => {
  it('lets a manage_users-permission caller inject an alert onto another user\'s page', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-inject@example.com', adminRoleId, 'Admin Inject');
    const targetCookie = await createUserWithRoleAndLogin('inject-target@example.com', 2, 'Inject Target');
    const targetMe = await (await req('GET', '/api/auth/me', undefined, targetCookie)).json();
    const targetId = targetMe.user.id;

    const res = await req('POST', `/api/admin/users/${targetId}/alerts`, {
      type: 'warning', visibility: 'both', body_html: '<p>heads up</p>',
    }, adminCookie);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.alert.user_id).toBe(targetId);
    expect(body.alert.created_by).not.toBe(targetId);

    const targetAlerts = await (await req('GET', '/api/alerts', undefined, targetCookie)).json();
    expect(targetAlerts.alerts.some((a: { id: number }) => a.id === body.alert.id)).toBe(true);
  });

  it('returns 403 for a caller without manage_users', async () => {
    const plainCookie = await createUserWithRoleAndLogin('plain-inject@example.com', 2, 'Plain');
    const targetCookie = await createUserWithRoleAndLogin('inject-target2@example.com', 2, 'Target 2');
    const targetMe = await (await req('GET', '/api/auth/me', undefined, targetCookie)).json();

    const res = await req('POST', `/api/admin/users/${targetMe.user.id}/alerts`, {
      type: 'info', visibility: 'public', body_html: '<p>x</p>',
    }, plainCookie);
    expect(res.status).toBe(403);
  });
});
```

- [ ] **Step 3: Write the failing tests for the public user page**

```ts
// test/routes/public.test.ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('GET /api/users/:id/public', () => {
  it('returns display name, avatar, and only public/both alerts, with no auth required', async () => {
    const cookie = await createUserWithRoleAndLogin('public-page@example.com', 2, 'Public Page');
    const me = await (await req('GET', '/api/auth/me', undefined, cookie)).json();
    const id = me.user.id;

    await req('POST', '/api/alerts', { type: 'info', visibility: 'dashboard', body_html: '<p>private</p>' }, cookie);
    await req('POST', '/api/alerts', { type: 'warning', visibility: 'public', body_html: '<p>public</p>' }, cookie);

    const res = await SELF.fetch(`https://example.com/api/users/${id}/public`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.display_name).toBe('Public Page');
    expect(body.alerts).toHaveLength(1);
    expect(body.alerts[0].visibility).toBe('public');
  });

  it('returns 404 for a nonexistent user', async () => {
    const res = await SELF.fetch('https://example.com/api/users/999999/public');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 4: Run to verify they fail**

```bash
yarn test admin-alerts.test.ts public.test.ts
```

Expected: FAIL — none of these routes exist yet.

- [ ] **Step 5: Implement `worker/routes/admin.ts`**

```ts
import { Hono } from 'hono';
import { sanitizeHtml } from '../sanitize';
import { createAlert } from '../db';
import type { DbAlert } from '../db';
import { requirePermission } from '../middleware/auth';
import type { AppBindings } from '../types';

export const adminRoutes = new Hono<AppBindings>();

adminRoutes.use('*', requirePermission('manage_users'));

const ALERT_TYPES = new Set(['info', 'success', 'warning', 'danger']);
const ALERT_VISIBILITIES = new Set(['dashboard', 'public', 'both']);

adminRoutes.post('/users/:id/alerts', async (c) => {
  const admin = c.get('user')!;
  const targetUserId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const type = typeof body?.type === 'string' ? body.type : '';
  const visibility = typeof body?.visibility === 'string' ? body.visibility : 'public';
  const bodyHtml = typeof body?.body_html === 'string' ? body.body_html : '';

  if (!ALERT_TYPES.has(type)) return c.json({ error: 'invalid_type' }, 400);
  if (!ALERT_VISIBILITIES.has(visibility)) return c.json({ error: 'invalid_visibility' }, 400);
  if (!bodyHtml.trim()) return c.json({ error: 'missing_body' }, 400);

  const sanitized = await sanitizeHtml(bodyHtml);
  const alert = await createAlert(c.env.DB, {
    userId: targetUserId,
    createdBy: admin.id,
    type: type as DbAlert['type'],
    visibility: visibility as DbAlert['visibility'],
    bodyHtml: sanitized,
  });
  return c.json({ alert }, 201);
});
```

- [ ] **Step 6: Implement `worker/routes/public.ts`**

```ts
import { Hono } from 'hono';
import { getUserById, getPublicAlertsForUser } from '../db';
import type { AppBindings } from '../types';

export const publicRoutes = new Hono<AppBindings>();

publicRoutes.get('/users/:id/public', async (c) => {
  const id = Number(c.req.param('id'));
  const user = await getUserById(c.env.DB, id);
  if (!user || !user.is_active) return c.json({ error: 'not_found' }, 404);

  const alerts = await getPublicAlertsForUser(c.env.DB, id);
  return c.json({ display_name: user.display_name, avatar_key: user.avatar_key, alerts });
});
```

- [ ] **Step 7: Mount both in `worker/index.ts`**

```ts
import { adminRoutes } from './routes/admin';
import { publicRoutes } from './routes/public';
// ...
app.route('/api/admin', adminRoutes);
app.route('/api', publicRoutes);
```

- [ ] **Step 8: Run the tests to verify they pass**

```bash
yarn test admin-alerts.test.ts public.test.ts
```

Expected: PASS (4 tests).

- [ ] **Step 9: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS.

- [ ] **Step 10: Commit**

```bash
git add worker/routes/admin.ts worker/routes/public.ts worker/index.ts test/helpers.ts test/routes/admin-alerts.test.ts test/routes/public.test.ts
git commit -m "feat: admin alert injection and the public per-user page route"
```

---

### Task 11: Admin console user-management routes

**Files:**
- Modify: `worker/routes/admin.ts`
- Test: `test/routes/admin-users.test.ts`

**Interfaces:**
- Consumes: `listUsersWithRoles`, `updateUserAdminFields`, `setUserActive` (Task 5); `getUserByEmail`, `getUserById`, `getRoleById`, `createUser`, `deleteSessionsForUser` (existing); `hashPassword` (existing); `isValidEmail`, `toPublicUser` (existing).
- Produces: no new exports — extends `adminRoutes` (Task 10) with the remaining admin-console endpoints.

- [ ] **Step 1: Write the failing tests**

```ts
// test/routes/admin-users.test.ts
import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getAdminRoleId } from '../helpers';

function req(method: string, path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

describe('admin console permission gate', () => {
  it('returns 403 on every /api/admin/* route for a caller without manage_users', async () => {
    const plainCookie = await createUserWithRoleAndLogin('admin-gate-plain@example.com', 2, 'Plain');
    expect((await req('GET', '/api/admin/users', undefined, plainCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users', { email: 'x@example.com', password: 'password123', display_name: 'X', role_id: 2 }, plainCookie)).status).toBe(403);
    expect((await req('PUT', '/api/admin/users/2', { display_name: 'Y' }, plainCookie)).status).toBe(403);
    expect((await req('POST', '/api/admin/users/2/deactivate', undefined, plainCookie)).status).toBe(403);
  });
});

describe('GET /api/admin/users', () => {
  it('lists users with role names and never leaks password fields', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-list@example.com', adminRoleId, 'Admin List');
    const res = await req('GET', '/api/admin/users', undefined, adminCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    const found = body.users.find((u: { email: string }) => u.email === 'admin-list@example.com');
    expect(found.role_name).toBe('admin');
    expect(found.password_hash).toBeUndefined();
    expect(found.password_salt).toBeUndefined();
  });
});

describe('POST /api/admin/users', () => {
  it('creates a user with an admin-chosen role and initial password', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-creator@example.com', adminRoleId, 'Admin Creator');
    const res = await req('POST', '/api/admin/users', {
      email: 'admin-created@example.com', password: 'initialpass123', display_name: 'Admin Created', role_id: 2,
    }, adminCookie);
    expect(res.status).toBe(201);

    const loginRes = await req('POST', '/api/auth/login', { email: 'admin-created@example.com', password: 'initialpass123' });
    expect(loginRes.status).toBe(200);
  });

  it('rejects a duplicate email with 409', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-dup@example.com', adminRoleId, 'Admin Dup');
    const res = await req('POST', '/api/admin/users', {
      email: 'admin-dup@example.com', password: 'password123', display_name: 'Dup', role_id: 2,
    }, adminCookie);
    expect(res.status).toBe(409);
  });
});

describe('PUT /api/admin/users/:id', () => {
  it('updates display_name, email, and role_id for a non-superadmin target', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-editor@example.com', adminRoleId, 'Admin Editor');
    const targetCookie = await createUserWithRoleAndLogin('admin-edit-target@example.com', 2, 'Edit Target');
    const targetMe = await (await req('GET', '/api/auth/me', undefined, targetCookie)).json();

    const res = await req('PUT', `/api/admin/users/${targetMe.user.id}`, { display_name: 'Renamed', role_id: adminRoleId }, adminCookie);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.user.display_name).toBe('Renamed');
    expect(body.user.role_name).toBe('admin');
  });

  it('rejects changing user id 1\'s role_id with 400', async () => {
    // The very first user ever registered in this test's isolated DB becomes id 1/superadmin.
    const superadminCookie = await createUserWithRoleAndLogin('will-be-id-1@example.com', 1, 'Superadmin');
    const res = await req('PUT', '/api/admin/users/1', { role_id: 2 }, superadminCookie);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/admin/users/:id/deactivate and /reactivate', () => {
  it('deactivates a user, killing their sessions, then reactivates them', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('admin-deactivator@example.com', adminRoleId, 'Deactivator');
    const targetCookie = await createUserWithRoleAndLogin('deactivate-target@example.com', 2, 'Deactivate Target');
    const targetMe = await (await req('GET', '/api/auth/me', undefined, targetCookie)).json();
    const targetId = targetMe.user.id;

    const deactivateRes = await req('POST', `/api/admin/users/${targetId}/deactivate`, undefined, adminCookie);
    expect(deactivateRes.status).toBe(200);

    const meAfterDeactivate = await req('GET', '/api/auth/me', undefined, targetCookie);
    expect(meAfterDeactivate.status).toBe(401);

    const publicPageRes = await SELF.fetch(`https://example.com/api/users/${targetId}/public`);
    expect(publicPageRes.status).toBe(404);

    const reactivateRes = await req('POST', `/api/admin/users/${targetId}/reactivate`, undefined, adminCookie);
    expect(reactivateRes.status).toBe(200);

    const loginAfterReactivate = await req('POST', '/api/auth/login', { email: 'deactivate-target@example.com', password: 'password123' });
    expect(loginAfterReactivate.status).toBe(200);
  });

  it('rejects deactivating user id 1 with 400', async () => {
    const superadminCookie = await createUserWithRoleAndLogin('will-be-id-1-b@example.com', 1, 'Superadmin B');
    const res = await req('POST', '/api/admin/users/1/deactivate', undefined, superadminCookie);
    expect(res.status).toBe(400);
  });
});
```

Note: `createUserWithRoleAndLogin` from `test/helpers.ts` logs in with the fixed password `TEST_PASSWORD` ('password123') — the "deactivate-target" test's final login re-check relies on that fixed password, matching what the helper actually registered.

- [ ] **Step 2: Run to verify they fail**

```bash
yarn test admin-users.test.ts
```

Expected: FAIL — none of these routes exist yet on `adminRoutes` (404, except the permission-gate test which will 404 rather than 403 since the routes aren't registered — that's expected pre-implementation).

- [ ] **Step 3: Extend `worker/routes/admin.ts`**

Add these imports alongside the existing ones at the top of the file:

```ts
import { listUsersWithRoles, updateUserAdminFields, setUserActive, getUserByEmail, getUserById, getRoleById, createUser, deleteSessionsForUser } from '../db';
import { hashPassword } from '../crypto';
import { isValidEmail, toPublicUser } from '../util';
```

(merge `getUserById`/`getRoleById`/`createUser`/`deleteSessionsForUser` into this new import line — they weren't previously imported in this file; `createAlert`/`DbAlert` from the existing `../db` import stay as they are.)

Append:

```ts
adminRoutes.get('/users', async (c) => {
  const users = await listUsersWithRoles(c.env.DB);
  return c.json({
    users: users.map((u) => ({
      id: u.id,
      email: u.email,
      display_name: u.display_name,
      avatar_key: u.avatar_key,
      role_id: u.role_id,
      role_name: u.role_name,
      is_active: u.is_active,
      created_at: u.created_at,
    })),
  });
});

adminRoutes.post('/users', async (c) => {
  const body = await c.req.json().catch(() => null);
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : '';
  const roleId = typeof body?.role_id === 'number' ? body.role_id : NaN;

  if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
  if (password.length < 8) return c.json({ error: 'weak_password' }, 400);
  if (!displayName) return c.json({ error: 'missing_display_name' }, 400);
  const role = Number.isInteger(roleId) ? await getRoleById(c.env.DB, roleId) : null;
  if (!role) return c.json({ error: 'invalid_role' }, 400);

  if (await getUserByEmail(c.env.DB, email)) return c.json({ error: 'email_taken' }, 409);

  const { hash, salt } = await hashPassword(password);
  let user;
  try {
    user = await createUser(c.env.DB, { email, passwordHash: hash, passwordSalt: salt, roleId, displayName });
  } catch (err) {
    if (err instanceof Error && err.message.includes('UNIQUE')) return c.json({ error: 'email_taken' }, 409);
    throw err;
  }
  return c.json({ user: toPublicUser(user, role) }, 201);
});

adminRoutes.put('/users/:id', async (c) => {
  const targetId = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const displayName = typeof body?.display_name === 'string' ? body.display_name.trim() : undefined;
  const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : undefined;
  const roleId = typeof body?.role_id === 'number' ? body.role_id : undefined;

  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  if (roleId !== undefined && targetId === 1) {
    return c.json({ error: 'cannot_change_superadmin_role' }, 400);
  }
  const newRole = roleId !== undefined ? await getRoleById(c.env.DB, roleId) : null;
  if (roleId !== undefined && !newRole) return c.json({ error: 'invalid_role' }, 400);

  if (email !== undefined) {
    if (!isValidEmail(email)) return c.json({ error: 'invalid_email' }, 400);
    const existing = await getUserByEmail(c.env.DB, email);
    if (existing && existing.id !== targetId) return c.json({ error: 'email_taken' }, 409);
  }

  const updated = await updateUserAdminFields(c.env.DB, targetId, { displayName, email, roleId });
  const role = await getRoleById(c.env.DB, updated.role_id);
  return c.json({ user: toPublicUser(updated, role!) });
});

adminRoutes.post('/users/:id/deactivate', async (c) => {
  const targetId = Number(c.req.param('id'));
  if (targetId === 1) return c.json({ error: 'cannot_deactivate_superadmin' }, 400);

  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  await setUserActive(c.env.DB, targetId, false);
  await deleteSessionsForUser(c.env.DB, targetId);
  return c.json({ ok: true });
});

adminRoutes.post('/users/:id/reactivate', async (c) => {
  const targetId = Number(c.req.param('id'));
  const target = await getUserById(c.env.DB, targetId);
  if (!target) return c.json({ error: 'not_found' }, 404);

  await setUserActive(c.env.DB, targetId, true);
  return c.json({ ok: true });
});
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
yarn test admin-users.test.ts
```

Expected: PASS (9 tests).

- [ ] **Step 5: Run the full suite**

```bash
yarn test
```

Expected: all tests PASS.

- [ ] **Step 6: Commit**

```bash
git add worker/routes/admin.ts test/routes/admin-users.test.ts
git commit -m "feat: admin console user-management routes (list/create/edit/deactivate/reactivate)"
```

---

### Task 12: `apiFetch` FormData fix, CKEditor5 setup, shared `AlertEditor` component

**Files:**
- Modify: `src/lib/api.ts`
- Create: `src/components/AlertEditor.tsx`

**Interfaces:**
- Modifies: `apiFetch` — no signature change, but callers may now pass a `FormData` body (used by Task 13's avatar upload) without it being corrupted by a forced JSON content-type.
- Produces: `AlertEditor` component — `{ initial?: AlertFormValues; submitLabel: string; onSubmit: (values: AlertFormValues) => Promise<void> }`, and the exported `AlertFormValues` type (`{ type: 'info'|'success'|'warning'|'danger'; visibility: 'dashboard'|'public'|'both'; body_html: string }`) — used by Task 13 (Dashboard) and Task 15 (AdminConsole).

- [ ] **Step 1: Fix `apiFetch` in `src/lib/api.ts`**

Current code forces `Content-Type: application/json` on every request. A multipart avatar upload (Task 13) needs to pass a `FormData` body, and `fetch` sets its own correct `multipart/form-data; boundary=...` content type automatically when given a `FormData` body — a manually-set `application/json` header on top of that breaks the server's multipart parsing. Update the function:

```ts
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const isFormData = init?.body instanceof FormData;
  const res = await fetch(`/api${path}`, {
    credentials: 'include',
    ...init,
    headers: isFormData
      ? { ...(init?.headers ?? {}) }
      : { 'Content-Type': 'application/json', ...(init?.headers ?? {}) },
  });

  if (res.status === 204) return undefined as T;

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiError(res.status, body.error ?? 'unknown_error');
  }
  return body as T;
}
```

(Only the `headers:` line changes — everything else in the file, including the `ApiError` class above it, stays exactly as-is.)

- [ ] **Step 2: Install CKEditor 5**

```bash
yarn add ckeditor5 @ckeditor/ckeditor5-react
```

Before writing the component, check the actually-installed package's real API surface rather than assuming — this project has twice already hit a plan/brief referencing an API that didn't match the installed package version (Foundation's Tasks 1 and 9). Specifically confirm:
- The unified `ckeditor5` package's export names for `ClassicEditor` and the plugins listed below (`Essentials`, `Paragraph`, `Bold`, `Italic`, `Link`, `List`) — check `node_modules/ckeditor5/package.json`'s version and skim its type definitions (`node_modules/ckeditor5/dist/**/*.d.ts` or similar) for the actual exported names.
- Whether a CSS import path like `ckeditor5/ckeditor5.css` exists in the installed version, or whether the current version's stylesheet lives at a different path.
- The `@ckeditor/ckeditor5-react` `<CKEditor>` component's actual prop names (`editor`, `data`, `config`, `onChange` are stable across recent versions, but confirm the `onChange` callback signature — `(event, editor)` — against the installed version's types).

If any of these differ from what Step 3 below assumes, adapt the implementation to the real API and note the deviation in your report — the intent (a `ClassicEditor` with a GPL license key and a toolbar restricted to bold/italic/link/lists) is what matters, not this step's exact import paths.

- [ ] **Step 3: Write `src/components/AlertEditor.tsx`**

```tsx
import { useState, type FormEvent } from 'react';
import { CKEditor } from '@ckeditor/ckeditor5-react';
import { ClassicEditor, Essentials, Paragraph, Bold, Italic, Link, List } from 'ckeditor5';
import 'ckeditor5/ckeditor5.css';

export interface AlertFormValues {
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: 'dashboard' | 'public' | 'both';
  body_html: string;
}

export default function AlertEditor({
  initial,
  submitLabel,
  onSubmit,
}: {
  initial?: AlertFormValues;
  submitLabel: string;
  onSubmit: (values: AlertFormValues) => Promise<void>;
}) {
  const [type, setType] = useState<AlertFormValues['type']>(initial?.type ?? 'info');
  const [visibility, setVisibility] = useState<AlertFormValues['visibility']>(initial?.visibility ?? 'public');
  const [bodyHtml, setBodyHtml] = useState(initial?.body_html ?? '');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onSubmit({ type, visibility, body_html: bodyHtml });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <label>
        Type
        <select value={type} onChange={(e) => setType(e.target.value as AlertFormValues['type'])}>
          <option value="info">Info</option>
          <option value="success">Success</option>
          <option value="warning">Warning</option>
          <option value="danger">Danger</option>
        </select>
      </label>
      <label>
        Visibility
        <select value={visibility} onChange={(e) => setVisibility(e.target.value as AlertFormValues['visibility'])}>
          <option value="dashboard">Dashboard only</option>
          <option value="public">Public only</option>
          <option value="both">Both</option>
        </select>
      </label>
      <CKEditor
        editor={ClassicEditor}
        data={bodyHtml}
        config={{
          licenseKey: 'GPL',
          plugins: [Essentials, Paragraph, Bold, Italic, Link, List],
          toolbar: ['bold', 'italic', 'link', 'bulletedList', 'numberedList'],
        }}
        onChange={(_event, editor) => setBodyHtml(editor.getData())}
      />
      <button type="submit" disabled={submitting}>{submitLabel}</button>
    </form>
  );
}
```

- [ ] **Step 4: Manually verify the editor renders**

There's no automated test for this component in isolation (it has no logic worth unit-testing beyond what Task 13/15's page-level manual verification already covers). Confirm it at least compiles and renders without a runtime error:

```bash
yarn build
```

Expected: 0 type errors. (`yarn build` now type-checks `worker/**`/`test/**` too, per Foundation's Task-2-of-the-final-review-fix-wave — if this task introduces any type error there, it will show up here.) Full in-browser verification of `AlertEditor` happens in Task 13, once it's actually rendered on the Dashboard page.

- [ ] **Step 5: Commit**

```bash
git add src/lib/api.ts src/components/AlertEditor.tsx package.json yarn.lock
git commit -m "fix: apiFetch supports FormData bodies; add shared AlertEditor (CKEditor5) component"
```

---

### Task 13: Dashboard page (profile edit, avatar upload, own alerts)

**Files:**
- Create: `src/pages/Dashboard.tsx`
- Delete: `src/pages/AuthedHome.tsx` (replaced — Foundation's own placeholder said as much: "Dashboard, profile editing, and alerts are built in the next sub-project.")
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `AuthUser` (now including `avatar_key`, Task 3), `apiFetch`, `ApiError` (`src/lib/api.ts`), `AlertEditor`, `AlertFormValues` (Task 12).
- Produces: `Dashboard` component rendered at `/` for an authenticated user, replacing `AuthedHome`.

- [ ] **Step 1: Write `src/pages/Dashboard.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import type { AuthUser } from '../lib/useCurrentUser';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';

interface Alert {
  id: number;
  type: AlertFormValues['type'];
  visibility: AlertFormValues['visibility'];
  body_html: string;
}

export default function Dashboard({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  return (
    <div>
      <h1>Welcome, {user.display_name}</h1>
      <p>Role: {user.role_name}</p>
      <LogoutButton refresh={refresh} />
      <AvatarSection user={user} refresh={refresh} />
      <ProfileForm user={user} refresh={refresh} />
      <PasswordForm />
      <AlertsPanel />
    </div>
  );
}

function LogoutButton({ refresh }: { refresh: () => Promise<void> }) {
  async function handleLogout() {
    try {
      await apiFetch('/auth/logout', { method: 'POST' });
    } catch (err) {
      console.error('Logout request failed', err);
    }
    await refresh();
  }
  return <button onClick={handleLogout}>Log out</button>;
}

function AvatarSection({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError(null);
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      await apiFetch('/profile/avatar', { method: 'POST', body: formData });
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    } finally {
      setUploading(false);
    }
  }

  return (
    <section>
      <h2>Avatar</h2>
      {user.avatar_key && <img src={`/api/avatars/${user.avatar_key}`} alt="Your avatar" width={96} height={96} />}
      <input type="file" accept="image/jpeg,image/png,image/webp" onChange={handleFileChange} disabled={uploading} />
      {error && <p role="alert">{error}</p>}
    </section>
  );
}

function ProfileForm({ user, refresh }: { user: AuthUser; refresh: () => Promise<void> }) {
  const [displayName, setDisplayName] = useState(user.display_name);
  const [email, setEmail] = useState(user.email);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/profile', { method: 'PUT', body: JSON.stringify({ display_name: displayName, email }) });
      await refresh();
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section>
      <h2>Profile</h2>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p>Saved.</p>}
        <label>
          Display name
          <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <button type="submit">Save profile</button>
      </form>
    </section>
  );
}

function PasswordForm() {
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);
    try {
      await apiFetch('/profile/password', {
        method: 'PUT',
        body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
      });
      setCurrentPassword('');
      setNewPassword('');
      setSaved(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <section>
      <h2>Change password</h2>
      <form onSubmit={handleSubmit}>
        {error && <p role="alert">{error}</p>}
        {saved && <p>Password changed.</p>}
        <label>
          Current password
          <input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
        </label>
        <label>
          New password
          <input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={8} />
        </label>
        <button type="submit">Change password</button>
      </form>
    </section>
  );
}

function AlertsPanel() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAlerts() {
    try {
      const body = await apiFetch<{ alerts: Alert[] }>('/alerts');
      setAlerts(body.alerts);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    void loadAlerts();
  }, []);

  async function handleCreate(values: AlertFormValues) {
    await apiFetch('/alerts', { method: 'POST', body: JSON.stringify(values) });
    await loadAlerts();
  }

  async function handleUpdate(id: number, values: AlertFormValues) {
    await apiFetch(`/alerts/${id}`, { method: 'PUT', body: JSON.stringify(values) });
    setEditingId(null);
    await loadAlerts();
  }

  async function handleDelete(id: number) {
    await apiFetch(`/alerts/${id}`, { method: 'DELETE' });
    await loadAlerts();
  }

  return (
    <section>
      <h2>Alerts</h2>
      {error && <p role="alert">{error}</p>}
      <h3>New alert</h3>
      <AlertEditor submitLabel="Create alert" onSubmit={handleCreate} />
      <h3>Your alerts</h3>
      <ul>
        {alerts.map((alert) => (
          <li key={alert.id}>
            {editingId === alert.id ? (
              <AlertEditor
                initial={{ type: alert.type, visibility: alert.visibility, body_html: alert.body_html }}
                submitLabel="Save"
                onSubmit={(values) => handleUpdate(alert.id, values)}
              />
            ) : (
              <>
                <span>[{alert.type}/{alert.visibility}]</span>
                <span dangerouslySetInnerHTML={{ __html: alert.body_html }} />
                <button onClick={() => setEditingId(alert.id)}>Edit</button>
                <button onClick={() => handleDelete(alert.id)}>Delete</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 2: Delete `src/pages/AuthedHome.tsx`**

```bash
rm src/pages/AuthedHome.tsx
```

- [ ] **Step 3: Update `src/App.tsx`**

Replace the `AuthedHome` import and its one usage:

```tsx
import Dashboard from './pages/Dashboard'
```

(replaces `import AuthedHome from './pages/AuthedHome'`), and:

```tsx
<Route
  path="/"
  element={user ? <Dashboard user={user} refresh={refresh} /> : <Navigate to="/login" replace />}
/>
```

(replaces the `AuthedHome` route element — same route, same guard logic, only the rendered component and its props change: `refresh` instead of `onLoggedOut`, matching `Dashboard`'s prop name).

- [ ] **Step 4: Build and manually verify in a browser**

```bash
yarn build
npx wrangler dev
```

Walk through at `http://localhost:8787`:
1. Register or log in → land on the Dashboard, see "Welcome, <name>" and the profile/avatar/password/alerts sections.
2. Upload a JPEG/PNG avatar → it renders in the avatar preview after upload.
3. Change display name and/or email → reload the page (or note the header text updates without reload) → confirm the change persisted (e.g. log out and back in, or check `/api/profile` directly).
4. Change password → log out → log back in with the new password.
5. Create an alert (try bold/italic/link/list formatting in the CKEditor toolbar) → it appears in "Your alerts" with the formatting preserved.
6. Edit that alert → confirm the change is reflected in the list.
7. Delete it → confirm it disappears from the list.

- [ ] **Step 5: Run the full test suite**

```bash
yarn test
```

Expected: all backend tests still PASS (this task touches no `worker/**` files).

- [ ] **Step 6: Commit**

```bash
git add src/pages/Dashboard.tsx src/App.tsx
git rm src/pages/AuthedHome.tsx
git commit -m "feat: Dashboard page with profile edit, avatar upload, and alerts panel"
```

---

### Task 14: Public per-user page

**Files:**
- Create: `src/pages/UserPage.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (`src/lib/api.ts`).
- Produces: `UserPage` component rendered at `/users/:id`, public, no auth guard.

- [ ] **Step 1: Write `src/pages/UserPage.tsx`**

```tsx
import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';

interface PublicAlert {
  id: number;
  type: 'info' | 'success' | 'warning' | 'danger';
  visibility: string;
  body_html: string;
}

interface PublicProfile {
  display_name: string;
  avatar_key: string | null;
  alerts: PublicAlert[];
}

export default function UserPage() {
  const { id } = useParams();
  const [profile, setProfile] = useState<PublicProfile | null>(null);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const body = await apiFetch<PublicProfile>(`/users/${id}/public`);
        if (!cancelled) setProfile(body);
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
        } else {
          console.error('Failed to load public profile', err);
        }
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (notFound) return <p>User not found.</p>;
  if (!profile) return <p>Loading…</p>;

  return (
    <div>
      {profile.avatar_key && (
        <img src={`/api/avatars/${profile.avatar_key}`} alt={profile.display_name} width={96} height={96} />
      )}
      <h1>{profile.display_name}</h1>
      {profile.alerts.map((alert) => (
        <div
          key={alert.id}
          className={`alert alert-${alert.type}`}
          dangerouslySetInnerHTML={{ __html: alert.body_html }}
        />
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Add the route in `src/App.tsx`**

Add the import:

```tsx
import UserPage from './pages/UserPage'
```

Add the route (public, no guard — alongside the existing `/forgot-password`/`/reset-password` routes):

```tsx
<Route path="/users/:id" element={<UserPage />} />
```

- [ ] **Step 3: Build and manually verify**

```bash
yarn build
npx wrangler dev
```

Log in, create an alert with `visibility: public` from the Dashboard, note your own user id (e.g. via `/api/auth/me` in the browser or dev tools), then visit `http://localhost:8787/users/<your-id>` in a new private/incognito tab (logged out) — confirm the display name, avatar (if set), and the public alert render without needing to be logged in. Visit `/users/999999` and confirm "User not found." renders instead of a crash.

- [ ] **Step 4: Commit**

```bash
git add src/pages/UserPage.tsx src/App.tsx
git commit -m "feat: public per-user page"
```

---

### Task 15: Admin console page

**Files:**
- Create: `src/pages/AdminConsole.tsx`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` (`src/lib/api.ts`); `AlertEditor`, `AlertFormValues` (Task 12); `AuthUser` (for the route guard in `App.tsx`).
- Produces: `AdminConsole` component rendered at `/admin`, guarded so only a user with `manage_users` (or `*`) can reach it.

- [ ] **Step 1: Write `src/pages/AdminConsole.tsx`**

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../lib/api';
import AlertEditor, { type AlertFormValues } from '../components/AlertEditor';

interface AdminUser {
  id: number;
  email: string;
  display_name: string;
  avatar_key: string | null;
  role_id: number;
  role_name: string;
  is_active: number;
  created_at: string;
}

export default function AdminConsole() {
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [alertTargetId, setAlertTargetId] = useState<number | null>(null);

  async function loadUsers() {
    try {
      const body = await apiFetch<{ users: AdminUser[] }>('/admin/users');
      setUsers(body.users);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    void loadUsers();
  }, []);

  async function handleDeactivate(id: number) {
    await apiFetch(`/admin/users/${id}/deactivate`, { method: 'POST' });
    await loadUsers();
  }

  async function handleReactivate(id: number) {
    await apiFetch(`/admin/users/${id}/reactivate`, { method: 'POST' });
    await loadUsers();
  }

  async function handleInjectAlert(values: AlertFormValues) {
    if (alertTargetId === null) return;
    await apiFetch(`/admin/users/${alertTargetId}/alerts`, { method: 'POST', body: JSON.stringify(values) });
    setAlertTargetId(null);
  }

  return (
    <div>
      <h1>Admin console</h1>
      {error && <p role="alert">{error}</p>}
      <CreateUserForm onCreated={loadUsers} />
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Display name</th>
            <th>Role</th>
            <th>Active</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.id}>
              <td>{u.email}</td>
              <td>{u.display_name}</td>
              <td>{u.role_name}</td>
              <td>{u.is_active ? 'yes' : 'no'}</td>
              <td>
                {u.is_active ? (
                  <button onClick={() => handleDeactivate(u.id)} disabled={u.id === 1}>
                    Deactivate
                  </button>
                ) : (
                  <button onClick={() => handleReactivate(u.id)}>Reactivate</button>
                )}
                <button onClick={() => setAlertTargetId(u.id)}>Inject alert</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {alertTargetId !== null && (
        <div>
          <h2>Inject alert for user {alertTargetId}</h2>
          <AlertEditor submitLabel="Send alert" onSubmit={handleInjectAlert} />
          <button onClick={() => setAlertTargetId(null)}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function CreateUserForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [roleId, setRoleId] = useState(2);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await apiFetch('/admin/users', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name: displayName, role_id: roleId }),
      });
      setEmail('');
      setPassword('');
      setDisplayName('');
      await onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <h2>Create user</h2>
      {error && <p role="alert">{error}</p>}
      <label>
        Email
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
      </label>
      <label>
        Password
        <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} />
      </label>
      <label>
        Display name
        <input value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
      </label>
      <label>
        Role ID
        <input type="number" value={roleId} onChange={(e) => setRoleId(Number(e.target.value))} required />
      </label>
      <button type="submit">Create</button>
    </form>
  );
}
```

Note on the raw numeric "Role ID" input: there's no "list roles" API in this plan's scope (the spec explicitly defers role-management UI — the admin console "assigns from existing roles only," and doesn't call for a roles-listing endpoint either). A numeric input is a pragmatic placeholder for choosing among the two roles that exist by default (`1` superadmin, `2` user, `3` admin per the migration order) — this is a known, deliberately in-scope simplification, not a deviation to flag.

- [ ] **Step 2: Add the guarded route in `src/App.tsx`**

Add the import:

```tsx
import AdminConsole from './pages/AdminConsole'
```

Add the route, gated on the current user's permissions (redirect to `/` if not permitted — same pattern as the existing `/login`/`/register` guards):

```tsx
<Route
  path="/admin"
  element={
    user && (user.permissions.includes('*') || user.permissions.includes('manage_users'))
      ? <AdminConsole />
      : <Navigate to="/" replace />
  }
/>
```

- [ ] **Step 3: Build and manually verify**

```bash
yarn build
npx wrangler dev
```

1. Log in as the first-ever registered user (superadmin) → navigate to `/admin` → confirm the console loads and lists all users.
2. Create a new user via the form → confirm it appears in the list and can log in with the password you set.
3. Deactivate a non-superadmin user → confirm their row shows inactive and a "Reactivate" button; confirm the superadmin's own row's "Deactivate" button is disabled.
4. Reactivate that user → confirm they can log in again.
5. Click "Inject alert" for a user, submit one with `visibility: public` → log in as that user (or visit their `/users/:id` public page) → confirm the injected alert appears.
6. Log in as a plain (non-`manage_users`) user and navigate to `/admin` directly → confirm you're redirected to `/`.

- [ ] **Step 4: Commit**

```bash
git add src/pages/AdminConsole.tsx src/App.tsx
git commit -m "feat: admin console page (user management, alert injection)"
```

---

## Self-Review Notes

- **Spec coverage:** every route in the spec (profile GET/PUT, password change, avatar upload/serve, self alert CRUD, admin alert injection, public user page, admin user list/create/edit/deactivate/reactivate) has a task with tests. `is_active` gating in `loadSession`, the sanitizer's exact allowlist, and the id-1 protections (role-change rejected, deactivate rejected) are all covered.
- **A gap caught during planning, not left for implementation to discover:** `AuthUser`/`toPublicUser` never carried `avatar_key` in Foundation, but Task 13's Dashboard needs it for the avatar preview — fixed by extending Task 3 (which already touches profile-related DB helpers) rather than leaving Task 13 to patch it in ad hoc.
- **Type consistency checked:** `AlertFormValues`'s `type`/`visibility` union types match `DbAlert`'s exactly (both defined against the same three-value/four-value sets); `AdminUser`'s frontend shape matches the exact fields `GET /api/admin/users`' handler returns (no password fields on either side); `PublicProfile`'s shape matches `GET /api/users/:id/public`'s response exactly.
- **Deferred, per the spec's own "Explicitly deferred" section:** role-management UI (creating/editing roles, only assigning existing ones), real email delivery, and the homepage user list (sub-project 3, which will link to `/users/:id` built here).
- **New environment-verification risk flagged proactively:** Task 12 explicitly tells the implementer to check CKEditor 5's actual installed API before trusting this plan's exact import paths/prop names, following the same lesson learned twice during Foundation (vitest-pool-workers' and wrangler's assets config both once referenced APIs that didn't match the installed version).
