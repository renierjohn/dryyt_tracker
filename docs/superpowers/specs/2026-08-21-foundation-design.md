# Foundation — Design Spec

Sub-project 1 of 3 (Foundation → Profile & Dashboard → Listings). Scope: Cloudflare
Worker scaffold, D1 schema + migrations, and the full auth core (register, login,
logout, forgot/reset password, roles, superadmin). Dashboard UI, profile edit, R2
avatar upload, and the homepage/users listing pages are explicitly out of scope —
they are later sub-projects that build on this one.

## Decisions (confirmed with user)

- **Deploy topology**: single Cloudflare Worker serves both the API and the built
  React app via Workers static assets. No separate Pages project.
- **Framework**: Hono for routing/middleware inside the Worker.
- **Sessions**: opaque random token in a `sessions` D1 table, set as an
  HttpOnly/Secure/SameSite=Lax cookie. Revocable server-side (delete the row).
  Not JWT — no blocklist complexity needed for this scale.
- **Roles**: a `roles` table with a `permissions` column holding a JSON array of
  permission strings. Users reference `role_id`. No separate `role_permissions`
  join table — YAGNI for the current scale.
- **Superadmin**: user **id 1** is superadmin unconditionally, checked by id, not
  by role assignment. This means id 1 can never be locked out by editing role
  data. `role_id` on user 1 is still `1` (`superadmin` role) for display/consistency,
  but every permission check special-cases `user.id === 1` to short-circuit true.
- **Password reset delivery**: no email service exists yet. `forgot-password`
  generates a token and returns the reset link directly in the JSON response
  (and logs it). Wiring real email (Cloudflare Email Service) is an explicit
  future follow-up, not part of this sub-project.
- **Password hashing**: PBKDF2 via Web Crypto `SubtleCrypto`, no dependency.
  100,000 iterations, SHA-256, random 16-byte salt per user, stored as
  base64 in `password_salt` / `password_hash`.
- **Migration tracking**: use wrangler's built-in D1 migrations
  (`wrangler d1 migrations create/apply`, `migrations/*.sql`, wrangler's own
  `d1_migrations` bookkeeping table). No custom migrations UI/table — the user
  chose to rely on wrangler's mechanism rather than build a bespoke tracker.

## Architecture

```
dryyt_tracker/
├── wrangler.jsonc              # DB (D1) binding; BUCKET (R2) added in sub-project 2
├── migrations/
│   └── 0001_init.sql
├── src/                        # React frontend (Vite)
│   ├── pages/
│   │   ├── Login.tsx
│   │   ├── Register.tsx
│   │   ├── ForgotPassword.tsx
│   │   ├── ResetPassword.tsx
│   │   └── AuthedHome.tsx      # placeholder; replaced by real dashboard later
│   ├── lib/api.ts               # fetch wrapper, credentials: 'include'
│   └── ...(existing App.tsx/main.tsx wiring, router)
├── worker/
│   ├── index.ts                 # Hono app entry, exports default fetch handler
│   ├── db.ts                    # typed D1 query helpers
│   ├── crypto.ts                # PBKDF2 hash/verify helpers
│   ├── middleware/auth.ts        # session-loading + requireAuth + requirePermission
│   └── routes/auth.ts            # register/login/logout/forgot/reset handlers
└── test/
    └── auth.test.ts              # vitest-pool-workers
```

The Worker is the `main` entry in `wrangler.jsonc`; static assets config points at
the Vite `dist/` output so one `wrangler deploy` ships both.

## Data model

`migrations/0001_init.sql`:

```sql
CREATE TABLE roles (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  permissions TEXT NOT NULL DEFAULT '[]', -- JSON array of permission strings
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE users (
  id INTEGER PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  role_id INTEGER NOT NULL REFERENCES roles(id),
  display_name TEXT NOT NULL,
  avatar_key TEXT,               -- R2 object key, populated in sub-project 2
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

Bootstrapping user id 1: on first `register` call against an empty `users` table,
the handler assigns `role_id = 1` (superadmin) and lets SQLite autoincrement give
it id 1. Every subsequent registration gets `role_id = 2` (`user`). This avoids a
separate seed script while guaranteeing id 1 is the first real account created.

## API routes

All under `/api/auth/*`. JSON in, JSON out. Errors: `{ "error": string }` with an
appropriate 4xx/5xx status — 400 validation, 401 auth failure, 403 permission
denied, 409 conflict (duplicate email), 500 unexpected.

- `POST /api/auth/register` `{ email, password, display_name }` → 201
  `{ user: { id, email, display_name, role } }`, sets session cookie.
  400 if email malformed/password too short (min 8 chars). 409 if email taken.
- `POST /api/auth/login` `{ email, password }` → 200 `{ user }`, sets cookie.
  401 on bad credentials (generic message, no user-enumeration hint).
- `POST /api/auth/logout` → 204, deletes session row, clears cookie.
- `GET /api/auth/me` → 200 `{ user }` or 401 if not authenticated.
- `POST /api/auth/forgot-password` `{ email }` → 200 always (no enumeration),
  `{ resetLink }` included in the response **only in this dev-mode stand-in**
  (also `console.log`'d) when the email exists; omitted otherwise.
- `POST /api/auth/reset-password` `{ token, password }` → 200, invalidates the
  reset token and all existing sessions for that user. 400 if token
  expired/unknown.

## Auth middleware

`worker/middleware/auth.ts` exports:
- `loadSession` — reads the cookie, looks up the session + joins user + role,
  attaches `c.set('user', ...)` with `permissions: string[]` resolved from the
  role's JSON column (empty array if none/expired/missing cookie).
- `requireAuth` — 401 if no user on context.
- `requirePermission(perm)` — passes if `user.id === 1` (superadmin escape
  hatch) or `permissions.includes(perm)` or `permissions.includes('*')`;
  otherwise 403.

## Error handling

- Input validation with a small manual check per field (no schema library
  dependency needed for this few fields) — keeps the Foundation sub-project
  dependency-light.
- All thrown errors caught by a top-level Hono `onError` handler that logs and
  returns a generic 500 `{ error: "internal_error" }` for anything unexpected,
  never leaking stack traces to the client.
- Session cookie: `HttpOnly; Secure; SameSite=Lax; Path=/`. `Secure` is skipped
  automatically when running under `wrangler dev` on plain HTTP (Hono's cookie
  helper handles this) — no manual environment branching needed.

## Testing

`@cloudflare/vitest-pool-workers` against the real Worker + local D1 binding
(`wrangler.jsonc` migrations applied to the test DB via pool config):
- register: success, duplicate email, weak password
- login: success, wrong password, unknown email
- me: authenticated vs not
- forgot/reset: valid flow, expired token, reused token
- permission gate: id-1 superadmin bypass, role without permission → 403,
  role with permission → 200

## Explicitly deferred

- Dashboard UI, profile edit page, R2 avatar upload → sub-project 2
- Homepage user list, admin Users page, "customizable out of the box" listing
  behavior → sub-project 3
- Real email delivery for password reset (Cloudflare Email Service) → future
  follow-up, not blocking Foundation
