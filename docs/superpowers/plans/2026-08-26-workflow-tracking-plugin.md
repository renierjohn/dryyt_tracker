# Workflow Tracking Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `plugins/hello` scaffold plugin with `plugins/workflow`, a
transaction-status tracker: admins register a transaction and move it through
`hold` → `in_progress` → `done` → `ready_to_pickup`; anyone can look up a
transaction's status with its 6-character code, no login required.

**Architecture:** A self-contained plugin (`plugins/workflow/`) owns the
`workflow_transactions` table and all admin-facing CRUD (register, list, set
status) behind the existing `manage_users` permission. A public lookup endpoint
on the same plugin router has no auth applied. Two core-app files change:
`App.tsx` (homepage becomes public; new public `/track` route) and `Home.tsx`
(rewritten as a public landing page with the tracking input).

**Tech Stack:** Hono (Worker backend), D1 (SQLite), React + react-router-dom
(frontend), vitest + `@cloudflare/vitest-pool-workers` (backend tests).

**Spec:** `docs/superpowers/specs/2026-08-26-workflow-tracking-plugin-design.md`

## Global Constraints

- Code alphabet excludes visually-ambiguous characters: `ABCDEFGHJKMNPQRSTUVWXYZ23456789` (no `0/O`, `1/I/L`). Codes are 6 characters, generated server-side.
- Admin-only endpoints/pages reuse the existing `manage_users` permission — no new permission is introduced.
- `/track` is a **core** route (registered directly in `App.tsx`, no auth wrapping) — plugin routes in this codebase are always gated behind login, so a public page cannot be a `PluginRoute`.
- After adding/editing any file under `plugins/workflow/migrations/`, run `yarn plugins:sync` before running tests — the root `migrations/` directory (which `vitest.config.ts` reads at startup) is a generated copy.
- `plugins/hello/` is deleted in full; nothing in this plan re-references it except the one migration that drops the table it left behind.

---

### Task 1: Remove `hello`, scaffold `workflow` — register + list transactions

**Files:**
- Delete: `plugins/hello/` (entire directory)
- Create: `plugins/workflow/manifest.ts`
- Create: `plugins/workflow/backend/code.ts`
- Create: `plugins/workflow/backend/routes.ts`
- Create: `plugins/workflow/migrations/0001_init.sql`
- Create: `plugins/workflow/migrations/0002_drop_hello_visits.sql`
- Modify: `worker/plugins.ts`
- Modify: `plugins/.migration-blocks.json`
- Test: `test/workflow-code.test.ts`
- Test: `test/routes/plugins-workflow.test.ts`

**Interfaces:**
- Produces: `generateCode(): string` (`plugins/workflow/backend/code.ts`) — later steps in this task and Task 2/3 call it.
- Produces: `WorkflowTransaction` interface (`plugins/workflow/backend/routes.ts`) — `{ id, code, customer_name, customer_contact, description, status, created_by, created_at, updated_at }`. Tasks 2 and 3 extend this same file.
- Produces: `POST /api/plugins/workflow/transactions` and `GET /api/plugins/workflow/transactions`, both gated by `requirePermission('manage_users')`.

- [ ] **Step 1: Delete the hello plugin**

```bash
rm -rf plugins/hello
```

- [ ] **Step 2: Write the failing test for code generation**

Create `test/workflow-code.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { generateCode } from '../plugins/workflow/backend/code';

describe('generateCode', () => {
  it('returns a 6-character code using only the safe alphabet', () => {
    for (let i = 0; i < 50; i++) {
      const code = generateCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    }
  });

  it('is not the same value on every call', () => {
    const codes = new Set(Array.from({ length: 20 }, () => generateCode()));
    expect(codes.size).toBeGreaterThan(1);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `yarn vitest run test/workflow-code.test.ts`
Expected: FAIL — `plugins/workflow/backend/code.ts` does not exist yet.

- [ ] **Step 4: Implement code generation**

Create `plugins/workflow/backend/code.ts`:

```ts
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

// Excludes 0/O and 1/I/L — a customer reading this off a receipt or over the
// phone shouldn't have to guess which lookalike glyph it actually is.
export function generateCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(CODE_LENGTH));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}
```

- [ ] **Step 5: Run it to verify it passes**

Run: `yarn vitest run test/workflow-code.test.ts`
Expected: PASS

- [ ] **Step 6: Create the manifest**

Create `plugins/workflow/manifest.ts`:

```ts
import type { PluginManifest } from '../types';

const manifest: PluginManifest = {
  id: 'workflow',
  navLabel: 'Workflow',
  navPath: '/plugins/workflow',
  requiredPermission: 'manage_users',
};

export default manifest;
```

- [ ] **Step 7: Create the migrations**

Create `plugins/workflow/migrations/0001_init.sql`:

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

Create `plugins/workflow/migrations/0002_drop_hello_visits.sql`:

```sql
DROP TABLE IF EXISTS hello_plugin_visits;
```

- [ ] **Step 8: Clear the stale migration-block entry**

Overwrite `plugins/.migration-blocks.json`:

```json
{}
```

(`yarn plugins:sync` in Step 10 fills this back in with `{"workflow": 1000}` —
`hello`'s old entry must be cleared manually first since the sync script never
prunes stale keys on its own, only adds new ones.)

- [ ] **Step 9: Write the failing tests for register + list**

Create `test/routes/plugins-workflow.test.ts`:

```ts
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

describe('workflow plugin admin gate', () => {
  it('returns 403 on transaction routes for a caller without manage_users', async () => {
    await createUserWithRoleAndLogin('workflow-gate-dummy@example.com', 2, 'Dummy');
    const plainCookie = await createUserWithRoleAndLogin('workflow-gate-plain@example.com', 2, 'Plain');
    expect((await req('GET', '/api/plugins/workflow/transactions', undefined, plainCookie)).status).toBe(403);
    expect((await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'X' }, plainCookie)).status).toBe(403);
  });
});

describe('POST /api/plugins/workflow/transactions', () => {
  it('creates a transaction with a generated code and defaults status to hold', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-create@example.com', adminRoleId, 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Jane Doe', customer_contact: 'jane@example.com', description: '2x shirts',
    }, adminCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { transaction: { code: string; status: string; customer_name: string } };
    expect(body.transaction.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.transaction.status).toBe('hold');
    expect(body.transaction.customer_name).toBe('Jane Doe');
  });

  it('rejects an empty customer name with 400', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-empty-name@example.com', adminRoleId, 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: '  ' }, adminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('missing_customer_name');
  });
});

describe('GET /api/plugins/workflow/transactions', () => {
  it('lists transactions newest first', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-list@example.com', adminRoleId, 'Admin');
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'First' }, adminCookie);
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Second' }, adminCookie);

    const res = await req('GET', '/api/plugins/workflow/transactions', undefined, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: Array<{ customer_name: string }> };
    const names = body.transactions.map((t) => t.customer_name);
    expect(names.indexOf('Second')).toBeLessThan(names.indexOf('First'));
  });
});
```

- [ ] **Step 10: Implement the router, wire it up, sync migrations**

Create `plugins/workflow/backend/routes.ts`:

```ts
import { Hono } from 'hono';
import { requirePermission } from '../../../worker/middleware/auth';
import type { AppBindings } from '../../../worker/types';
import { generateCode } from './code';

// Endpoints here have mixed auth: a public lookup (added in a later task)
// alongside admin-only registration/listing/status-changes — so middleware is
// applied per-route below rather than once via `.use('*', ...)` the way
// single-purpose plugin routers (e.g. hello, alerts) do it.
const workflowRoutes = new Hono<AppBindings>();

export interface WorkflowTransaction {
  id: number;
  code: string;
  customer_name: string;
  customer_contact: string | null;
  description: string | null;
  status: string;
  created_by: number;
  created_at: string;
  updated_at: string;
}

async function insertWithUniqueCode(
  db: D1Database,
  params: { customerName: string; customerContact: string | null; description: string | null; createdBy: number },
): Promise<WorkflowTransaction> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    try {
      const row = await db
        .prepare(
          `INSERT INTO workflow_transactions (code, customer_name, customer_contact, description, created_by)
           VALUES (?, ?, ?, ?, ?) RETURNING *`,
        )
        .bind(code, params.customerName, params.customerContact, params.description, params.createdBy)
        .first<WorkflowTransaction>();
      if (row) return row;
    } catch (err) {
      if (err instanceof Error && err.message.includes('UNIQUE')) continue;
      throw err;
    }
  }
  throw new Error('failed to generate a unique code');
}

workflowRoutes.post('/transactions', requirePermission('manage_users'), async (c) => {
  const admin = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const customerName = typeof body?.customer_name === 'string' ? body.customer_name.trim() : '';
  const customerContact =
    typeof body?.customer_contact === 'string' && body.customer_contact.trim() ? body.customer_contact.trim() : null;
  const description =
    typeof body?.description === 'string' && body.description.trim() ? body.description.trim() : null;

  if (!customerName) return c.json({ error: 'missing_customer_name' }, 400);

  const transaction = await insertWithUniqueCode(c.env.DB, {
    customerName,
    customerContact,
    description,
    createdBy: admin.id,
  });
  return c.json({ transaction }, 201);
});

workflowRoutes.get('/transactions', requirePermission('manage_users'), async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT * FROM workflow_transactions ORDER BY created_at DESC')
    .all<WorkflowTransaction>();
  return c.json({ transactions: results });
});

export default workflowRoutes;
```

Modify `worker/plugins.ts` — replace the hello import/registration with workflow's,
keeping the file's existing explanatory header comment as-is:

```ts
// The one manual registration point for plugin backends. Workers bundle statically
// (esbuild via wrangler), so there's no runtime filesystem discovery here the way
// Vite's import.meta.glob gives the frontend — each plugin gets one import + one
// entry below. The mount path is derived from the plugin's own manifest.id (not
// hand-typed) so it can't drift out of sync with the frontend's API calls, and
// manifest.enabled is checked here the same way the frontend checks it in
// src/plugins/loadPlugins.ts — one flag, both sides respect it.
import type { Hono } from 'hono';
import type { AppBindings } from './types';
import type { PluginManifest } from '../plugins/types';
import workflowManifest from '../plugins/workflow/manifest';
import workflowRoutes from '../plugins/workflow/backend/routes';

const registrations: { manifest: PluginManifest; router: Hono<AppBindings> }[] = [
  { manifest: workflowManifest, router: workflowRoutes },
];

export const pluginRouters: { path: string; router: Hono<AppBindings> }[] = registrations
  .filter(({ manifest }) => manifest.enabled !== false)
  .map(({ manifest, router }) => ({ path: `/api/plugins/${manifest.id}`, router }));
```

Sync the plugin migrations into the root directory:

```bash
yarn plugins:sync
```

Expected output: `Synced 2 plugin migration(s) into migrations/.` — confirm
`migrations/1000_hello__init.sql` is gone and `migrations/1000_workflow__init.sql`
/ `migrations/1001_workflow__drop_hello_visits.sql` exist, and
`plugins/.migration-blocks.json` now reads `{"workflow": 1000}`.

- [ ] **Step 11: Run the tests to verify they pass**

Run: `yarn vitest run test/workflow-code.test.ts test/routes/plugins-workflow.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 12: Run the full suite to confirm nothing else broke**

Run: `yarn test`
Expected: PASS — no test referenced `hello`, so removing it shouldn't break anything else.

- [ ] **Step 13: Commit**

```bash
git add -A
git commit -m "feat: replace hello plugin with workflow transaction tracking (register + list)"
```

---

### Task 2: Admin status control endpoint

**Files:**
- Modify: `plugins/workflow/backend/routes.ts`
- Test: `test/routes/plugins-workflow.test.ts`

**Interfaces:**
- Consumes: `WorkflowTransaction` interface, `workflowRoutes` Hono instance (both from Task 1's `plugins/workflow/backend/routes.ts`).
- Produces: `PUT /api/plugins/workflow/transactions/:id/status`, gated by `requirePermission('manage_users')`. Body `{ status: string }`; `200 { transaction }` on success, `400 { error: 'invalid_status' }` for an unrecognized value, `404 { error: 'not_found' }` for an unknown id.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes/plugins-workflow.test.ts`:

```ts
describe('PUT /api/plugins/workflow/transactions/:id/status', () => {
  it('updates the status of an existing transaction', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-status@example.com', adminRoleId, 'Admin');
    const createRes = await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Status Target' }, adminCookie);
    const created = (await createRes.json()) as { transaction: { id: number } };

    const res = await req('PUT', `/api/plugins/workflow/transactions/${created.transaction.id}/status`, { status: 'in_progress' }, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: { status: string } };
    expect(body.transaction.status).toBe('in_progress');
  });

  it('rejects an invalid status with 400', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-bad-status@example.com', adminRoleId, 'Admin');
    const createRes = await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Bad Status Target' }, adminCookie);
    const created = (await createRes.json()) as { transaction: { id: number } };

    const res = await req('PUT', `/api/plugins/workflow/transactions/${created.transaction.id}/status`, { status: 'lost' }, adminCookie);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('invalid_status');
  });

  it('returns 404 for an unknown transaction id', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-missing-status@example.com', adminRoleId, 'Admin');
    const res = await req('PUT', '/api/plugins/workflow/transactions/999999/status', { status: 'done' }, adminCookie);
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run test/routes/plugins-workflow.test.ts`
Expected: FAIL — `PUT /transactions/:id/status` doesn't exist yet (404 on all three new assertions' preconditions, or a thrown/undefined route).

- [ ] **Step 3: Implement the endpoint**

Modify `plugins/workflow/backend/routes.ts` — insert this block immediately
before `export default workflowRoutes;`, and add the `STATUSES` constant right
after the `workflowRoutes` declaration (before `export interface WorkflowTransaction`):

```ts
const STATUSES = new Set(['hold', 'in_progress', 'done', 'ready_to_pickup']);
```

```ts
workflowRoutes.put('/transactions/:id/status', requirePermission('manage_users'), async (c) => {
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';

  if (!STATUSES.has(status)) return c.json({ error: 'invalid_status' }, 400);

  const row = await c.env.DB
    .prepare(`UPDATE workflow_transactions SET status = ?, updated_at = datetime('now') WHERE id = ? RETURNING *`)
    .bind(status, id)
    .first<WorkflowTransaction>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn vitest run test/routes/plugins-workflow.test.ts`
Expected: PASS (8 tests)

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/backend/routes.ts test/routes/plugins-workflow.test.ts
git commit -m "feat: add workflow transaction status endpoint"
```

---

### Task 3: Public tracking endpoint

**Files:**
- Modify: `plugins/workflow/backend/routes.ts`
- Test: `test/routes/plugins-workflow.test.ts`

**Interfaces:**
- Consumes: `WorkflowTransaction`, `workflowRoutes` (Task 1/2).
- Produces: `GET /api/plugins/workflow/track/:code` — **no auth applied**. `200 { transaction: { code, customer_name, description, status, updated_at } }` on match (case-insensitive), `404 { error: 'not_found' }` otherwise. Never includes `customer_contact` or `created_by`.

- [ ] **Step 1: Write the failing tests**

Append to `test/routes/plugins-workflow.test.ts`:

```ts
describe('GET /api/plugins/workflow/track/:code', () => {
  it('returns the transaction status with no auth required, omitting contact/created_by', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-track@example.com', adminRoleId, 'Admin');
    const createRes = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Track Target', customer_contact: 'secret@example.com', description: 'Trousers',
    }, adminCookie);
    const created = (await createRes.json()) as { transaction: { code: string } };

    const res = await SELF.fetch(`https://example.com/api/plugins/workflow/track/${created.transaction.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: Record<string, unknown> };
    expect(body.transaction.customer_name).toBe('Track Target');
    expect(body.transaction.status).toBe('hold');
    expect(body.transaction.customer_contact).toBeUndefined();
    expect(body.transaction.created_by).toBeUndefined();
  });

  it('returns 404 for an unknown code', async () => {
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/track/ZZZZZZ');
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `yarn vitest run test/routes/plugins-workflow.test.ts`
Expected: FAIL — no route matches `GET /track/:code` yet.

- [ ] **Step 3: Implement the endpoint**

Modify `plugins/workflow/backend/routes.ts` — insert this route right after
the `const workflowRoutes = new Hono<AppBindings>();` line (before
`export interface WorkflowTransaction`), so the public route reads first in
the file:

```ts
workflowRoutes.get('/track/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const row = await c.env.DB
    .prepare('SELECT code, customer_name, description, status, updated_at FROM workflow_transactions WHERE code = ?')
    .bind(code)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});
```

- [ ] **Step 4: Run it to verify it passes**

Run: `yarn vitest run test/routes/plugins-workflow.test.ts`
Expected: PASS (10 tests)

- [ ] **Step 5: Run the full suite**

Run: `yarn test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add plugins/workflow/backend/routes.ts test/routes/plugins-workflow.test.ts
git commit -m "feat: add public workflow tracking endpoint"
```

---

### Task 4: Admin page — register transaction + status controls

**Files:**
- Create: `plugins/workflow/frontend/pages/WorkflowAdminPage.tsx`
- Create: `plugins/workflow/frontend/routes.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` from `plugins/sdk.ts`; `POST/GET /plugins/workflow/transactions` and `PUT /plugins/workflow/transactions/:id/status` from Task 1/2.
- Produces: a route at `/plugins/workflow`, picked up automatically by `src/plugins/loadPlugins.ts`'s glob (no `App.tsx`/`PluginNav` edits needed — that's the existing plugin wiring contract).

This plugin has no automated frontend test suite in this repo (no React
Testing Library / component-test setup exists) — verification is manual via
the dev server, done at the end of this task.

- [ ] **Step 1: Implement the admin page**

Create `plugins/workflow/frontend/pages/WorkflowAdminPage.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { apiFetch, ApiError } from '../../../sdk';

interface Transaction {
  id: number;
  code: string;
  customer_name: string;
  customer_contact: string | null;
  description: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
};
const STATUSES = Object.keys(STATUS_LABELS);

const cellStyle = { padding: '8px 12px', borderBottom: '1px solid #e5e4e7', textAlign: 'left' as const };

export default function WorkflowAdminPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [lastCode, setLastCode] = useState<string | null>(null);

  async function loadTransactions() {
    try {
      const body = await apiFetch<{ transactions: Transaction[] }>('/plugins/workflow/transactions');
      setTransactions(body.transactions);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadTransactions();
  }, []);

  async function handleStatusChange(id: number, status: string) {
    try {
      await apiFetch(`/plugins/workflow/transactions/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
      await loadTransactions();
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '32px 20px 64px' }}>
      <h1>Workflow</h1>
      {error && <p role="alert">{error}</p>}
      <RegisterTransactionForm
        onCreated={async (code) => {
          setLastCode(code);
          await loadTransactions();
        }}
      />
      {lastCode && (
        <p>
          Registered — code for the customer: <strong>{lastCode}</strong>
        </p>
      )}
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th style={cellStyle}>Code</th>
            <th style={cellStyle}>Customer</th>
            <th style={cellStyle}>Description</th>
            <th style={cellStyle}>Status</th>
          </tr>
        </thead>
        <tbody>
          {transactions.map((t) => (
            <tr key={t.id}>
              <td style={cellStyle}><code>{t.code}</code></td>
              <td style={cellStyle}>{t.customer_name}</td>
              <td style={cellStyle}>{t.description ?? ''}</td>
              <td style={cellStyle}>
                <select value={t.status} onChange={(e) => handleStatusChange(t.id, e.target.value)}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>{STATUS_LABELS[s]}</option>
                  ))}
                </select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function RegisterTransactionForm({ onCreated }: { onCreated: (code: string) => Promise<void> }) {
  const [customerName, setCustomerName] = useState('');
  const [customerContact, setCustomerContact] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      const body = await apiFetch<{ transaction: { code: string } }>('/plugins/workflow/transactions', {
        method: 'POST',
        body: JSON.stringify({
          customer_name: customerName,
          customer_contact: customerContact || undefined,
          description: description || undefined,
        }),
      });
      setCustomerName('');
      setCustomerContact('');
      setDescription('');
      await onCreated(body.transaction.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.code : 'unknown_error');
    }
  }

  return (
    <form onSubmit={handleSubmit} style={{ marginBottom: 32, display: 'flex', flexWrap: 'wrap', gap: 12 }}>
      <h2 style={{ flexBasis: '100%' }}>Register transaction</h2>
      {error && <p role="alert" style={{ flexBasis: '100%' }}>{error}</p>}
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Customer name
        <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} required />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Contact (optional)
        <input value={customerContact} onChange={(e) => setCustomerContact(e.target.value)} />
      </label>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        Description (optional)
        <input value={description} onChange={(e) => setDescription(e.target.value)} />
      </label>
      <button type="submit" style={{ alignSelf: 'flex-end' }}>Register</button>
    </form>
  );
}
```

- [ ] **Step 2: Register the route**

Create `plugins/workflow/frontend/routes.tsx`:

```tsx
import type { PluginRoute } from '../../sdk';
import WorkflowAdminPage from './pages/WorkflowAdminPage';

const routes: PluginRoute[] = [
  { path: '/plugins/workflow', element: <WorkflowAdminPage />, requiredPermission: 'manage_users' },
];

export default routes;
```

- [ ] **Step 3: Type-check and build**

Run: `yarn build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 4: Manual verification**

```bash
yarn plugins:sync   # no-op if Task 1-3 already ran it, safe to re-run
npx wrangler d1 migrations apply dryyt-tracker-db --local
yarn dev:worker      # terminal 1
yarn dev              # terminal 2
node script/auth/session.js --base-url http://localhost:5173
```

Open the printed URL to log in as the superadmin, then navigate to
`http://localhost:5173/plugins/workflow` (or use the "Plugins" link on `/`).
Register a transaction with a customer name, contact, and description; confirm
the generated code is shown and the table lists it with status "On hold".
Change its status via the dropdown and confirm the table reflects the new
status after the select's `onChange` fires.

- [ ] **Step 5: Commit**

```bash
git add plugins/workflow/frontend
git commit -m "feat: add workflow admin page (register + status controls)"
```

---

### Task 5: Public homepage with tracking input

**Files:**
- Modify: `src/pages/Home.tsx`
- Modify: `src/App.tsx`
- Modify: `src/assets/sass/home.scss`

**Interfaces:**
- Consumes: `AuthUser` type from `src/lib/useCurrentUser.ts` (now used as `AuthUser | null`), `hasManageUsers`/`hasPermission` from `src/lib/permissions.ts`, `LogoutButton`, `PluginNav`.
- Produces: `Home` now renders for every visitor, logged in or not. Navigating to `/track?code=<value>` — consumed by Task 6's `Track` page.

- [ ] **Step 1: Rewrite Home.tsx**

Replace the full contents of `src/pages/Home.tsx`:

```tsx
import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { AuthUser } from '../lib/useCurrentUser';
import { hasManageUsers } from '../lib/permissions';
import LogoutButton from '../components/LogoutButton';
import PluginNav from '../components/PluginNav';
import '../assets/sass/home.scss';

export default function Home({ user, refresh }: { user: AuthUser | null; refresh: () => Promise<void> }) {
  const navigate = useNavigate();
  const [code, setCode] = useState('');

  function handleTrack(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    navigate(`/track?code=${encodeURIComponent(trimmed)}`);
  }

  return (
    <div className="home">
      {user ? (
        <>
          <h1>Welcome, {user.display_name}</h1>
          <p>Role: {user.role_name}</p>
          <LogoutButton refresh={refresh} className="home__button" />
        </>
      ) : (
        <h1>Track your order</h1>
      )}

      <form className="home__track-form" onSubmit={handleTrack}>
        <label>
          Order code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7K4PXM"
            maxLength={6}
            required
          />
        </label>
        <button type="submit">Track</button>
      </form>

      {user ? (
        <>
          <p>
            <Link to={hasManageUsers(user) ? '/admin' : '/dashboard'}>
              Go to {hasManageUsers(user) ? 'admin console' : 'dashboard'}
            </Link>
          </p>
          <PluginNav user={user} />
        </>
      ) : (
        <p>
          <Link to="/login">Log in</Link> or <Link to="/register">Register</Link>
        </p>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add the tracking-form styles**

Modify `src/assets/sass/home.scss` — insert this block inside the existing
`.home { ... }` rule, after the `&__button { ... }` block and before the
`a { ... }` block:

```scss
  &__track-form {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    justify-content: center;
    flex-wrap: wrap;
    margin: 24px 0;

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 14px;
      color: var(--text);
      text-align: left;
    }

    input {
      font: inherit;
      color: var(--text-h);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      text-transform: uppercase;

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }

    button {
      font: inherit;
      color: var(--text-h);
      background: var(--accent-bg);
      border: 1px solid var(--accent-border);
      border-radius: 6px;
      padding: 7px 16px;
      cursor: pointer;
      transition: border-color 0.2s;

      &:hover {
        border-color: var(--accent);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
  }
```

- [ ] **Step 3: Make `/` public in App.tsx**

Modify `src/App.tsx` — replace the `/` route:

```tsx
        <Route
          path="/"
          element={
            !user ? <Navigate to="/login" replace />
            : hasManageUsers(user) ? <Home user={user} refresh={refresh} />
            : <Navigate to="/dashboard" replace />
          }
        />
```

with:

```tsx
        <Route path="/" element={<Home user={user} refresh={refresh} />} />
```

`hasManageUsers` is still used elsewhere in `App.tsx` (the `/dashboard` and
`/admin` routes), so leave its import in place.

- [ ] **Step 4: Type-check and build**

Run: `yarn build`
Expected: succeeds with no TypeScript errors (confirms `Home`'s new
`AuthUser | null` prop type is compatible with how `App.tsx` calls it).

- [ ] **Step 5: Manual verification**

```bash
yarn dev:worker   # terminal 1
yarn dev          # terminal 2
```

In a logged-out (private/incognito) browser window, open
`http://localhost:5173/` — confirm it renders (no redirect to `/login`) with
the "Track your order" heading, the code input, and Login/Register links. Log
in as the superadmin via `script/auth/session.js` in a normal window and open
`http://localhost:5173/` again — confirm it shows the welcome message, the same
tracking input, and a link to the admin console.

- [ ] **Step 6: Commit**

```bash
git add src/pages/Home.tsx src/App.tsx src/assets/sass/home.scss
git commit -m "feat: make homepage public with order tracking input"
```

---

### Task 6: Public `/track` page

**Files:**
- Create: `src/pages/Track.tsx`
- Create: `src/assets/sass/track.scss`
- Modify: `src/App.tsx`

**Interfaces:**
- Consumes: `apiFetch`, `ApiError` from `src/lib/api.ts`; `GET /plugins/workflow/track/:code` from Task 3; navigates here from Task 5's `Home` via `/track?code=<value>`.

- [ ] **Step 1: Implement the Track page**

Create `src/pages/Track.tsx`:

```tsx
import { useEffect, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router-dom';
import { apiFetch, ApiError } from '../lib/api';
import '../assets/sass/track.scss';

interface TrackedTransaction {
  code: string;
  customer_name: string;
  description: string | null;
  status: string;
  updated_at: string;
}

const STATUS_LABELS: Record<string, string> = {
  hold: 'On hold',
  in_progress: 'In progress',
  done: 'Done',
  ready_to_pickup: 'Ready for pickup',
};

export default function Track() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [code, setCode] = useState(searchParams.get('code') ?? '');
  const [transaction, setTransaction] = useState<TrackedTransaction | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function lookup(lookupCode: string) {
    setLoading(true);
    setError(null);
    setTransaction(null);
    try {
      const body = await apiFetch<{ transaction: TrackedTransaction }>(
        `/plugins/workflow/track/${encodeURIComponent(lookupCode)}`,
      );
      setTransaction(body.transaction);
    } catch (err) {
      setError(err instanceof ApiError && err.status === 404 ? 'not_found' : 'unknown_error');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const initial = searchParams.get('code');
    if (initial) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void lookup(initial);
    }
    // Only run on mount — the form's own submit handler drives later lookups.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = code.trim().toUpperCase();
    if (!trimmed) return;
    setSearchParams({ code: trimmed });
    void lookup(trimmed);
  }

  return (
    <div className="track">
      <h1>Track your order</h1>
      <form className="track__form" onSubmit={handleSubmit}>
        <label>
          Order code
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            placeholder="e.g. 7K4PXM"
            maxLength={6}
            required
          />
        </label>
        <button type="submit">Track</button>
      </form>

      {loading && <p>Looking up…</p>}
      {error === 'not_found' && <p role="alert">No order found for that code.</p>}
      {error === 'unknown_error' && <p role="alert">Something went wrong — try again.</p>}

      {transaction && (
        <div className="track__result">
          <p className="track__status">{STATUS_LABELS[transaction.status] ?? transaction.status}</p>
          <p>Customer: {transaction.customer_name}</p>
          {transaction.description && <p>{transaction.description}</p>}
          <p className="track__updated">Last updated: {new Date(transaction.updated_at).toLocaleString()}</p>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Add its stylesheet**

Create `src/assets/sass/track.scss`:

```scss
.track {
  max-width: 480px;
  margin: 96px auto 0;
  padding: 32px;
  text-align: center;

  &__form {
    display: flex;
    gap: 8px;
    align-items: flex-end;
    justify-content: center;
    flex-wrap: wrap;
    margin-bottom: 24px;

    label {
      display: flex;
      flex-direction: column;
      gap: 4px;
      font-size: 14px;
      color: var(--text);
      text-align: left;
    }

    input {
      font: inherit;
      color: var(--text-h);
      background: var(--bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 6px 10px;
      text-transform: uppercase;

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }

    button {
      font: inherit;
      color: var(--text-h);
      background: var(--accent-bg);
      border: 1px solid var(--accent-border);
      border-radius: 6px;
      padding: 7px 16px;
      cursor: pointer;
      transition: border-color 0.2s;

      &:hover {
        border-color: var(--accent);
      }

      &:focus-visible {
        outline: 2px solid var(--accent);
        outline-offset: 1px;
      }
    }
  }

  &__result {
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-top: 16px;
  }

  &__status {
    font-size: 20px;
    font-weight: 600;
    color: var(--text-h);
  }

  &__updated {
    color: var(--text);
    font-size: 13px;
  }

  p[role='alert'] {
    color: #dc2626;
  }
}
```

- [ ] **Step 3: Register the public route**

Modify `src/App.tsx` — add the import:

```tsx
import Track from './pages/Track'
```

and add the route alongside the other already-public core routes (next to
`/users/:id`):

```tsx
        <Route path="/users/:id" element={<UserPage />} />
        <Route path="/track" element={<Track />} />
```

- [ ] **Step 4: Type-check and build**

Run: `yarn build`
Expected: succeeds with no TypeScript errors.

- [ ] **Step 5: Full end-to-end manual verification**

```bash
yarn plugins:sync
npx wrangler d1 migrations apply dryyt-tracker-db --local
yarn dev:worker   # terminal 1
yarn dev          # terminal 2
```

1. In a normal browser window, log in as superadmin via
   `script/auth/session.js --base-url http://localhost:5173`, go to
   `/plugins/workflow`, register a transaction ("E2E Test", no contact,
   "1x coat"), and copy the generated code.
2. In a separate private/incognito window (logged out), open
   `http://localhost:5173/`, paste the code into the tracking input, and
   submit — confirm it navigates to `/track?code=<CODE>` and shows "On hold",
   the customer name, and the description.
3. Back in the admin window, change the transaction's status to
   "Ready for pickup".
4. In the private window, submit the same code again on `/track` (or reload)
   — confirm the status now shows "Ready for pickup".
5. On `/track`, submit a made-up 6-character code — confirm "No order found
   for that code." renders instead of a crash.

- [ ] **Step 6: Run the full automated test suite one more time**

Run: `yarn test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/pages/Track.tsx src/assets/sass/track.scss src/App.tsx
git commit -m "feat: add public /track order-status page"
```
