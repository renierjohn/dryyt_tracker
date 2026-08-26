# Workflow Tracking Plugin — Design Spec

Replaces `plugins/hello` (the trivial scaffold plugin) with `plugins/workflow`: a
transaction-status tracker. Admins register a transaction (a customer's order) and
move it through a fixed set of statuses; the customer looks up its status with a
6-character code, without needing an account.

## Decisions (confirmed with user)

- **Homepage becomes public.** `/` currently renders only for logged-in admins
  (`hasManageUsers(user)`); every other visitor — logged out, or a logged-in
  non-admin — is redirected away (`/login` or `/dashboard`). This design removes
  that gate: `/` renders for everyone. Logged-out visitors see the code-tracking
  input plus Login/Register links. Logged-in visitors additionally see a welcome
  line and a link into their console (`/admin` for admins, `/dashboard` for
  everyone else). This is the one core-file (`App.tsx`) change in this design —
  necessary because there is currently no public landing page for the tracking
  input to live on.
- **Transactions are freeform, not linked to app user accounts.** An admin types a
  customer name (and optionally contact info) when registering a transaction.
  There is no relation to the `users` table beyond `created_by` (which admin
  registered it). This matches "the code works even when not logged in" — the
  code, not an account, is the access mechanism.
- **Transaction fields**: customer name (required), customer contact (optional
  free text — phone or email), item/order description (optional free text),
  status, code, timestamps, and which admin created it.
- **`/track` is a core route, not a plugin route.** `PluginRoute`s in this
  codebase are unconditionally gated behind login in `App.tsx` (every plugin
  route is wrapped in `!user ? <Navigate to="/login"/> : ...`, even ones with no
  `requiredPermission`). Rather than change that contract for one plugin,
  `/track` is added directly in `App.tsx` alongside the other already-public core
  routes (`/users/:id` is the existing precedent — no auth check at all).
- **Admin controls are a plugin page**, not an addition to the existing
  `/admin` `AdminConsole`. `/plugins/workflow` (manifest `requiredPermission:
  'manage_users'`) holds the "register transaction" form and the
  status-control table, reachable via the existing `PluginNav` component. This
  keeps the plugin self-contained, matching the pattern the plugin system is
  designed around (see `README.md`'s Plugins section).
- **Admin permission**: reuse `manage_users` (the same gate `/admin` uses) rather
  than introduce a new permission — this app has exactly one admin role today, so
  a dedicated permission would be unused complexity.
- **Code alphabet** excludes visually-ambiguous characters — `0/O`, `1/I/L` — so
  a customer reading a code off a receipt (or over the phone) can't confuse them:
  `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. 6 characters, generated server-side, retried
  on collision (checked via the `UNIQUE` constraint on `code`).

## Architecture

```
plugins/
  workflow/                        # replaces plugins/hello/
    manifest.ts                    # { id: 'workflow', navLabel: 'Workflow',
                                    #   navPath: '/plugins/workflow',
                                    #   requiredPermission: 'manage_users' }
    backend/
      routes.ts                    # GET /track/:code (public)
                                    # POST /transactions (admin)
                                    # GET /transactions (admin)
                                    # PUT /transactions/:id/status (admin)
    frontend/
      routes.tsx                   # { path: '/plugins/workflow', element: <WorkflowAdminPage/> }
      pages/
        WorkflowAdminPage.tsx      # register form + transactions table w/ status controls
    migrations/
      0001_init.sql                # CREATE TABLE workflow_transactions
      0002_drop_hello_visits.sql   # DROP TABLE hello_plugin_visits

src/
  pages/
    Home.tsx                       # rewritten: public landing, code input -> /track?code=
    Track.tsx                      # new core page, registered in App.tsx, no auth
  App.tsx                          # "/" no longer redirects; new public "/track" route
```

`plugins/hello/` is deleted in full (manifest, backend, frontend, migration).
`worker/plugins.ts` drops the hello import/registration and adds workflow's.
`plugins/.migration-blocks.json`'s `"hello": 1000` entry is replaced by a
`"workflow"` entry (new block, assigned by `yarn plugins:sync`); the old
`hello_plugin_visits` table is dropped via a *new* migration in the workflow
plugin rather than editing/deleting the old one (migrations are append-only
history — the old `hello` migration doesn't come back, it's just gone along with
the rest of the deleted plugin, and `0002_drop_hello_visits.sql` cleans up the
table it left behind in any DB that already applied it).

## Data model

`plugins/workflow/migrations/0001_init.sql`:

```sql
CREATE TABLE workflow_transactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  customer_name TEXT NOT NULL,
  customer_contact TEXT,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'hold'
    CHECK (status IN ('hold', 'in_progress', 'done', 'ready_to_pickup')),
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

`plugins/workflow/migrations/0002_drop_hello_visits.sql`:

```sql
DROP TABLE IF EXISTS hello_plugin_visits;
```

## Backend

`plugins/workflow/backend/routes.ts`, mounted at `/api/plugins/workflow` (same
pattern as `plugins/hello/backend/routes.ts` today):

- `GET /track/:code` — **no auth applied**. Looks up by `code` (case-insensitive
  — uppercase the input before querying). Returns
  `{ code, customer_name, description, status, updated_at }` on a match, `404
  { error: 'not_found' }` otherwise. Never returns `customer_contact` or
  `created_by` — those aren't the tracker's business.
- `POST /transactions` — gated by `requirePermission('manage_users')`. Body:
  `{ customer_name, customer_contact?, description? }`. Validates
  `customer_name` is non-empty. Generates a unique code (loop: generate,
  `INSERT ... RETURNING *`, catch `UNIQUE` constraint violation and retry — same
  error-message-sniffing pattern `worker/routes/admin.ts`'s `POST /users` already
  uses for `email_taken`). Returns `201` with the full row (admin needs to see
  the code to hand it to the customer).
- `GET /transactions` — gated by `requirePermission('manage_users')`. Returns all
  rows, newest first.
- `PUT /transactions/:id/status` — gated by `requirePermission('manage_users')`.
  Body `{ status }`, validated against the 4 allowed values (`400
  invalid_status` otherwise). Updates `status` and `updated_at`.

## Frontend

**`Home.tsx`** (`/`, now public): a code input + "Track" button that navigates to
`/track?code=<value>` (uppercased, client-side). If a `user` is present (prop
still passed the same way `App.tsx` passes it today when logged in), additionally
render the existing welcome line, `LogoutButton`, and a link to `/admin` or
`/dashboard` per `hasManageUsers`. If no `user`, render Login/Register links
instead. `PluginNav` is only rendered when a user is present (it already
no-ops for a user with no visible plugins, but it needs a `user` to call
`hasPermission` against, so it's conditionally rendered here rather than
guarded internally).

**`Track.tsx`** (new, `/track`, core page, no auth): reads `?code=` from the URL
via `useSearchParams`. If present, calls `GET /plugins/workflow/track/:code`
on mount and renders the result (customer name, description, status — shown as
a human label: "On hold" / "In progress" / "Done" / "Ready for pickup" — and
last-updated time) or a "not found" message. Always shows its own input + button
(same as Home's) so a visitor can look up a different code without going back to
`/`.

**`App.tsx`** changes:
- `/` route: `element={<Home user={user} refresh={refresh} />}` unconditionally
  (drop the `!user` / `hasManageUsers` branching entirely — `Home` itself now
  handles the logged-out case since `user` can be `null`).
- New route: `<Route path="/track" element={<Track />} />`, no auth wrapping,
  placed alongside `/login`/`/users/:id`.

**`plugins/workflow/frontend/pages/WorkflowAdminPage.tsx`** (`/plugins/workflow`,
reached via `PluginNav`, gated by `manage_users` same as today's admin console):
- A "register transaction" form (customer name, contact, description) that on
  submit calls `POST /plugins/workflow/transactions` and displays the returned
  code prominently (this is the thing the admin hands to the customer).
- A table of all transactions (code, customer name, description, status,
  updated_at) with a status control per row — a `<select>` of the 4 statuses
  that calls `PUT /plugins/workflow/transactions/:id/status` on change and
  refetches the list, mirroring `AdminConsole.tsx`'s
  fetch-then-`setState`-in-a-named-`loadX`-helper pattern.

## Error handling

- `GET /track/:code`: malformed/short code → still just queries and 404s
  (no separate format validation needed — a non-matching code is a non-matching
  code).
- `POST /transactions`: empty `customer_name` → `400 missing_customer_name`.
- `PUT /transactions/:id/status`: unknown `id` → `404 not_found`; invalid
  `status` value → `400 invalid_status`.
- Code generation collision → retried in a loop (bounded, e.g. 10 attempts, then
  `500` — astronomically unlikely at this table size with a 6-char/32-symbol
  alphabet, but avoids an infinite loop as a theoretical ceiling).

## Testing

- Backend unit tests (mirroring `test/db.test.ts` / existing vitest-pool-workers
  setup): code generation produces the expected alphabet/length; `POST
  /transactions` requires `manage_users` and rejects empty `customer_name`; `PUT
  .../status` rejects an invalid status and 404s on an unknown id; `GET
  /track/:code` returns 404 for no match and omits `customer_contact` /
  `created_by` from its response.
- Manual click-through: register a transaction as admin on
  `/plugins/workflow`, copy the generated code, look it up anonymously via
  `/` → `/track?code=...` in a logged-out session, change its status as admin,
  confirm the public view reflects the new status.
