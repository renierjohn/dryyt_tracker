import { Hono } from 'hono';
import { requireAuth, requirePermission, requireRole } from '../../../worker/middleware/auth';
import {
  createUser,
  getActiveOwnerByIdentifier,
  getRoleByName,
  getUserByEmail,
  isOwnerCustomer,
  linkOwnerCustomer,
  findCustomerByContact,
  listOwnerCustomers,
} from '../../../worker/db';
import { isValidContactNumber, isValidEmail } from '../../../worker/util';
import { likePattern, parsePage, PAGE_SIZE } from '../../../worker/pagination';
import type { AppBindings } from '../../../worker/types';
import { sanitizeHtml } from '../../../worker/sanitize';
import { generateToken, hashPassword } from '../../../worker/crypto';
import { generateCode, isValidCode } from './code';

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

// Public lookup by code. Knowing the code is the access check. The registering
// owner's name and store address are included — both are already public on
// their store page.
workflowRoutes.get('/track/:code', async (c) => {
  const code = c.req.param('code').toUpperCase();
  const row = await c.env.DB
    .prepare(
      `SELECT t.code, t.control_number, t.customer_name, t.weight_kg, t.description, t.status, t.updated_at,
              o.display_name AS owner_name, o.address AS owner_address
       FROM workflow_transactions t JOIN users o ON o.id = t.created_by
       WHERE t.code = ?`,
    )
    .bind(code)
    .first<{ description: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: await withSafeDescription(row) });
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
// back NULL — and never done_at. Both are further limited to the open queue
// (in-progress and on-hold); customers follow their own orders through
// /my-transactions and /track/:code. control_number is shown to everyone: it's a
// sequential ticket number, not the code that unlocks /track/:code.
workflowRoutes.get('/owners/:identifier/transactions', async (c) => {
  const owner = await getActiveOwnerByIdentifier(c.env.DB, c.req.param('identifier'));
  if (!owner) return c.json({ error: 'not_found' }, 404);

  const user = c.get('user');
  const stmt = !user
    ? c.env.DB.prepare(
        `SELECT id, control_number, NULL AS code, NULL AS customer_name, NULL AS description, status, created_at
         FROM workflow_transactions WHERE created_by = ? AND status IN ('in_progress', 'hold')
         ORDER BY CASE status WHEN 'in_progress' THEN 0 ELSE 1 END, created_at ASC, id ASC`,
      ).bind(owner.id)
    : (user.role_name === 'user' || user.role_name === 'owner') && user.id !== owner.id
      ? c.env.DB.prepare(
          `SELECT id, control_number,
             CASE WHEN customer_user_id = ?2 THEN code END AS code,
             CASE WHEN customer_user_id = ?2 THEN customer_name END AS customer_name,
             CASE WHEN customer_user_id = ?2 THEN description END AS description,
             status, created_at, updated_at
           FROM workflow_transactions WHERE created_by = ?1 AND status IN ('in_progress', 'hold')
         ORDER BY created_at DESC, id DESC`,
        ).bind(owner.id, user.id)
      : c.env.DB.prepare(
          `SELECT id, control_number, code, customer_name, description, status, created_at, updated_at, done_at
           FROM workflow_transactions WHERE created_by = ? ORDER BY created_at DESC, id DESC`,
        ).bind(owner.id);
  const { results } = await stmt.all<{ description: string | null }>();
  return c.json({
    owner_id: owner.id,
    owner_display_name: owner.display_name,
    transactions: await Promise.all(results.map(withSafeDescription)),
  });
});

const STATUSES = new Set(['hold', 'in_progress', 'done', 'ready_to_pickup', 'end']);

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
  weight_kg: number | null;
  control_number: string | null;
}

// Control numbers are digits, zero-padded to at least 6 ("000001").
const CONTROL_NUMBER_WIDTH = 6;
const formatControlNumber = (n: number) => String(n).padStart(CONTROL_NUMBER_WIDTH, '0');

// The owner's next control number: one past their highest so far.
async function nextControlNumber(db: D1Database, ownerId: number): Promise<string> {
  const row = await db
    .prepare('SELECT MAX(CAST(control_number AS INTEGER)) AS n FROM workflow_transactions WHERE created_by = ?')
    .bind(ownerId)
    .first<{ n: number | null }>();
  return formatControlNumber((row?.n ?? 0) + 1);
}

async function insertWithUniqueCode(
  db: D1Database,
  params: {
    customerName: string;
    customerContact: string | null;
    description: string | null;
    createdBy: number;
    customerUserId: number | null;
    weightKg: number | null;
    // null: assign the owner's next one.
    controlNumber: string | null;
    // Already printed on a slip (see /transactions/new-code); null: generate one.
    code: string | null;
  },
): Promise<WorkflowTransaction | 'duplicate_control_number' | 'duplicate_code'> {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = params.code ?? generateCode();
    const controlNumber = params.controlNumber ?? (await nextControlNumber(db, params.createdBy));
    try {
      const row = await db
        .prepare(
          `INSERT INTO workflow_transactions
             (code, customer_name, customer_contact, description, created_by, customer_user_id, weight_kg, control_number)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?) RETURNING *`,
        )
        .bind(
          code,
          params.customerName,
          params.customerContact,
          params.description,
          params.createdBy,
          params.customerUserId,
          params.weightKg,
          controlNumber,
        )
        .first<WorkflowTransaction>();
      if (row) return row;
    } catch (err) {
      if (!(err instanceof Error && err.message.includes('UNIQUE'))) throw err;
      // A typed control number that's taken is the caller's to fix; an
      // assigned one (or the code) just lost a race — retry.
      if (err.message.includes('control_number') && params.controlNumber !== null) return 'duplicate_control_number';
      if (err.message.includes('code') && params.code !== null) return 'duplicate_code';
    }
  }
  throw new Error('failed to generate a unique code');
}

// Customers registered without an email get <name>@GENERATED_EMAIL_DOMAIN.
const GENERATED_EMAIL_DOMAIN = 'dryyt.com';

// Contact numbers compare by digits only ("0912 345 6789" = "09123456789").
const normalizeContact = (value: string) => value.replace(/\D/g, '');

workflowRoutes.post('/transactions', requirePermission('manage_users'), async (c) => {
  const admin = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const customerName = typeof body?.customer_name === 'string' ? body.customer_name.trim() : '';
  const customerContact =
    typeof body?.customer_contact === 'string' && body.customer_contact.trim() ? body.customer_contact.trim() : null;
  const customerEmail = typeof body?.customer_email === 'string' ? body.customer_email.trim().toLowerCase() : '';
  const description = await cleanDescription(body?.description);
  const rawWeight = body?.weight_kg;
  const weightKg = rawWeight === undefined || rawWeight === null || rawWeight === '' ? null : Number(rawWeight);
  const rawControl = typeof body?.control_number === 'string' ? body.control_number.trim() : '';

  if (!customerName) return c.json({ error: 'missing_customer_name' }, 400);
  if (weightKg !== null && !(Number.isFinite(weightKg) && weightKg > 0 && weightKg <= 10000)) {
    return c.json({ error: 'invalid_weight' }, 400);
  }
  if (rawControl && !/^\d{1,12}$/.test(rawControl)) return c.json({ error: 'invalid_control_number' }, 400);
  const rawCode = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (rawCode && !isValidCode(rawCode)) return c.json({ error: 'invalid_code' }, 400);
  if (customerEmail && !isValidEmail(customerEmail)) return c.json({ error: 'invalid_email' }, 400);
  if (customerContact && !isValidContactNumber(customerContact)) return c.json({ error: 'invalid_contact_number' }, 400);

  // The contact number is the customer's key across all owners: a 'user'
  // account with that number — this owner's, another owner's, or one with no
  // owner — is linked to the transaction and shared with this owner (their
  // other owners keep them). Without a contact number, an email that's already
  // registered is linked when it's one of this owner's users. Otherwise, with
  // a contact number, the customer becomes a new user — under the given email,
  // or <name>@dryyt.com when there's none — with a random password they can
  // replace via forgot-password.
  let customerUserId: number | null = null;
  const byContact = customerContact
    ? await findCustomerByContact(c.env.DB, normalizeContact(customerContact), admin.id)
    : null;
  const byEmail = !byContact && customerEmail ? await getUserByEmail(c.env.DB, customerEmail) : null;
  if (byContact) {
    await linkOwnerCustomer(c.env.DB, admin.id, byContact.id);
    customerUserId = byContact.id;
  } else if (byEmail) {
    if (await isOwnerCustomer(c.env.DB, admin.id, byEmail.id)) customerUserId = byEmail.id;
  } else if (customerContact) {
    const userRole = await getRoleByName(c.env.DB, 'user');
    if (!userRole) return c.json({ error: 'role_not_configured' }, 500);
    const { hash, salt } = await hashPassword(generateToken());
    const create = (email: string) =>
      createUser(c.env.DB, {
        email,
        passwordHash: hash,
        passwordSalt: salt,
        roleId: userRole.id,
        displayName: customerName,
        parentId: admin.id,
        contactNumber: customerContact,
      });
    try {
      if (customerEmail) {
        customerUserId = (await create(customerEmail)).id;
      } else {
        // Same name already taken: juandelacruz2@, juandelacruz3@, ...
        const local = customerName.toLowerCase().replace(/[^a-z0-9]/g, '') || 'customer';
        for (let n = 1; customerUserId === null && n <= 50; n++) {
          try {
            customerUserId = (await create(`${local}${n > 1 ? n : ''}@${GENERATED_EMAIL_DOMAIN}`)).id;
          } catch (err) {
            if (!(err instanceof Error && err.message.includes('UNIQUE'))) throw err;
          }
        }
      }
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
    weightKg: weightKg === null ? null : Math.round(weightKg * 100) / 100,
    controlNumber: rawControl ? formatControlNumber(Number(rawControl)) : null,
    code: rawCode || null,
  });
  if (transaction === 'duplicate_control_number' || transaction === 'duplicate_code') {
    return c.json({ error: transaction }, 409);
  }
  return c.json({ transaction }, 201);
});

// Every transaction of the signed-in owner, oldest first, for the Tracker's
// "Download report" (the file itself is built client-side). email is the
// linked customer account's, when there is one.
workflowRoutes.get('/transactions/export', requirePermission('manage_users'), async (c) => {
  const { results } = await c.env.DB
    .prepare(
      `SELECT t.control_number, t.code, t.customer_name, t.customer_contact, u.email AS customer_email,
              t.weight_kg, t.status, t.created_at, t.done_at
       FROM workflow_transactions t
       LEFT JOIN users u ON u.id = t.customer_user_id
       WHERE t.created_by = ? ORDER BY t.created_at ASC, t.id ASC`,
    )
    .bind(c.get('user')!.id)
    .all();
  return c.json({ transactions: results });
});

// How many of the owner's transactions are in each status, for the Tracker's
// section headers before any section is expanded. Statuses with none are left out.
workflowRoutes.get('/transactions/counts', requirePermission('manage_users'), async (c) => {
  const { results } = await c.env.DB
    .prepare('SELECT status, COUNT(*) AS n FROM workflow_transactions WHERE created_by = ? GROUP BY status')
    .bind(c.get('user')!.id)
    .all<{ status: string; n: number }>();
  return c.json({ counts: Object.fromEntries(results.map((r) => [r.status, r.n])) });
});

// An unused code, for a slip printed before the transaction is registered;
// the form then registers with it. Not reserved — registering with a code
// that got taken in between fails with duplicate_code.
workflowRoutes.get('/transactions/new-code', requirePermission('manage_users'), async (c) => {
  for (let attempt = 0; attempt < 10; attempt++) {
    const code = generateCode();
    const taken = await c.env.DB.prepare('SELECT 1 FROM workflow_transactions WHERE code = ?').bind(code).first();
    if (!taken) return c.json({ code });
  }
  throw new Error('failed to generate a unique code');
});

// The control number the next registration gets if none is typed — the
// register form's placeholder.
workflowRoutes.get('/transactions/next-control-number', requirePermission('manage_users'), async (c) => {
  return c.json({ control_number: await nextControlNumber(c.env.DB, c.get('user')!.id) });
});

// The signed-in owner's own users, for the customer-name autocomplete — each
// with the codes of transactions registered for them. ?contact_number= narrows
// it to the customers with that number (digits only compared) and adds their
// transactions, for the dashboard users list's "View" modal.
workflowRoutes.get('/customers', requirePermission('manage_users'), async (c) => {
  const ownerId = c.get('user')!.id;
  const contactRaw = c.req.query('contact_number');
  const contact = contactRaw === undefined ? null : normalizeContact(contactRaw);
  if (contact === '') return c.json({ error: 'invalid_contact_number' }, 400);

  let users = await listOwnerCustomers(c.env.DB, ownerId);
  if (contact !== null) users = users.filter((u) => u.contact_number && normalizeContact(u.contact_number) === contact);
  if (users.length === 0) return c.json({ customers: [] });
  // Filtered: just those customers' transactions, in full. Otherwise only the
  // codes are needed.
  const ids = users.map((u) => u.id);
  const { results: txns } = await c.env.DB
    .prepare(
      `SELECT ${contact === null ? 'customer_user_id, code' : '*'} FROM workflow_transactions
       WHERE created_by = ? AND customer_user_id IS NOT NULL
         ${contact === null ? '' : `AND customer_user_id IN (${ids.map(() => '?').join(', ')})`}
       ORDER BY created_at DESC, id DESC`,
    )
    .bind(ownerId, ...(contact === null ? [] : ids))
    .all<WorkflowTransaction>();
  const byCustomer = new Map<number, WorkflowTransaction[]>();
  for (const t of txns) byCustomer.set(t.customer_user_id!, [...(byCustomer.get(t.customer_user_id!) ?? []), t]);
  return c.json({
    customers: users.map((u) => {
      const own = byCustomer.get(u.id) ?? [];
      return {
        id: u.id,
        display_name: u.display_name,
        email: u.email,
        contact_number: u.contact_number,
        codes: own.map((t) => t.code),
        ...(contact !== null && {
          transactions: own.map((t) => ({
            id: t.id,
            control_number: t.control_number,
            code: t.code,
            weight_kg: t.weight_kg,
            status: t.status,
            created_at: t.created_at,
            done_at: t.done_at,
          })),
        }),
      };
    }),
  });
});

// The owner's own transactions, newest first. Without ?status=, every
// transaction that isn't 'end' (the open work — unpaginated). With
// ?status=<status>, only that status, a page of 10 at a time (?page=), plus
// total/page/page_size — the Tracker's "End" section grows without bound.
workflowRoutes.get('/transactions', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const status = c.req.query('status');
  if (status !== undefined && !STATUSES.has(status)) return c.json({ error: 'invalid_status' }, 400);

  // Secondary sort by id: created_at has only second resolution, so two
  // transactions registered within the same second would otherwise tie and
  // fall back to an unspecified (in practice insertion/ascending) order.
  const order = 'ORDER BY created_at DESC, id DESC';
  let results: WorkflowTransaction[];
  let paging: { page: number; page_size: number; total: number } | null = null;
  if (status === undefined) {
    ({ results } = await c.env.DB
      .prepare(`SELECT * FROM workflow_transactions WHERE created_by = ? AND status != 'end' ${order}`)
      .bind(user.id)
      .all<WorkflowTransaction>());
  } else {
    const { page, limit, offset } = parsePage(c.req.query('page'));
    const [rows, count] = await c.env.DB.batch([
      c.env.DB
        .prepare(`SELECT * FROM workflow_transactions WHERE created_by = ? AND status = ? ${order} LIMIT ? OFFSET ?`)
        .bind(user.id, status, limit, offset),
      c.env.DB
        .prepare('SELECT COUNT(*) AS n FROM workflow_transactions WHERE created_by = ? AND status = ?')
        .bind(user.id, status),
    ]);
    results = rows.results as WorkflowTransaction[];
    paging = { page, page_size: PAGE_SIZE, total: (count.results[0] as { n: number }).n };
  }

  return c.json({ ...paging, transactions: await Promise.all(results.map(withSafeDescription)) });
});

// Superadmin console: every transaction across all owners, newest first, with
// the registering owner and (when linked) the customer's account. Paginated:
// ?page=, ?q= (order #, code, owner, customer/user name or email), ?status=.
workflowRoutes.get('/admin/transactions', requireRole('superadmin'), async (c) => {
  const { page, limit, offset } = parsePage(c.req.query('page'));
  const q = c.req.query('q')?.trim() ?? '';
  const status = c.req.query('status') ?? '';
  const where: string[] = [];
  const binds: unknown[] = [];
  if (q) {
    where.push(
      `(CAST(t.id AS TEXT) = ? OR t.code LIKE ?2 ESCAPE '\\' OR o.display_name LIKE ?2 ESCAPE '\\'
        OR t.customer_name LIKE ?2 ESCAPE '\\' OR u.display_name LIKE ?2 ESCAPE '\\' OR u.email LIKE ?2 ESCAPE '\\')`,
    );
    binds.push(q.replace(/^#/, ''), likePattern(q));
  }
  if (STATUSES.has(status)) {
    where.push(`t.status = ?${binds.length + 1}`);
    binds.push(status);
  }
  const from = `FROM workflow_transactions t
       JOIN users o ON o.id = t.created_by
       LEFT JOIN users u ON u.id = t.customer_user_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}`;
  const n = binds.length;
  const [rows, count] = await c.env.DB.batch([
    c.env.DB
      .prepare(
        `SELECT t.id, t.code, t.status, t.customer_name, t.created_at,
                o.id AS owner_id, o.display_name AS owner_name,
                u.id AS user_id, u.display_name AS user_name, u.email AS user_email
         ${from} ORDER BY t.created_at DESC, t.id DESC LIMIT ?${n + 1} OFFSET ?${n + 2}`,
      )
      .bind(...binds, limit, offset),
    c.env.DB.prepare(`SELECT COUNT(*) AS n ${from}`).bind(...binds),
  ]);
  return c.json({
    page,
    page_size: PAGE_SIZE,
    total: (count.results[0] as { n: number }).n,
    transactions: rows.results,
  });
});

// Superadmin console: permanently delete every transaction created more than
// 3 months ago. { dry_run: true } only counts.
workflowRoutes.post('/admin/transactions/purge-old', requireRole('superadmin'), async (c) => {
  const body = await c.req.json().catch(() => null);
  const dryRun = body?.dry_run === true;
  // One cutoff for every statement below, so they all agree on the set.
  const cutoff = (await c.env.DB.prepare("SELECT datetime('now', '-3 months') AS t").first<{ t: string }>())!.t;

  const counts = await c.env.DB
    .prepare('SELECT COUNT(*) AS transactions FROM workflow_transactions WHERE created_at < ?')
    .bind(cutoff)
    .first<{ transactions: number }>();
  const result = { cutoff, transactions: counts?.transactions ?? 0 };
  if (dryRun || result.transactions === 0) return c.json({ ...result, dry_run: dryRun });

  await c.env.DB.prepare('DELETE FROM workflow_transactions WHERE created_at < ?').bind(cutoff).run();
  return c.json({ ...result, dry_run: false });
});

// Superadmin console: one transaction in full.
workflowRoutes.get('/admin/transactions/:id', requireRole('superadmin'), async (c) => {
  const row = await c.env.DB
    .prepare(
      `SELECT t.*, o.display_name AS owner_name, o.email AS owner_email,
              u.display_name AS user_name, u.email AS user_email
       FROM workflow_transactions t
       JOIN users o ON o.id = t.created_by
       LEFT JOIN users u ON u.id = t.customer_user_id
       WHERE t.id = ?`,
    )
    .bind(Number(c.req.param('id')))
    .first<{ id: number; description: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: await withSafeDescription(row) });
});

// A customer's own view: transactions registered for them (customer_user_id),
// across whichever owners registered them — each with that owner's name.
// Contact/created_by stay server-side.
workflowRoutes.get('/my-transactions', requireAuth, async (c) => {
  const user = c.get('user')!;
  const { results } = await c.env.DB
    .prepare(
      `SELECT t.id, t.control_number, t.code, t.weight_kg, t.customer_name, t.description, t.status,
              t.created_at, t.updated_at, t.done_at, o.display_name AS owner_name
       FROM workflow_transactions t JOIN users o ON o.id = t.created_by
       WHERE t.customer_user_id = ? ORDER BY t.created_at DESC, t.id DESC`,
    )
    .bind(user.id)
    .all<{ id: number; description: string | null }>();
  return c.json({ transactions: await Promise.all(results.map(withSafeDescription)) });
});

workflowRoutes.put('/transactions/:id/status', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const id = Number(c.req.param('id'));
  const body = await c.req.json().catch(() => null);
  const status = typeof body?.status === 'string' ? body.status : '';

  if (!STATUSES.has(status)) return c.json({ error: 'invalid_status' }, 400);

  const row = await c.env.DB
    .prepare(
      // done_at: stamped on the first move to 'done' (or straight to 'end'),
      // kept through 'ready_to_pickup'/'end', cleared if the work is reopened
      // (hold/in_progress).
      `UPDATE workflow_transactions SET
         status = ?1,
         updated_at = datetime('now'),
         done_at = CASE ?1
           WHEN 'done' THEN COALESCE(done_at, datetime('now'))
           WHEN 'ready_to_pickup' THEN done_at
           WHEN 'end' THEN COALESCE(done_at, datetime('now'))
           ELSE NULL
         END
       WHERE id = ?2 AND created_by = ?3 RETURNING *`,
    )
    .bind(status, id, user.id)
    .first<WorkflowTransaction>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  return c.json({ transaction: row });
});

// Pickup by scanned code: the owner scans the QR on the customer's /track page,
// and only one of their own transactions that's 'ready_to_pickup' moves to 'end'.
workflowRoutes.post('/pickup', requirePermission('manage_users'), async (c) => {
  const user = c.get('user')!;
  const body = await c.req.json().catch(() => null);
  const code = typeof body?.code === 'string' ? body.code.trim().toUpperCase() : '';
  if (!code) return c.json({ error: 'missing_code' }, 400);

  const row = await c.env.DB
    .prepare(
      `UPDATE workflow_transactions SET
         status = 'end',
         updated_at = datetime('now'),
         done_at = COALESCE(done_at, datetime('now'))
       WHERE code = ?1 AND created_by = ?2 AND status = 'ready_to_pickup' RETURNING *`,
    )
    .bind(code, user.id)
    .first<WorkflowTransaction>();
  if (row) return c.json({ transaction: row });

  const existing = await c.env.DB
    .prepare('SELECT status FROM workflow_transactions WHERE code = ? AND created_by = ?')
    .bind(code, user.id)
    .first<{ status: string }>();
  if (!existing) return c.json({ error: 'not_found' }, 404);
  return c.json({ error: 'not_ready_for_pickup', status: existing.status }, 409);
});

export default workflowRoutes;
