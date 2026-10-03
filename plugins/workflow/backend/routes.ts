import { Hono } from 'hono';
import { requireAuth, requirePermission } from '../../../worker/middleware/auth';
import {
  createUser,
  getActiveOwnerByIdentifier,
  getRoleByName,
  getUserByEmail,
  listUsersByParent,
} from '../../../worker/db';
import { isValidContactNumber, isValidEmail } from '../../../worker/util';
import type { AppBindings } from '../../../worker/types';
import { sanitizeHtml } from '../../../worker/sanitize';
import { detectImageMimeType } from '../../../worker/image';
import { generateToken, hashPassword } from '../../../worker/crypto';
import { generateCode } from './code';

// description is rich text (CKEditor HTML), sanitized on write. Rows written
// before that were plain text, stored unsanitized — so every read sanitizes
// again before the frontend renders it as HTML.
async function withSafeDescription<T extends { description?: unknown }>(row: T): Promise<T> {
  return typeof row.description === 'string' ? { ...row, description: await sanitizeHtml(row.description, 'rich') } : row;
}

// Sanitized HTML, or null when it has no visible text (e.g. CKEditor's "<p>&nbsp;</p>").
async function cleanDescription(raw: unknown): Promise<string | null> {
  if (typeof raw !== 'string') return null;
  const html = (await sanitizeHtml(raw, 'rich')).trim();
  // An image, table or rule counts as content even without text.
  const text = html.replace(/<(?!img|hr|table)[^>]*>/g, '').replace(/&nbsp;|\s/g, '');
  return text ? html : null;
}

// Endpoints here have mixed auth: a public lookup (added in a later task)
// alongside admin-only registration/listing/status-changes — so middleware is
// applied per-route below rather than once via `.use('*', ...)` the way
// single-purpose plugin routers (e.g. hello, alerts) do it.
const workflowRoutes = new Hono<AppBindings>();

// Public lookup by code. Knowing the code is the access check, so this also
// lists the transaction's photo ids — served by the route below, which only
// returns a photo when it belongs to the transaction with that code.
workflowRoutes.get('/track/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const row = await c.env.DB
    .prepare('SELECT id, code, customer_name, description, status, updated_at FROM workflow_transactions WHERE code = ?')
    .bind(code)
    .first<{ id: number; description: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const { results: images } = await c.env.DB
    .prepare('SELECT id FROM workflow_transaction_images WHERE transaction_id = ? ORDER BY id')
    .bind(row.id)
    .all<{ id: number }>();
  // The internal id stays server-side; photos are addressed by code.
  const transaction: Record<string, unknown> = { ...(await withSafeDescription(row)) };
  delete transaction.id;
  return c.json({ transaction: { ...transaction, image_ids: images.map((i) => i.id) } });
});

workflowRoutes.get('/track/:code/images/:imageId', async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT i.r2_key, i.content_type FROM workflow_transaction_images i
       JOIN workflow_transactions t ON t.id = i.transaction_id
       WHERE i.id = ? AND t.code = ?`,
    )
    .bind(Number(c.req.param('imageId')), c.req.param('code').toUpperCase())
    .first<{ r2_key: string; content_type: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const object = await c.env.TRANSACTION_IMAGES.get(row.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': row.content_type,
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

// Public: the read-only view reached from an owner's card on the homepage
// (see src/components/OwnersList.tsx → /owner/:identifier, aliased from
// /plugins/workflow/:identifier). identifier is either the owner's id or
// their display_name — see getActiveOwnerByIdentifier. Same created_by
// scoping as the authenticated /transactions above — an owner's own
// transactions are exactly those they registered themselves — but with
// customer_contact/created_by left out, matching the /track/:code redaction
// above, and no create/status-edit access. Anonymous visitors only see the
// open queue — in-progress first, then on-hold, each oldest first — with the
// identifying fields (code/customer/description) and done_at withheld, so the
// page can show queue position without exposing whose order is whose.
// Signed-in visitors get every transaction, newest first — in full, except
// for 'user'-role customers and other owners: they only see code/customer/
// description on their own transactions (customer_user_id) — the rest come
// back NULL — and never done_at.
workflowRoutes.get('/owners/:identifier/transactions', async (c) => {
  const owner = await getActiveOwnerByIdentifier(c.env.DB, c.req.param('identifier'));
  if (!owner) return c.json({ error: 'not_found' }, 404);

  const user = c.get('user');
  const stmt = !user
    ? c.env.DB.prepare(
        `SELECT id, NULL AS code, NULL AS customer_name, NULL AS description, status, created_at
         FROM workflow_transactions WHERE created_by = ? AND status IN ('in_progress', 'hold')
         ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, created_at ASC, id ASC`,
      ).bind(owner.id)
    : (user.role_name === 'user' || user.role_name === 'owner') && user.id !== owner.id
      ? c.env.DB.prepare(
          `SELECT id,
             CASE WHEN customer_user_id = ?2 THEN code END AS code,
             CASE WHEN customer_user_id = ?2 THEN customer_name END AS customer_name,
             CASE WHEN customer_user_id = ?2 THEN description END AS description,
             status, created_at, updated_at
           FROM workflow_transactions WHERE created_by = ?1 ORDER BY created_at DESC, id DESC`,
        ).bind(owner.id, user.id)
      : c.env.DB.prepare(
          `SELECT id, code, customer_name, description, status, created_at, updated_at, done_at
           FROM workflow_transactions WHERE created_by = ? ORDER BY created_at DESC, id DESC`,
        ).bind(owner.id);
  const { results } = await stmt.all<{ description: string | null }>();
  return c.json({
    owner_id: owner.id,
    owner_display_name: owner.display_name,
    transactions: await Promise.all(results.map(withSafeDescription)),
  });
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
  done_at: string | null;
  customer_user_id: number | null;
}

async function insertWithUniqueCode(
  db: D1Database,
  params: {
    customerName: string;
    customerContact: string | null;
    description: string | null;
    createdBy: number;
    customerUserId: number | null;
  },
): Promise<WorkflowTransaction> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    try {
      const row = await db
        .prepare(
          `INSERT INTO workflow_transactions (code, customer_name, customer_contact, description, created_by, customer_user_id)
           VALUES (?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .bind(code, params.customerName, params.customerContact, params.description, params.createdBy, params.customerUserId)
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
  const customerEmail = typeof body?.customer_email === 'string' ? body.customer_email.trim().toLowerCase() : '';
  const description = await cleanDescription(body?.description);

  if (!customerName) return c.json({ error: 'missing_customer_name' }, 400);
  if (customerEmail && !isValidEmail(customerEmail)) return c.json({ error: 'invalid_email' }, 400);
  if (customerContact && !isValidContactNumber(customerContact)) return c.json({ error: 'invalid_contact_number' }, 400);

  // With an email, the customer also becomes one of this owner's users (role
  // 'user', parent_id = owner) — unless that email is already registered.
  // They get a random password and can set their own via forgot-password.
  // The transaction is linked to that user only when it's one of this owner's.
  let customerUserId: number | null = null;
  const existing = customerEmail ? await getUserByEmail(c.env.DB, customerEmail) : null;
  if (existing) {
    if (existing.parent_id === admin.id) customerUserId = existing.id;
  } else if (customerEmail) {
    const userRole = await getRoleByName(c.env.DB, 'user');
    if (!userRole) return c.json({ error: 'role_not_configured' }, 500);
    const { hash, salt } = await hashPassword(generateToken());
    try {
      const created = await createUser(c.env.DB, {
        email: customerEmail,
        passwordHash: hash,
        passwordSalt: salt,
        roleId: userRole.id,
        displayName: customerName,
        parentId: admin.id,
      });
      customerUserId = created.id;
    } catch (err) {
      // Registered concurrently — same outcome as "already exists".
      if (!(err instanceof Error && err.message.includes('UNIQUE'))) throw err;
    }
  }

  const transaction = await insertWithUniqueCode(c.env.DB, {
    customerName,
    customerContact,
    description,
    createdBy: admin.id,
    customerUserId,
  });
  return c.json({ transaction }, 201);
});

// The signed-in owner's own users, for the customer-name autocomplete and the
// dashboard users list — each with the codes of transactions registered for them.
workflowRoutes.get('/customers', requirePermission('manage_users'), async (c) => {
  const ownerId = c.get('user')!.id;
  const users = await listUsersByParent(c.env.DB, ownerId);
  const { results: txns } = await c.env.DB
    .prepare(
      `SELECT customer_user_id, code FROM workflow_transactions
       WHERE created_by = ? AND customer_user_id IS NOT NULL ORDER BY created_at DESC, id DESC`,
    )
    .bind(ownerId)
    .all<{ customer_user_id: number; code: string }>();
  const codes = new Map<number, string[]>();
  for (const t of txns) codes.set(t.customer_user_id, [...(codes.get(t.customer_user_id) ?? []), t.code]);
  return c.json({
    customers: users.map((u) => ({
      id: u.id,
      display_name: u.display_name,
      email: u.email,
      codes: codes.get(u.id) ?? [],
    })),
  });
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
  const { results: images } = await c.env.DB
    .prepare(
      `SELECT i.id, i.transaction_id FROM workflow_transaction_images i
       JOIN workflow_transactions t ON t.id = i.transaction_id
       WHERE t.created_by = ? ORDER BY i.id`,
    )
    .bind(user.id)
    .all<{ id: number; transaction_id: number }>();
  const imageIds = new Map<number, number[]>();
  for (const img of images) {
    imageIds.set(img.transaction_id, [...(imageIds.get(img.transaction_id) ?? []), img.id]);
  }
  const transactions = await Promise.all(results.map(withSafeDescription));
  return c.json({ transactions: transactions.map((t) => ({ ...t, image_ids: imageIds.get(t.id) ?? [] })) });
});

// A customer's own view: transactions registered for them (customer_user_id),
// across whichever owners registered them. Contact/created_by stay server-side.
workflowRoutes.get('/my-transactions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB
    .prepare(
      `SELECT id, code, customer_name, description, status, created_at, updated_at, done_at
       FROM workflow_transactions WHERE customer_user_id = ? ORDER BY created_at DESC, id DESC`,
    )
    .bind(user.id)
    .all<{ id: number; description: string | null }>();
  const { results: images } = await c.env.DB
    .prepare(
      `SELECT i.id, i.transaction_id FROM workflow_transaction_images i
       JOIN workflow_transactions t ON t.id = i.transaction_id
       WHERE t.customer_user_id = ? ORDER BY i.id`,
    )
    .bind(user.id)
    .all<{ id: number; transaction_id: number }>();
  const imageIds = new Map<number, number[]>();
  for (const img of images) {
    imageIds.set(img.transaction_id, [...(imageIds.get(img.transaction_id) ?? []), img.id]);
  }
  const transactions = await Promise.all(results.map(withSafeDescription));
  return c.json({ transactions: transactions.map((t) => ({ ...t, image_ids: imageIds.get(t.id) ?? [] })) });
});

// Photos attached to a transaction. Private: only the owner who registered it
// can add or view them. The client resizes before upload; this cap is the
// backstop.
export const MAX_TRANSACTION_IMAGE_BYTES = 1024 * 1024;
const MAX_IMAGES_PER_TRANSACTION = 10;
const IMAGE_EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

async function getOwnTransaction(db: D1Database, id: number, userId: number) {
  return db
    .prepare('SELECT id FROM workflow_transactions WHERE id = ? AND created_by = ?')
    .bind(id, userId)
    .first<{ id: number }>();
}

workflowRoutes.post('/transactions/:id/images', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const transaction = await getOwnTransaction(c.env.DB, Number(c.req.param('id')), user.id);
  if (!transaction) return c.json({ error: 'not_found' }, 404);

  const body = await c.req.parseBody();
  const file = body['file'];
  if (!(file instanceof File)) return c.json({ error: 'missing_file' }, 400);
  if (file.size > MAX_TRANSACTION_IMAGE_BYTES) return c.json({ error: 'file_too_large' }, 400);

  const bytes = new Uint8Array(await file.arrayBuffer());
  const mimeType = detectImageMimeType(bytes);
  if (!mimeType) return c.json({ error: 'unsupported_file_type' }, 400);

  const count = await c.env.DB
    .prepare('SELECT COUNT(*) AS n FROM workflow_transaction_images WHERE transaction_id = ?')
    .bind(transaction.id)
    .first<{ n: number }>();
  if ((count?.n ?? 0) >= MAX_IMAGES_PER_TRANSACTION) return c.json({ error: 'too_many_images' }, 400);

  const key = `${transaction.id}-${generateToken()}.${IMAGE_EXTENSIONS[mimeType]}`;
  await c.env.TRANSACTION_IMAGES.put(key, bytes, { httpMetadata: { contentType: mimeType } });
  const image = await c.env.DB
    .prepare(
      `INSERT INTO workflow_transaction_images (transaction_id, r2_key, content_type, size)
       VALUES (?, ?, ?, ?) RETURNING id, transaction_id, content_type, size, created_at`,
    )
    .bind(transaction.id, key, mimeType, bytes.length)
    .first();
  return c.json({ image }, 201);
});

// Viewable by the owner who registered the transaction or the customer it was
// registered for.
workflowRoutes.get('/transactions/:id/images/:imageId', requireAuth, async (c) => {
  const user = c.get('user')!;
  const row = await c.env.DB
    .prepare(
      `SELECT i.r2_key, i.content_type FROM workflow_transaction_images i
       JOIN workflow_transactions t ON t.id = i.transaction_id
       WHERE i.id = ?1 AND i.transaction_id = ?2 AND (t.created_by = ?3 OR t.customer_user_id = ?3)`,
    )
    .bind(Number(c.req.param('imageId')), Number(c.req.param('id')), user.id)
    .first<{ r2_key: string; content_type: string }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  const object = await c.env.TRANSACTION_IMAGES.get(row.r2_key);
  if (!object) return c.json({ error: 'not_found' }, 404);
  return new Response(object.body, {
    headers: {
      'Content-Type': row.content_type,
      // Private to the signed-in owner/customer — never a shared cache.
      'Cache-Control': 'private, max-age=86400',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});

workflowRoutes.put('/transactions/:id/status', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';

  if (!STATUSES.has(status)) return c.json({ error: 'invalid_status' }, 400);

  const row = await c.env.DB
    .prepare(
      // done_at: stamped on the first move to 'done', kept through
      // 'ready_to_pickup', cleared if the work is reopened (hold/in_progress).
      `UPDATE workflow_transactions SET
         status = ?1,
         updated_at = datetime('now'),
         done_at = CASE ?1
           WHEN 'done' THEN COALESCE(done_at, datetime('now'))
           WHEN 'ready_to_pickup' THEN done_at
           ELSE NULL
         END
       WHERE id = ?2 AND created_by = ?3 RETURNING *`,
    )
    .bind(status, id, user.id)
    .first<WorkflowTransaction>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});

export default workflowRoutes;
