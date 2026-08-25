# Dryyt Tracker

A Cloudflare Worker (Hono + D1) backend with a Vite + React frontend, providing
registration/login/logout, forgot/reset password, and a roles/permissions system
with a bootstrap superadmin.

## Features

- **Auth**: register, login/logout, forgot/reset password (`/register`,
  `/login`, `/forgot-password`, `/reset-password`). Sessions are opaque tokens
  in a `sessions` D1 table, set as an httpOnly cookie.
- **Roles & permissions**: two seeded roles — `superadmin` (id 1, permission
  `*`) and `user` (id 2, no permissions). The very first registered user is
  bootstrapped into `superadmin`; everyone after that gets `user`. Routes are
  gated with `requirePermission('<name>')` middleware
  (`worker/middleware/auth.ts`) checking the caller's role permissions.
- **Homepage** (`/`): a minimal landing page after login — welcome message,
  role, log out, and a link to wherever that account's own settings live
  (`/dashboard` or `/admin`, below).
- **Profile** (change display name/email/password, upload an avatar — stored
  in R2, served from `/api/avatars/:key`) plus a user's own **Alerts** (see
  below): at `/dashboard` for a plain `user`, or folded into `/admin` for a
  `manage_users` account (see Admin console). Visiting the wrong one for your
  role redirects to the right one.
- **Alerts**: users can post rich-text (CKEditor) alerts on their own profile,
  scoped to `dashboard` (only they see it), `public` (shown on their public
  profile page, `/users/:id`), or `both`.
- **Admin console** (`/admin`, requires the `manage_users` permission — which
  only `*`/superadmin has by default): the account's own profile/password/
  alerts (see above), plus: list all users in a table; create, edit (email/
  display name/role), deactivate/reactivate users; inject an alert onto any
  user's dashboard. The superadmin account (id 1) can't be deactivated or
  have its role changed, from the UI or the API.
- **Masquerade**: from the admin console, "Masquerade" on any active,
  non-superadmin user swaps the caller's session cookie to a session logged in
  as that user (`sessions.impersonator_id` on the new session row records who
  started it — the original admin session is left untouched). A banner shown
  on every page while masquerading has a "Return to admin" button that ends
  the masquerade session and mints a fresh one for the original admin — no
  re-login needed. Since permission checks run against whoever the *current*
  session belongs to, a masquerading admin has exactly the target user's
  permissions for the duration (including no access to `/admin/*` routes,
  so nested masquerading isn't possible).

## Installation

Prerequisites: Node.js, `yarn`, and a Cloudflare account with the `wrangler`
CLI able to authenticate against it (`wrangler` itself is already a project
dependency — no separate global install needed).

1. Clone the repo and install dependencies:

   ```
   yarn install
   ```

2. Authenticate wrangler with your own Cloudflare account, if you haven't:

   ```
   npx wrangler login
   ```

3. Create your own D1 database (this repo's committed `wrangler.jsonc` points
   at the original author's database — you need your own):

   ```
   npx wrangler d1 create dryyt-tracker-db
   ```

   Note the `database_id` printed in the output.

4. Update `wrangler.jsonc` (the live config file wrangler actually reads) with
   your own `database_name`/`database_id` from step 3. `wrangler.toml.example`
   in the repo root shows the same config shape with placeholder values as a
   reference — it is not read by wrangler, just a template to copy values from
   if you'd rather see the whole shape in one place before editing the real
   `wrangler.jsonc`.

   **Update it in both places**: `d1_databases` appears both at the top level
   and inside `env.production` — wrangler environments do NOT inherit
   `d1_databases` from the top level (confirmed via
   `wrangler deploy --dry-run --env production`, which otherwise deploys with
   no database binding at all), so both copies need your database_id.

5. Apply the schema migration to your new local database:

   ```
   npx wrangler d1 migrations apply dryyt-tracker-db --local
   ```

6. `wrangler.jsonc`'s committed `DEV_MODE` default is `"false"` (safe for a
   real deploy — leaving it `"true"` in production would hand a live
   password-reset token to anyone who knows a user's email address). For
   local development, you still want to see the reset link, so copy the
   local-only override file instead of editing the committed default:

   ```
   cp .dev.vars.example .dev.vars
   ```

   `.dev.vars` is gitignored and merged in automatically by `wrangler dev`
   only — it has no effect on `yarn deploy`.

7. Start the app (see "Running locally" below).

## Running locally

Local dev and tests apply migrations to the local D1 database automatically
(via `wrangler d1 migrations apply --local`, run implicitly by
`vitest-pool-workers` for tests, and by `wrangler dev` for local runtime state).

There are two ways to run the app locally, depending on what you're working on:

**Worker-only** — serves both the Worker API (`/api/*`) and the *built*
frontend from one local server. Use this to test the real, production-shaped
build (including auth cookies, redirects, etc.):

```
yarn build
yarn dev:worker
```

`yarn dev:worker` runs `wrangler dev` on `http://localhost:8787`. Since it
serves the frontend from `dist/`, re-run `yarn build` after frontend changes
to see them (no HMR).

**Frontend with HMR** — for iterating on React/CSS with instant reload, while
still exercising the real backend:

```
yarn dev:worker   # terminal 1 — worker on :8787
yarn dev          # terminal 2 — vite on :5173
```

`vite.config.ts` proxies `/api/*` from `:5173` to `:8787` (`changeOrigin:
true`), so `apiFetch`'s same-origin `/api/...` calls reach the real worker —
login, cookies, and everything else behave the same as hitting `:8787`
directly. Use `http://localhost:5173` in your browser.

### Logging in as a user without a password

`script/auth/session.js` is a dev-only helper for skipping the login form. It
mints a one-time login token directly in the local D1 database and prints a
URL:

```
node script/auth/session.js                    # superadmin (role_id=1), local D1
node script/auth/session.js user@example.com    # a specific user
node script/auth/session.js user@example.com --base-url http://localhost:5173
```

Opening the printed URL (`GET /api/auth/dev-login?token=...`) exchanges the
token for a real session and sets the session cookie via a redirect to `/`.
The token is single-use and expires after 5 minutes. This only works when the
worker is running with `DEV_MODE=true` (see `.dev.vars` above) — it 404s
otherwise, so it's inert against a real deploy even if a token leaked.
Pass `--remote` to mint the token against the real D1 database instead (only
do this deliberately, same caution as the migrations section below).

## Styling

Styles live in `src/assets/sass` as `.scss`, one file per page/component
(`base.scss` for global resets/tokens, `app.scss`, `dashboard.scss`,
`admin-console.scss`, `alert-editor.scss`), each imported directly by the
React file it styles. Shared design tokens (colors, fonts) are CSS custom
properties in `_variables.scss`, with a `prefers-color-scheme: dark` override
— use `var(--accent)`, `var(--border)`, etc. rather than hardcoding colors so
new components stay consistent in both themes.

## Testing

```
yarn test
```

Runs the backend test suite against a real local D1 instance via
`vitest-pool-workers` (no mocks). Migrations are applied automatically before
the suite runs.

## Deploying

```
yarn deploy
```

This builds the frontend and runs `wrangler deploy --env production`, which
uses the `env.production` block in `wrangler.jsonc` — explicitly `DEV_MODE:
"false"`, redundant with the top-level default but kept explicit so the
production deploy target can never silently inherit a future change to the
top-level default.

**Before the first real deploy**, the remote D1 database must have migrations
applied manually — this is a separate, deliberate step and is *not* run by
`yarn deploy`:

```
wrangler d1 migrations apply dryyt-tracker-db --remote
```

Do not run this against the remote database as part of routine local
development; only run it deliberately when you intend to update the real
production schema.
