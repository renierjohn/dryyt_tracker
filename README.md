# Dryyt Tracker

A Cloudflare Worker (Hono + D1) backend with a Vite + React frontend, providing
registration/login/logout, forgot/reset password, and a roles/permissions system
with a bootstrap superadmin.

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

5. Apply the schema migration to your new local database:

   ```
   npx wrangler d1 migrations apply dryyt-tracker-db --local
   ```

6. Set `DEV_MODE` in `wrangler.jsonc`'s `vars` block: `"true"` for local
   development (needed so the forgot-password flow shows you the reset link,
   since there's no email service yet), `"false"` before any real/production
   deploy — leaving it `"true"` in production would hand a live password-reset
   token to anyone who knows a user's email address.

7. Start the app (see "Running locally" below).

## Running locally

Local dev and tests apply migrations to the local D1 database automatically
(via `wrangler d1 migrations apply --local`, run implicitly by
`vitest-pool-workers` for tests, and by `wrangler dev` for local runtime state).

```
yarn install
yarn dev:worker
```

`yarn dev:worker` runs `wrangler dev`, which serves both the Worker API
(`/api/*`) and the built frontend together from one local server — this is the
correct way to run the app locally.

Bare `yarn dev` (plain `vite`) is frontend-only: it has no proxy to `/api`, so
pages that call the backend (login, register, etc.) won't work against it. Use
it only for pure frontend/CSS iteration where you don't need the API.

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

This builds the frontend and runs `wrangler deploy`.

**Before the first real deploy**, the remote D1 database must have migrations
applied manually — this is a separate, deliberate step and is *not* run by
`yarn deploy`:

```
wrangler d1 migrations apply dryyt-tracker-db --remote
```

Do not run this against the remote database as part of routine local
development; only run it deliberately when you intend to update the real
production schema.
