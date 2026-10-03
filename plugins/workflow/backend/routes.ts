import { Hono } from 'hono';
import { requirePermission } from '../../../worker/middleware/auth';
import { getActiveOwnerByIdentifier } from '../../../worker/db';
import type { AppBindings } from '../../../worker/types';
import { generateCode } from './code';

// Endpoints here have mixed auth: a public lookup (added in a later task)
// alongside admin-only registration/listing/status-changes — so middleware is
// applied per-route below rather than once via `.use('*', ...)` the way
// single-purpose plugin routers (e.g. hello, alerts) do it.
const workflowRoutes = new Hono<AppBindings>();

workflowRoutes.get('/track/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const row = await c.env.DB
    .prepare('SELECT code, customer_name, description, status, updated_at FROM workflow_transactions WHERE code = ?')
    .bind(code)
    .first();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});

// Public: the read-only view reached from an owner's card on the homepage
// (see src/components/OwnersList.tsx → /owner/:identifier, aliased from
// /plugins/workflow/:identifier). identifier is either the owner's id or
// their display_name — see getActiveOwnerByIdentifier. Same created_by
// scoping as the authenticated /transactions above — an owner's own
// transactions are exactly those they registered themselves — but with
// customer_contact/created_by left out, matching the /track/:code redaction
// above, and no create/status-edit access.
workflowRoutes.get('/owners/:identifier/transactions', async (c) => {
  const owner = await getActiveOwnerByIdentifier(c.env.DB, c.req.param('identifier'));
  if (!owner) return c.json({ error: 'not_found' }, 404);

  const { results } = await c.env.DB
    .prepare(
      `SELECT id, code, customer_name, description, status, created_at, updated_at
       FROM workflow_transactions WHERE created_by = ? ORDER BY created_at DESC, id DESC`,
    )
    .bind(owner.id)
    .all();
  return c.json({ owner_id: owner.id, owner_display_name: owner.display_name, transactions: results });
});

const STATUSES = new Set(['hold', 'in_progress', 'done', 'ready_to_pickup']);

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
  const user = c.get('user')!;
  const { results } = await c.env.DB
    // Secondary sort by id: created_at has only second resolution, so two
    // transactions registered within the same second would otherwise tie and
    // fall back to an unspecified (in practice insertion/ascending) order.
    .prepare('SELECT * FROM workflow_transactions WHERE created_by = ? ORDER BY created_at DESC, id DESC')
    .bind(user.id)
    .all<WorkflowTransaction>();
  return c.json({ transactions: results });
});

workflowRoutes.put('/transactions/:id/status', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';

  if (!STATUSES.has(status)) return c.json({ error: 'invalid_status' }, 400);

  const row = await c.env.DB
    .prepare(
      `UPDATE workflow_transactions SET status = ?, updated_at = datetime('now')
       WHERE id = ? AND created_by = ? RETURNING *`,
    )
    .bind(status, id, user.id)
    .first<WorkflowTransaction>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});

export default workflowRoutes;
