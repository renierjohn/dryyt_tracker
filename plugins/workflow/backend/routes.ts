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
    // Secondary sort by id: created_at has only second resolution, so two
    // transactions registered within the same second would otherwise tie and
    // fall back to an unspecified (in practice insertion/ascending) order.
    .prepare('SELECT * FROM workflow_transactions ORDER BY created_at DESC, id DESC')
    .all<WorkflowTransaction>();
  return c.json({ transactions: results });
});

export default workflowRoutes;
