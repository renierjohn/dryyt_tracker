import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getAdminRoleId, getOwnerRoleId } from '../helpers';

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

  it('returns 401 on transaction routes for a caller with no session at all', async () => {
    expect((await req('GET', '/api/plugins/workflow/transactions')).status).toBe(401);
    expect((await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'X' })).status).toBe(401);
    expect((await req('PUT', '/api/plugins/workflow/transactions/1/status', { status: 'done' })).status).toBe(401);
  });
});

describe('POST /api/plugins/workflow/transactions', () => {
  it('creates a transaction with a generated code and defaults status to hold', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-create@example.com', adminRoleId, 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Jane Doe', customer_contact: '09123456789', description: '2x shirts',
    }, adminCookie);
    expect(res.status).toBe(201);
    const body = (await res.json()) as { transaction: { code: string; status: string; customer_name: string } };
    expect(body.transaction.code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    expect(body.transaction.status).toBe('hold');
    expect(body.transaction.customer_name).toBe('Jane Doe');
  });

  it('assigns sequential control numbers per owner unless one is typed, and stores the weight', async () => {
    const owner = await createUserWithRoleAndLogin('workflow-control@example.com', await getAdminRoleId(), 'Admin');
    const other = await createUserWithRoleAndLogin('workflow-control-other@example.com', await getAdminRoleId(), 'Admin2');
    const create = async (body: Record<string, unknown>, cookie = owner) =>
      req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Walk-in', ...body }, cookie);
    const next = async (cookie = owner) =>
      ((await (await req('GET', '/api/plugins/workflow/transactions/next-control-number', undefined, cookie)).json()) as {
        control_number: string;
      }).control_number;
    type Txn = { transaction: { control_number: string; weight_kg: number | null } };

    expect(await next()).toBe('000001');
    const first = (await (await create({ weight_kg: '2.456' })).json()) as Txn;
    expect(first.transaction).toMatchObject({ control_number: '000001', weight_kg: 2.46 });
    expect(await next()).toBe('000002');

    const typed = (await (await create({ control_number: '41' })).json()) as Txn;
    expect(typed.transaction).toMatchObject({ control_number: '000041', weight_kg: null });
    expect(await next()).toBe('000042');
    // Another owner has their own sequence.
    expect(await next(other)).toBe('000001');

    expect((await create({ control_number: '000041' })).status).toBe(409);
    expect((await create({ control_number: 'A1' })).status).toBe(400);
    expect((await create({ weight_kg: -1 })).status).toBe(400);
  });

  it('registers under a code fetched beforehand for a printed slip', async () => {
    const owner = await createUserWithRoleAndLogin('workflow-printed-code@example.com', await getAdminRoleId(), 'Admin');
    const { code } = (await (await req('GET', '/api/plugins/workflow/transactions/new-code', undefined, owner)).json()) as {
      code: string;
    };
    expect(code).toMatch(/^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{6}$/);
    const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Slip', code: code.toLowerCase() }, owner);
    expect(res.status).toBe(201);
    expect(((await res.json()) as { transaction: { code: string } }).transaction.code).toBe(code);

    expect((await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Again', code }, owner)).status).toBe(409);
    expect((await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Bad', code: 'O0O0O0' }, owner)).status).toBe(400);
  });

  it("exports all of the owner's transactions with the linked customer's email", async () => {
    const owner = await createUserWithRoleAndLogin('workflow-export@example.com', await getAdminRoleId(), 'Admin');
    const other = await createUserWithRoleAndLogin('workflow-export-other@example.com', await getAdminRoleId(), 'Admin2');
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'First', customer_contact: '09175550001', weight_kg: 3.5 }, owner);
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Walk-in' }, owner);
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Not mine' }, other);

    const res = await req('GET', '/api/plugins/workflow/transactions/export', undefined, owner);
    expect(res.status).toBe(200);
    const { transactions } = (await res.json()) as { transactions: Array<Record<string, unknown>> };
    expect(transactions).toEqual([
      expect.objectContaining({
        control_number: '000001', customer_name: 'First', customer_contact: '09175550001', customer_email: 'first@dryyt.com', weight_kg: 3.5, status: 'hold', done_at: null,
      }),
      expect.objectContaining({ control_number: '000002', customer_name: 'Walk-in', customer_contact: null, customer_email: null, weight_kg: null }),
    ]);
    expect((await req('GET', '/api/plugins/workflow/transactions/export')).status).toBe(401);
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

describe('customer email registration', () => {
  it("registers name+contact as the owner's user once, keyed by contact, and lists it under /customers", async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-owner@example.com', adminRoleId, 'Admin');
    const first = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Cust One', customer_contact: '0912 345 6700', customer_email: 'Cust1@Example.com',
    }, adminCookie);
    expect(first.status).toBe(201);
    // Same number, formatted differently and without an email: linked, not re-created.
    const again = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Other Name', customer_contact: '09123456700',
    }, adminCookie);
    expect(again.status).toBe(201);

    const res = await req('GET', '/api/plugins/workflow/customers', undefined, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      customers: Array<{ display_name: string; email: string; contact_number: string | null; codes: string[] }>;
    };
    const codes = await Promise.all([first, again].map(async (r) => ((await r.json()) as { transaction: { code: string } }).transaction.code));
    expect(body.customers).toEqual([
      expect.objectContaining({
        display_name: 'Cust One', email: 'cust1@example.com', contact_number: '0912 345 6700', codes: [codes[1], codes[0]],
      }),
    ]);
  });

  it('narrows to one customer by ?contact_number= (digits only) and includes their transactions', async () => {
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-filter@example.com', await getAdminRoleId(), 'Admin');
    for (const [name, contact] of [['Filter A', '09184440001'], ['Filter B', '09184440002'], ['Filter A', '0918 444 0001']]) {
      expect((await req('POST', '/api/plugins/workflow/transactions', { customer_name: name, customer_contact: contact }, adminCookie)).status).toBe(201);
    }
    type List = { customers: Array<{ display_name: string; transactions?: Array<{ code: string; status: string }> }> };
    const res = await req('GET', '/api/plugins/workflow/customers?contact_number=0918-444-0001', undefined, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as List;
    expect(body.customers).toHaveLength(1);
    expect(body.customers[0].display_name).toBe('Filter A');
    expect(body.customers[0].transactions).toHaveLength(2);
    expect(body.customers[0].transactions![0]).toMatchObject({ status: 'hold', weight_kg: null });

    const none = (await (await req('GET', '/api/plugins/workflow/customers?contact_number=09990000000', undefined, adminCookie)).json()) as List;
    expect(none.customers).toEqual([]);
    expect((await req('GET', '/api/plugins/workflow/customers?contact_number=abc', undefined, adminCookie)).status).toBe(400);
  });

  it('generates <name>@dryyt.com when there is no email, numbering repeats of a name', async () => {
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-gen@example.com', await getAdminRoleId(), 'Admin');
    for (const contact of ['09170000001', '09170000002']) {
      const res = await req('POST', '/api/plugins/workflow/transactions', {
        customer_name: '  Juan  Dela Cruz ', customer_contact: contact,
      }, adminCookie);
      expect(res.status).toBe(201);
    }
    const list = (await (await req('GET', '/api/plugins/workflow/customers', undefined, adminCookie)).json()) as {
      customers: Array<{ email: string; contact_number: string }>;
    };
    expect(list.customers.map((c) => [c.email, c.contact_number]).sort()).toEqual([
      ['juandelacruz2@dryyt.com', '09170000002'],
      ['juandelacruz@dryyt.com', '09170000001'],
    ]);
  });

  it('does not register a customer without a contact number', async () => {
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-nocontact@example.com', await getAdminRoleId(), 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Walk-in', customer_email: 'walkin-nocontact@example.com',
    }, adminCookie);
    expect(res.status).toBe(201);
    const list = (await (await req('GET', '/api/plugins/workflow/customers', undefined, adminCookie)).json()) as {
      customers: unknown[];
    };
    expect(list.customers).toEqual([]);
  });

  it('skips registration for an email that already exists', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-owner2@example.com', adminRoleId, 'Admin');
    await createUserWithRoleAndLogin('workflow-cust-existing@example.com', 2, 'Existing');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Existing', customer_email: 'workflow-cust-existing@example.com',
    }, adminCookie);
    expect(res.status).toBe(201);
    const list = (await (await req('GET', '/api/plugins/workflow/customers', undefined, adminCookie)).json()) as {
      customers: unknown[];
    };
    expect(list.customers).toEqual([]);
  });

  it('rejects an invalid contact number with 400', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-badcontact@example.com', adminRoleId, 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'X', customer_contact: 'call me',
    }, adminCookie);
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe('invalid_contact_number');
  });

  it('rejects an invalid email with 400', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-bad@example.com', adminRoleId, 'Admin');
    const res = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'X', customer_email: 'nope',
    }, adminCookie);
    expect(res.status).toBe(400);
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

describe('GET /api/plugins/workflow/track/:code', () => {
  it('returns the transaction status with no auth required, omitting contact/created_by', async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-track@example.com', adminRoleId, 'Admin');
    const createRes = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Track Target', customer_contact: '09998887777', description: 'Trousers', weight_kg: 2.5,
    }, adminCookie);
    const created = (await createRes.json()) as { transaction: { code: string } };

    const res = await SELF.fetch(`https://example.com/api/plugins/workflow/track/${created.transaction.code.toLowerCase()}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: Record<string, unknown> };
    expect(body.transaction.customer_name).toBe('Track Target');
    expect(body.transaction.weight_kg).toBe(2.5);
    expect(body.transaction.status).toBe('hold');
    expect(body.transaction.control_number).toMatch(/^\d{6}$/);
    expect(body.transaction.owner_name).toBe('Admin');
    expect(body.transaction.owner_address).toBeNull();
    expect(body.transaction.customer_contact).toBeUndefined();
    expect(body.transaction.created_by).toBeUndefined();
  });

  it('returns 404 for an unknown code', async () => {
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/track/ZZZZZZ');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/plugins/workflow/owners/:ownerId/transactions', () => {
  it("lists an owner's own transactions, omitting contact/created_by", async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('workflow-public-owner@example.com', ownerRoleId, 'Owner');
    const me = (await (await req('GET', '/api/auth/me', undefined, ownerCookie)).json()) as { user: { id: number } };

    await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Public Target', customer_contact: '09998887777', description: 'Shoes',
    }, ownerCookie);

    // Signed in (any session) to get identifying fields — anonymous visitors get them withheld.
    const res = await req('GET', `/api/plugins/workflow/owners/${me.user.id}/transactions`, undefined, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner_display_name: string; transactions: Array<Record<string, unknown>> };
    expect(body.owner_display_name).toBe('Owner');
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0].customer_name).toBe('Public Target');
    expect(body.transactions[0].customer_contact).toBeUndefined();
    expect(body.transactions[0].created_by).toBeUndefined();
  });

  it('sanitizes rich-text descriptions and drops empty ones', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const cookie = await createUserWithRoleAndLogin('workflow-rich@example.com', ownerRoleId, 'RichOwner');
    const rich = (await (await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Rich', description: '<p><strong>2x</strong> shirts<img src=x onerror=alert(1)></p><script>alert(1)</script>',
    }, cookie)).json()) as { transaction: { description: string | null } };
    expect(rich.transaction.description).toBe('<p><strong>2x</strong> shirts</p>');

    const empty = (await (await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Empty', description: '<p>&nbsp;</p>',
    }, cookie)).json()) as { transaction: { description: string | null } };
    expect(empty.transaction.description).toBeNull();
  });

  it('stamps done_at on the move to done, keeps it through pickup, clears it on reopen', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const cookie = await createUserWithRoleAndLogin('workflow-done-at@example.com', ownerRoleId, 'DoneAtOwner');
    const created = (await (await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Timed' }, cookie)).json()) as {
      transaction: { id: number; done_at: string | null };
    };
    expect(created.transaction.done_at).toBeNull();
    const setStatus = async (status: string) =>
      ((await (await req('PUT', `/api/plugins/workflow/transactions/${created.transaction.id}/status`, { status }, cookie)).json()) as {
        transaction: { done_at: string | null };
      }).transaction.done_at;

    expect(await setStatus('in_progress')).toBeNull();
    const doneAt = await setStatus('done');
    expect(doneAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    expect(await setStatus('ready_to_pickup')).toBe(doneAt);
    expect(await setStatus('in_progress')).toBeNull();
  });

  it('shows anonymous visitors only in-progress then on-hold, oldest first', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('workflow-public-queue@example.com', ownerRoleId, 'QueueOwner');
    const create = async (name: string, status: string, createdAt: string) => {
      const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: name }, ownerCookie);
      const { transaction } = (await res.json()) as { transaction: { id: number } };
      await env.DB.prepare('UPDATE workflow_transactions SET status = ?, created_at = ? WHERE id = ?')
        .bind(status, createdAt, transaction.id)
        .run();
    };
    await create('Hold new', 'hold', '2026-01-04 00:00:00');
    await create('Progress new', 'in_progress', '2026-01-03 00:00:00');
    await create('Done', 'done', '2026-01-01 00:00:00');
    await create('Hold old', 'hold', '2026-01-02 00:00:00');
    await create('Progress old', 'in_progress', '2026-01-01 00:00:00');
    await create('Pickup', 'ready_to_pickup', '2026-01-01 00:00:00');

    const anon = (await (await SELF.fetch('https://example.com/api/plugins/workflow/owners/QueueOwner/transactions')).json()) as {
      transactions: Array<Record<string, unknown>>;
    };
    expect(anon.transactions.map((t) => [t.status, t.created_at])).toEqual([
      ['in_progress', '2026-01-01 00:00:00'],
      ['in_progress', '2026-01-03 00:00:00'],
      ['hold', '2026-01-02 00:00:00'],
      ['hold', '2026-01-04 00:00:00'],
    ]);
    for (const t of anon.transactions) {
      expect(t.control_number).toMatch(/^\d{6}$/);
      expect(t.code).toBeNull();
      expect(t.customer_name).toBeNull();
      expect(t.description).toBeNull();
      expect(t.done_at).toBeUndefined();
    }

    const signedIn = (await (await req('GET', '/api/plugins/workflow/owners/QueueOwner/transactions', undefined, ownerCookie)).json()) as {
      transactions: unknown[];
    };
    expect(signedIn.transactions).toHaveLength(6);
  });

  it('shows another owner only in-progress and on-hold transactions', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('workflow-rival-target@example.com', ownerRoleId, 'RivalTarget');
    const rivalCookie = await createUserWithRoleAndLogin('workflow-rival-viewer@example.com', ownerRoleId, 'RivalViewer');
    for (const status of ['hold', 'in_progress', 'done', 'ready_to_pickup', 'end']) {
      const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: status }, ownerCookie);
      const { transaction } = (await res.json()) as { transaction: { id: number } };
      await env.DB.prepare('UPDATE workflow_transactions SET status = ? WHERE id = ?').bind(status, transaction.id).run();
    }

    const rival = (await (await req('GET', '/api/plugins/workflow/owners/RivalTarget/transactions', undefined, rivalCookie)).json()) as {
      transactions: Array<Record<string, unknown>>;
    };
    expect(rival.transactions.map((t) => t.status).sort()).toEqual(['hold', 'in_progress']);
    for (const t of rival.transactions) expect(t.customer_name).toBeNull();

    const self = (await (await req('GET', '/api/plugins/workflow/owners/RivalTarget/transactions', undefined, ownerCookie)).json()) as {
      transactions: unknown[];
    };
    expect(self.transactions).toHaveLength(5);
  });

  it('returns 404 for a non-owner user id', async () => {
    const plainCookie = await createUserWithRoleAndLogin('workflow-public-plain@example.com', 2, 'Plain');
    const me = (await (await req('GET', '/api/auth/me', undefined, plainCookie)).json()) as { user: { id: number } };
    const res = await SELF.fetch(`https://example.com/api/plugins/workflow/owners/${me.user.id}/transactions`);
    expect(res.status).toBe(404);
  });

  it('returns 404 for an unknown owner id', async () => {
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/owners/999999/transactions');
    expect(res.status).toBe(404);
  });

  it('also resolves by the owner\'s display_name (the /owner/:identifier alias)', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const ownerCookie = await createUserWithRoleAndLogin('workflow-public-byname@example.com', ownerRoleId, 'NameLookupOwner');
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'By Name' }, ownerCookie);

    const res = await req('GET', '/api/plugins/workflow/owners/NameLookupOwner/transactions', undefined, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { owner_display_name: string; transactions: Array<{ customer_name: string }> };
    expect(body.owner_display_name).toBe('NameLookupOwner');
    expect(body.transactions[0].customer_name).toBe('By Name');
  });

  it('returns 404 for an unknown display_name', async () => {
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/owners/NoSuchOwner/transactions');
    expect(res.status).toBe(404);
  });
});

describe('GET /api/plugins/workflow/admin/transactions', () => {
  it('lists every owner’s transactions for the superadmin only', async () => {
    const ownerCookie = await createUserWithRoleAndLogin('admin-txn-owner@example.com', await getOwnerRoleId(), 'AdminTxnOwner');
    const created = (await (await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Walk-in',
    }, ownerCookie)).json()) as { transaction: { id: number; code: string } };

    const superCookie = await createUserWithRoleAndLogin('admin-txn-super@example.com', 1, 'Super');
    const res = await req('GET', '/api/plugins/workflow/admin/transactions', undefined, superCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: Array<{ id: number; code: string; owner_name: string; user_id: number | null }> };
    expect(body.transactions.find((t) => t.id === created.transaction.id)).toMatchObject({
      code: created.transaction.code, owner_name: 'AdminTxnOwner', user_id: null,
    });

    expect((await req('GET', '/api/plugins/workflow/admin/transactions', undefined, ownerCookie)).status).toBe(403);
  });

  it('pages by 10 and filters by search and status', async () => {
    const ownerCookie = await createUserWithRoleAndLogin('admin-txn-page-owner@example.com', await getOwnerRoleId(), 'PagedTxnOwner');
    const ids: number[] = [];
    for (let i = 0; i < 11; i++) {
      const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: `Paged txn ${i}` }, ownerCookie);
      ids.push(((await res.json()) as { transaction: { id: number } }).transaction.id);
    }
    await req('PUT', `/api/plugins/workflow/transactions/${ids[0]}/status`, { status: 'done' }, ownerCookie);
    const superCookie = await createUserWithRoleAndLogin('admin-txn-page-super@example.com', 1, 'Super');
    type Page = { page: number; total: number; transactions: Array<{ id: number }> };
    const get = async (qs: string) =>
      (await (await req('GET', `/api/plugins/workflow/admin/transactions?${qs}`, undefined, superCookie)).json()) as Page;

    const first = await get('q=PagedTxnOwner');
    expect(first.total).toBe(11);
    expect(first.transactions).toHaveLength(10);
    expect((await get('q=PagedTxnOwner&page=2')).transactions).toHaveLength(1);
    expect((await get('q=PagedTxnOwner&status=done')).transactions.map((t) => t.id)).toEqual([ids[0]]);
    expect((await get(`q=%23${ids[3]}`)).transactions.map((t) => t.id)).toContain(ids[3]);
  });
});

describe('GET /api/plugins/workflow/admin/transactions/:id', () => {
  it('returns one transaction in full for the superadmin only', async () => {
    const ownerCookie = await createUserWithRoleAndLogin('admin-txn-detail-owner@example.com', await getOwnerRoleId(), 'DetailOwner');
    const created = (await (await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Walk-in', customer_contact: '09123456789', description: 'Two shirts',
    }, ownerCookie)).json()) as { transaction: { id: number } };
    const superCookie = await createUserWithRoleAndLogin('admin-txn-detail-super@example.com', 1, 'Super');

    const res = await req('GET', `/api/plugins/workflow/admin/transactions/${created.transaction.id}`, undefined, superCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: Record<string, unknown> };
    expect(body.transaction).toMatchObject({
      owner_name: 'DetailOwner', customer_contact: '09123456789',
    });
    expect((await req('GET', `/api/plugins/workflow/admin/transactions/${created.transaction.id}`, undefined, ownerCookie)).status).toBe(403);
    expect((await req('GET', '/api/plugins/workflow/admin/transactions/999999', undefined, superCookie)).status).toBe(404);
  });
});

describe('end status', () => {
  it('accepts end, stamping done_at when skipping straight to it and keeping an earlier one', async () => {
    const adminCookie = await createUserWithRoleAndLogin('workflow-end@example.com', await getAdminRoleId(), 'Admin');
    const create = async () =>
      ((await (await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'End' }, adminCookie)).json()) as {
        transaction: { id: number };
      }).transaction.id;
    type Txn = { transaction: { status: string; done_at: string | null } };
    const setStatus = async (id: number, status: string) =>
      (await (await req('PUT', `/api/plugins/workflow/transactions/${id}/status`, { status }, adminCookie)).json()) as Txn;

    const direct = await create();
    const ended = await setStatus(direct, 'end');
    expect(ended.transaction.status).toBe('end');
    expect(ended.transaction.done_at).not.toBeNull();

    const viaDone = await create();
    const done = await setStatus(viaDone, 'done');
    expect((await setStatus(viaDone, 'end')).transaction.done_at).toBe(done.transaction.done_at);
  });
});

describe('GET /api/plugins/workflow/transactions by status', () => {
  it('leaves end out of the default list and pages ?status=end by 10', async () => {
    const adminCookie = await createUserWithRoleAndLogin('workflow-end-page@example.com', await getAdminRoleId(), 'Admin');
    const ids: number[] = [];
    for (let i = 0; i < 12; i++) {
      const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: `End page ${i}` }, adminCookie);
      ids.push(((await res.json()) as { transaction: { id: number } }).transaction.id);
    }
    for (const id of ids.slice(0, 11)) {
      await req('PUT', `/api/plugins/workflow/transactions/${id}/status`, { status: 'end' }, adminCookie);
    }
    type Page = { total?: number; page?: number; page_size?: number; transactions: Array<{ id: number; status: string }> };
    const get = async (qs: string) =>
      (await (await req('GET', `/api/plugins/workflow/transactions${qs}`, undefined, adminCookie)).json()) as Page;

    const open = await get('');
    expect(open.transactions.map((t) => t.id)).toEqual([ids[11]]);
    expect(open.total).toBeUndefined();

    const first = await get('?status=end');
    expect(first).toMatchObject({ total: 11, page: 1, page_size: 10 });
    expect(first.transactions).toHaveLength(10);
    expect(first.transactions.every((t) => t.status === 'end')).toBe(true);
    expect((await get('?status=end&page=2')).transactions).toHaveLength(1);

    expect((await req('GET', '/api/plugins/workflow/transactions?status=bogus', undefined, adminCookie)).status).toBe(400);
  });
});

describe('GET /api/plugins/workflow/transactions/counts', () => {
  it("counts the owner's own transactions per status", async () => {
    const ownerCookie = await createUserWithRoleAndLogin('workflow-counts@example.com', await getOwnerRoleId(), 'Owner');
    const otherCookie = await createUserWithRoleAndLogin('workflow-counts-other@example.com', await getOwnerRoleId(), 'Other');
    await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Not mine' }, otherCookie);
    const ids: number[] = [];
    for (let i = 0; i < 3; i++) {
      const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: `Count ${i}` }, ownerCookie);
      ids.push(((await res.json()) as { transaction: { id: number } }).transaction.id);
    }
    await req('PUT', `/api/plugins/workflow/transactions/${ids[0]}/status`, { status: 'end' }, ownerCookie);

    const res = await req('GET', '/api/plugins/workflow/transactions/counts', undefined, ownerCookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ counts: { hold: 2, end: 1 } });
  });
});

describe('POST /api/plugins/workflow/pickup', () => {
  async function setup(email: string) {
    const ownerCookie = await createUserWithRoleAndLogin(email, await getOwnerRoleId(), 'Owner');
    const createRes = await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Pickup Target' }, ownerCookie);
    const { transaction } = (await createRes.json()) as { transaction: { id: number; code: string } };
    return { ownerCookie, transaction };
  }

  it("ends the owner's ready_to_pickup transaction matching the scanned code", async () => {
    const { ownerCookie, transaction } = await setup('workflow-pickup@example.com');
    await req('PUT', `/api/plugins/workflow/transactions/${transaction.id}/status`, { status: 'ready_to_pickup' }, ownerCookie);

    const res = await req('POST', '/api/plugins/workflow/pickup', { code: transaction.code.toLowerCase() }, ownerCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transaction: { status: string; done_at: string | null } };
    expect(body.transaction.status).toBe('end');
    expect(body.transaction.done_at).not.toBeNull();
  });

  it('rejects a transaction that is not ready for pickup with 409', async () => {
    const { ownerCookie, transaction } = await setup('workflow-pickup-notready@example.com');
    const res = await req('POST', '/api/plugins/workflow/pickup', { code: transaction.code }, ownerCookie);
    expect(res.status).toBe(409);
    expect(((await res.json()) as { error: string }).error).toBe('not_ready_for_pickup');
  });

  it("returns 404 for another owner's code", async () => {
    const { ownerCookie, transaction } = await setup('workflow-pickup-a@example.com');
    await req('PUT', `/api/plugins/workflow/transactions/${transaction.id}/status`, { status: 'ready_to_pickup' }, ownerCookie);
    const otherCookie = await createUserWithRoleAndLogin('workflow-pickup-b@example.com', await getOwnerRoleId(), 'Other');
    const res = await req('POST', '/api/plugins/workflow/pickup', { code: transaction.code }, otherCookie);
    expect(res.status).toBe(404);
  });
});

describe('customers shared between owners', () => {
  type Txn = { transaction: { customer_user_id: number | null } };
  const register = async (cookie: string, customer_name: string, customer_contact: string) =>
    ((await (await req('POST', '/api/plugins/workflow/transactions', { customer_name, customer_contact }, cookie)).json()) as Txn)
      .transaction.customer_user_id;
  const customerIds = async (cookie: string) =>
    ((await (await req('GET', '/api/owner/users', undefined, cookie)).json()) as { users: Array<{ id: number; is_active: number }> })
      .users;
  const parentOf = async (id: number) =>
    (await env.DB.prepare('SELECT parent_id FROM users WHERE id = ?').bind(id).first<{ parent_id: number | null }>())!.parent_id;
  const idOf = async (cookie: string) =>
    ((await (await req('GET', '/api/auth/me', undefined, cookie)).json()) as { user: { id: number } }).user.id;

  it("links another owner's customer with the same contact number", async () => {
    const ownerRoleId = await getOwnerRoleId();
    const a = await createUserWithRoleAndLogin('share-a@example.com', ownerRoleId, 'ShareA');
    const b = await createUserWithRoleAndLogin('share-b@example.com', ownerRoleId, 'ShareB');

    const customerId = (await register(a, 'Shared Juan', '0917 111 2222'))!;
    expect(await register(b, '  shared juan ', '09171112222')).toBe(customerId);

    expect((await customerIds(a)).map((u) => u.id)).toContain(customerId);
    expect((await customerIds(b)).map((u) => u.id)).toContain(customerId);
    expect(await parentOf(customerId)).toBe(await idOf(a));
    // Registering again doesn't duplicate the link.
    expect(await register(b, 'Shared Juan', '09171112222')).toBe(customerId);
    expect((await customerIds(b)).filter((u) => u.id === customerId)).toHaveLength(1);
  });

  it('links a customer with no owner and makes this owner their home owner', async () => {
    const b = await createUserWithRoleAndLogin('share-orphan-b@example.com', await getOwnerRoleId(), 'OrphanB');
    const orphan = await env.DB
      .prepare(
        `INSERT INTO users (email, password_hash, password_salt, role_id, display_name, contact_number)
         VALUES ('orphan@example.com', 'x', 'x', (SELECT id FROM roles WHERE name = 'user'), 'Orphan Ana', '0918-333-4444')
         RETURNING id`,
      )
      .first<{ id: number }>();

    expect(await register(b, 'Orphan Ana', '09183334444')).toBe(orphan!.id);
    expect(await parentOf(orphan!.id)).toBe(await idOf(b));
  });

  it('matches on contact number alone, whatever name the transaction uses', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const a = await createUserWithRoleAndLogin('share-name-a@example.com', ownerRoleId, 'NameA');
    const b = await createUserWithRoleAndLogin('share-name-b@example.com', ownerRoleId, 'NameB');
    const first = await register(a, 'Pedro One', '09195556666');
    expect(first).not.toBeNull();
    expect(await register(b, 'Pedro Two', '+0919-555-6666')).toBe(first);
  });

  it('registers no customer account without a contact number', async () => {
    const a = await createUserWithRoleAndLogin('share-nocontact@example.com', await getOwnerRoleId(), 'NoContact');
    const res = await req('POST', '/api/plugins/workflow/transactions', { customer_name: 'Walk In' }, a);
    expect(((await res.json()) as Txn).transaction.customer_user_id).toBeNull();
  });

  it('delete unlinks a shared customer, and deactivates once only one owner is left', async () => {
    const ownerRoleId = await getOwnerRoleId();
    const a = await createUserWithRoleAndLogin('share-del-a@example.com', ownerRoleId, 'DelA');
    const b = await createUserWithRoleAndLogin('share-del-b@example.com', ownerRoleId, 'DelB');
    const customerId = (await register(a, 'Del Carla', '09207778888'))!;
    await register(b, 'Del Carla', '09207778888');

    // The home owner leaves: the customer stays active, now homed with B.
    expect((await req('DELETE', `/api/owner/users/${customerId}`, undefined, a)).status).toBe(200);
    expect((await customerIds(a)).map((u) => u.id)).not.toContain(customerId);
    expect((await customerIds(b)).find((u) => u.id === customerId)?.is_active).toBe(1);
    expect(await parentOf(customerId)).toBe(await idOf(b));

    expect((await req('DELETE', `/api/owner/users/${customerId}`, undefined, b)).status).toBe(200);
    expect((await customerIds(b)).find((u) => u.id === customerId)?.is_active).toBe(0);
  });
});
