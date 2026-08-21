# Profile, Dashboard, Alerts & Admin Console — Design Spec

Sub-project 2 of 3 (Foundation → **this** → Listings). Depends on Foundation
(auth, sessions, roles/permissions, `users` table). Builds: profile edit, R2
avatar upload, an alerts system (self-authored and admin-injected), a public
per-user page, and an admin console for managing users. Sub-project 3
(Listings) narrows to just the public homepage user list, which links to the
`/users/:id` page built here.

## Decisions (confirmed with user)

- **Avatar upload**: direct upload through the Worker — browser POSTs
  multipart form data to `/api/profile/avatar`; Worker validates and PUTs to
  R2 directly. No presigned URLs (unneeded complexity for small avatar files).
- **Avatar serving**: Worker proxy route `GET /api/avatars/:key` streams the
  object from the R2 binding with cache headers. No public-bucket config,
  works the same in local dev and prod.
- **Avatar limits**: 5MB max, `image/jpeg` / `image/png` / `image/webp` only.
  Worker checks the actual magic bytes of the uploaded content, not just the
  declared `Content-Type` header, before accepting it.
- **Alert visibility**: self-authored and admin-injected alerts share one
  `alerts` table with a `visibility` column (`dashboard` | `public` | `both`).
  Self-authored alerts default to `public`. Owner can edit/delete their own
  alerts; anyone with `manage_users` (or superadmin) can edit/delete any
  alert, including injecting one onto another user's page.
- **Admin gating**: permission-based (`manage_users` string in a role's
  `permissions` JSON), not hardcoded to user id 1. Superadmin (id 1) always
  passes via the existing `permissions.includes('*')` / id-1 escape hatch from
  Foundation. This lets a custom role be granted admin-console access without
  being superadmin.
- **User deletion**: soft delete. `users.is_active` flag; deactivating a user
  immediately invalidates their sessions (can't log in, existing cookie stops
  working). User id 1 can never be deactivated, edited to a non-superadmin
  role, or have its role changed — enforced server-side regardless of caller.
- **Admin-created users**: admin sets an initial password directly in the
  create-user form (no email dependency, consistent with Foundation's
  dev-mode stand-in for password reset — there's no email service to send
  a "set your password" link through yet).
- **Own-profile editing**: display name and email are directly editable by
  the user (no re-verification flow — no email service exists to verify
  through). Password change requires the current password.
- **CKEditor 5**: `ckeditor5` npm package, `ClassicEditor`, `licenseKey: 'GPL'`.
  Toolbar restricted to bold/italic/links/lists — exactly what the server-side
  sanitizer allows, so the editor UI can't offer more than will survive
  sanitization.
- **Sanitization**: server-side allowlist sanitizer runs on every alert
  create/update, regardless of caller (self or admin). Strips
  `script`/`style`/`iframe`/`on*` attributes/`javascript:` hrefs; allows
  `p, br, strong, em, b, i, ul, ol, li, a[href,title]`.

## Data model

`migrations/0002_profile_alerts_admin.sql`:

```sql
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;

CREATE TABLE alerts (
  id INTEGER PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id),      -- whose page it renders on
  created_by INTEGER NOT NULL REFERENCES users(id),   -- who authored it (self or admin)
  type TEXT NOT NULL CHECK (type IN ('info','success','warning','danger')),
  visibility TEXT NOT NULL CHECK (visibility IN ('dashboard','public','both')) DEFAULT 'public',
  body_html TEXT NOT NULL,       -- sanitized HTML from CKEditor5
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX idx_alerts_user ON alerts(user_id);

-- Example non-superadmin admin role; assignable to any user via the admin console
INSERT INTO roles (name, permissions) VALUES ('admin', '["manage_users"]');
```

`avatar_key` already exists on `users` from Foundation (nullable, populated on
first avatar upload).

## API routes

### Profile & avatar (`requireAuth`, acting on the caller's own account)

- `GET /api/profile` → `{ user }` (own full record, no password fields).
- `PUT /api/profile` `{ display_name?, email? }` → 200 updated user. 409 if
  email taken by someone else.
- `PUT /api/profile/password` `{ current_password, new_password }` → 200.
  401 if `current_password` wrong. Invalidates all other sessions on success
  (keep the current one).
- `POST /api/profile/avatar` multipart `{ file }` → 200 `{ avatar_key }`.
  400 if size/type/magic-bytes check fails. Deletes the previous R2 object
  for this user, if any, after the new one is stored.
- `GET /api/avatars/:key` → streams the R2 object with `Cache-Control` and
  correct `Content-Type`; 404 if missing. No auth required (avatars are
  effectively public once a user has a public page).

### Alerts

- `GET /api/alerts` → own alerts (`requireAuth`).
- `POST /api/alerts` `{ type, visibility, body_html }` → creates an alert
  with `user_id = created_by = caller.id`. Sanitizes `body_html` server-side.
- `PUT /api/alerts/:id` / `DELETE /api/alerts/:id` → allowed if
  `alert.user_id === caller.id` OR caller has `manage_users`/`*`. 403
  otherwise, 404 if the alert doesn't exist.
- `POST /api/admin/users/:id/alerts` (`requirePermission('manage_users')`)
  `{ type, visibility, body_html }` → creates an alert with
  `user_id = :id`, `created_by = caller.id`. Lets an admin inject an
  announcement onto another user's dashboard and/or public page.

### Public per-user page

- `GET /api/users/:id/public` → `{ display_name, avatar_key, alerts }` where
  `alerts` is filtered to `visibility IN ('public','both')`. 404 if the user
  is deactivated (`is_active = 0`) or doesn't exist — deactivated users have
  no public presence.

### Admin console (`requirePermission('manage_users')`)

- `GET /api/admin/users` → list all users (including deactivated), with
  `role`, `is_active`, `created_at`. No pagination needed at this scale; add
  later if the list grows large.
- `POST /api/admin/users` `{ email, password, display_name, role_id }` → 201.
  Same validation as self-registration; admin sets the initial password
  directly.
- `PUT /api/admin/users/:id` `{ display_name?, email?, role_id? }` → 200.
  If `:id === 1`, `role_id` changes are rejected (400) — superadmin's role
  can't be reassigned.
- `POST /api/admin/users/:id/deactivate` → 200, sets `is_active = 0`, deletes
  all of that user's sessions. 400 if `:id === 1` (superadmin can never be
  deactivated).
- `POST /api/admin/users/:id/reactivate` → 200, sets `is_active = 1`.

## Auth middleware changes (extends Foundation's `middleware/auth.ts`)

- `loadSession` now also checks `user.is_active`; if false, treat as
  unauthenticated (delete the stale session row, no `user` on context) —
  a deactivated user's existing cookie stops working on their very next
  request, not just at their next login.
- `requirePermission` unchanged in shape; `manage_users` is just another
  string in the permissions check, works identically to any future
  custom-role permission.

## Frontend

- `Dashboard.tsx` gains: profile edit form (display name, email, password
  change), avatar upload widget (preview + upload), and an Alerts panel
  (CKEditor5 + type selector + visibility selector, list of own alerts with
  edit/delete).
- `UserPage.tsx` (`/users/:id`, public, no auth) renders avatar, display
  name, and alerts with `visibility` in (`public`,`both`), each as a colored
  banner by `type`, HTML rendered via `dangerouslySetInnerHTML` (safe here —
  sanitized server-side before storage, not client-supplied at render time).
- `AdminConsole.tsx` (`/admin`, only rendered/routed if the logged-in user's
  permissions include `manage_users` or `*`): user table with add/edit/
  deactivate/reactivate actions, and a per-user "inject alert" form (same
  CKEditor5 component, plus the visibility selector) reusing the admin alert
  endpoint.

## Error handling

- Same conventions as Foundation: `{ error: string }` JSON, 400/401/403/404/
  409/500, no stack traces leaked, top-level `onError` catch-all.
- Avatar upload errors are specific: `{ error: "file_too_large" }`,
  `{ error: "unsupported_file_type" }` — frontend shows these directly
  rather than a generic message.

## Testing

`@cloudflare/vitest-pool-workers`, extending Foundation's suite:
- profile update: display name/email change, duplicate email 409, password
  change wrong-current-password 401
- avatar: valid upload replaces previous object, oversized file rejected,
  non-image content rejected even with a spoofed `Content-Type`
- alerts: self create/edit/delete (owner-only enforced), sanitizer strips a
  `<script>` payload, visibility filtering on the public endpoint
- admin: non-`manage_users` caller gets 403 on every `/api/admin/*` route;
  `manage_users` role (not superadmin) can perform all admin actions;
  id-1 protections (`role_id` change rejected, deactivate rejected)
- deactivated user: existing session cookie stops authenticating on the next
  request; public page 404s

## Explicitly deferred

- Role management UI (creating/editing roles themselves, not just assigning
  existing roles to users) — not requested; admin console assigns from
  existing roles only.
- Real email delivery (verification on email change, admin-created user
  onboarding) — same deferral as Foundation's password-reset email.
- Homepage user list and its "customizable out of the box" behavior →
  sub-project 3, which links to `/users/:id` built here.
