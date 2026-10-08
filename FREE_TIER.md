# Cloudflare Free Tier — Capacity Estimate

How much use this app can take on the Cloudflare **Workers Free** plan before a
limit is hit, worked out from what the code actually does per request.

- Limits checked against the Cloudflare docs on 2026-10-08. Re-check them before
  relying on this; Cloudflare changes them from time to time.
- Daily limits reset at **00:00 UTC**. Past a limit, requests of that type
  **fail** (they are not billed), so the app goes partly down until the reset.
- All numbers below are estimates. Confirm them against real traffic in the
  Cloudflare dashboard (Workers → Metrics, D1 → Metrics, Durable Objects → Metrics).

## TL;DR

| Service | Free limit | What uses it here | Roughly where it runs out |
|---|---|---|---|
| **D1 rows read** | 5,000,000 / day | Owner's Tracker lists and counts scan **all of that owner's transactions**, every time | **First limit hit.** ~70 transactions/day for one busy owner with 3 months of history (see §2) |
| Workers requests | 100,000 / day | Every `/api/*` call, avatar image and WebSocket connect | ~3,000 transactions/day across all owners |
| D1 rows written | 100,000 / day | Registering, status changes, logins | ~14,000 transactions/day |
| Durable Object requests | 100,000 / day | `/track` WebSocket connects and status broadcasts | ~14,000 transactions/day |
| DO duration | 13,000 GB-s / day | Brief wake-ups to broadcast (hibernating sockets are free) | Not a realistic concern |
| D1 storage | 500 MB per database, 5 GB per account | Transactions, users, sessions | ~250k–1M transactions kept |
| R2 storage | 10 GB-month | Avatars only (max 5 MB each) | 2,000+ users at the max size; ~50,000 at typical sizes |
| R2 operations | 1M Class A / 10M Class B per month | Avatar uploads / avatar reads | Workers requests run out first |
| Workers CPU | 10 ms per request | Password hashing, HTML sanitizing | **Per-request risk**, not a volume limit (see §6) |

**Bottom line:** the app is fine for a handful of small shops. The first thing
to break is **D1 rows read**. That limit depends on how much history each owner
has, not only on how much traffic there is. Two missing indexes make it much
worse (see §2 and the recommendations at the end).

## How one transaction uses resources

These are the requests a transaction makes from registration through pickup,
following the code paths in `plugins/workflow`:

| Step | Worker requests | DO requests | D1 rows written |
|---|---|---|---|
| Register: `new-code`, `next-control-number` ×2, `POST`, then reload counts + open list | ~5 | 0 | ~3 (row + `code` unique index + `control_number` index) |
| 4 status changes (hold → in progress → done → ready → end/pickup), each `PUT` + reload counts + list(s) | ~14 | 4 (broadcast) | ~4 |
| Customer opens `/track` about 3 times (`/auth/me` + lookup + WebSocket) | ~9 | 3 (WebSocket connect) | 0 |
| **Total** | **~30** | **~7** | **~7** |

Owners reloading the Tracker, customers browsing owner pages, and logins add to
these numbers. The figures below already include some headroom for that.

## 1. Workers: 100,000 requests/day

- Static assets (the React app, JS, CSS, and SPA page loads) are **free and not
  counted**. Only `/api/*` runs the Worker (`run_worker_first` in `wrangler.jsonc`).
- Each transaction costs ~30 Worker requests, so 100,000 ÷ 30 ≈ **3,300
  transactions/day across all owners**. A safer planning number is **~3,000/day**.
- Avatars are served through the Worker (`/api/avatars/:key`), so each avatar
  load is one Worker request. Browsers cache them (`immutable`), but every new
  visitor still costs requests.
- Past the limit, `/api/*` returns **429** and the app stops working; the
  static pages still load.

## 2. D1 rows read: 5,000,000/day ← the real bottleneck

D1 counts every row a query **scans**, not only the rows it returns.

### What's expensive

The `workflow_transactions` table has only one index that starts with
`created_by`: the unique `(created_by, control_number)` index. Queries that
filter by owner can find that owner's rows, but must then **read every one of
them** to check status or sort:

| Query (in `plugins/workflow/backend/routes.ts`) | Rows read per call |
|---|---|
| `GET /transactions` (open list, `status != 'end'`) | all of the owner's rows (**N**) |
| `GET /transactions/counts` (`GROUP BY status`) | N |
| `GET /transactions?status=end` (page + `COUNT(*)`) | ~N |
| `nextControlNumber` (`MAX(CAST(control_number …))`) | N |
| `GET /customers` (autocomplete) | N |
| `GET /owners/:identifier/transactions` (public owner page, every visitor) | N |
| `GET /my-transactions` (customer's own list, no index on `customer_user_id`) | **the whole table, all owners** |
| `GET /track/:code` (unique `code` index) | ~2 (cheap) |
| Session check on every signed-in request (`token` primary key) | ~3 (cheap) |

A transaction's lifecycle triggers about **12 owner-wide scans** (§ "How one
transaction uses resources": register ≈ 4 scans, each status change ≈ 2 scans).

### Estimate

For an owner doing **T** transactions/day and keeping **N** transactions of
history:

```
rows read per day ≈ 12 × N × T      (plus owner page views and customer lists)
```

The superadmin "purge old" action deletes transactions older than 3 months.
**If it's run regularly**, N ≈ 90 × T:

| Owner volume (T/day) | History kept (N) | Rows read/day for that owner | Share of the 5M limit |
|---|---|---|---|
| 20 | 1,800 | ~0.43M | 9% |
| 40 | 3,600 | ~1.7M | 35% |
| **68** | 6,100 | **~5M** | **100%: limit hit** |

**If it's never run**, N keeps growing. After one year (N ≈ 365 × T), a single
owner hits the limit at **~34 transactions/day**.

The limit is shared by all owners. **10 owners doing 20/day each** use ≈ 4.3M
reads/day, which is close to the limit.

`/my-transactions` costs a scan of the **whole table** each time a customer
opens it. With 50,000 stored transactions, **100 customer visits ≈ 5M rows**,
enough to hit the limit alone.

## 3. D1 rows written: 100,000/day

- ~7 rows per transaction (each insert also writes 2 index entries; each status
  update writes 1 row, because `status` isn't indexed).
- Logins write a session row plus its index (~2 rows).
- 100,000 ÷ 7 ≈ **~14,000 transactions/day**. Not a practical concern.

## 4. D1 storage: 500 MB per database (free), 5 GB per account

- A transaction row with indexes is ~0.5–2 KB; rich-text notes are the variable part.
- 500 MB ≈ **250,000–1,000,000 stored transactions**.
- `sessions` rows build up until the admin "delete expired sessions" action
  runs (`deleteExpiredSessions`). They're small, but nothing deletes them automatically.
- The 3-month purge keeps storage, and the read costs in §2, bounded.

## 5. Durable Objects (`TrackRoom`, live `/track` updates)

| Limit (free, per day) | Usage | Estimate |
|---|---|---|
| 100,000 requests | 1 per WebSocket connect + 1 per status broadcast (RPC) | ~7 per transaction → **~14,000 transactions/day** |
| 13,000 GB-s duration | Hibernating sockets are **not billed** while idle; only the brief wake-up to broadcast counts | Negligible |
| 5M SQLite rows read / 100k written | `TrackRoom` stores nothing | 0 |
| 5 GB storage | none | 0 |

- Messages from the client are billed at 20:1, but the page sends none
  (protocol pings are free).
- An ended order opens no socket, and a socket closes when its order moves to
  "End" (`src/pages/Track.tsx`). Finished orders cost nothing.
- Past the limit, new connects and broadcasts fail. The `/track` page still
  works and simply stops updating live; a broadcast failure is only logged
  (`notifyTrack`).

## 6. Workers CPU: 10 ms per request

This is a per-request ceiling, not a daily volume. A request that goes over it
fails with error 1102.

- **Password hashing**: `worker/crypto.ts` uses PBKDF2 with **100,000
  iterations**. That can take tens of milliseconds of CPU on login, register
  and password reset. **This is the most likely 10 ms violation.** Watch for
  1102 errors on `/api/auth/*`.
- **HTML sanitizing**: every list response re-sanitizes each row's
  `description` (`withSafeDescription`). A long open list with heavy rich-text
  notes could go over the limit.
- Cloudflare doesn't enforce the limit exactly on every request; occasional
  bursts are tolerated. Check **Workers → Metrics → CPU time** (the p99) once
  real traffic is flowing.

## 7. R2 (avatars only)

| Limit (free, per month) | Usage | Estimate |
|---|---|---|
| 10 GB-month storage | 1 object per user with an avatar; ≤ 5 MB (`MAX_AVATAR_BYTES`); replacing one deletes the old one | 2,000 users at 5 MB each; ~50,000 at ~200 KB |
| 1M Class A (writes, lists) | 1 `put` per avatar upload | Not reachable in practice |
| 10M Class B (reads) | 1 `get` per avatar request through the Worker | Workers' 100k/day (~3M/month) runs out first |
| Egress | free | — |

Deletes are free.

## Recommendations (not yet implemented)

Ordered by impact on the first limit you'd hit:

1. **Add an index for the owner's status queries**, e.g.
   `CREATE INDEX idx_workflow_tx_owner_status ON workflow_transactions(created_by, status, created_at);`
   The open list then reads only open rows, and the "End" page reads only its
   10 rows plus the count. This removes most of §2's cost.
2. **Index `customer_user_id`**:
   `CREATE INDEX idx_workflow_tx_customer ON workflow_transactions(customer_user_id);`
   `/my-transactions` then reads only that customer's rows instead of the whole table.
3. **Avoid the second reload after each status change.** The page re-fetches
   counts and the open list after every change; it could update locally from
   the `PUT` response. That's about 2 fewer Worker requests and 2 fewer scans
   per change.
4. **Run the 3-month purge on a schedule** (a Cron Trigger) instead of by hand.
   That keeps N, and so §2's cost, bounded.
5. **Delete expired sessions on a schedule** (the same cron).
6. **Watch auth CPU time.** If 1102 errors show up on login, lowering the
   PBKDF2 iterations or moving to Workers Paid (30 s CPU) fixes it.

If usage grows past these limits, **Workers Paid** (US$5/month minimum) raises
the limits: 10M Worker requests/month, 25B D1 rows read/month, 10 GB per D1
database, and 30 s CPU per request. It's the simplest fix once real traffic
gets close to the numbers above.
