# Dryyt Tracker

A Cloudflare Worker (Hono + D1) backend with a Vite + React frontend, providing
registration/login/logout, forgot/reset password, and a roles/permissions system
with a bootstrap superadmin.

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
