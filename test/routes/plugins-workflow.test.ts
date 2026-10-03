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
  it("registers name+email as the owner's user once, and lists it under /customers", async () => {
    const adminRoleId = await getAdminRoleId();
    const adminCookie = await createUserWithRoleAndLogin('workflow-cust-owner@example.com', adminRoleId, 'Admin');
    const first = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Cust One', customer_email: 'Cust1@Example.com',
    }, adminCookie);
    expect(first.status).toBe(201);
    const again = await req('POST', '/api/plugins/workflow/transactions', {
      customer_name: 'Other Name', customer_email: 'cust1@example.com',
    }, adminCookie);
    expect(again.status).toBe(201);

    const res = await req('GET', '/api/plugins/workflow/customers', undefined, adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { customers: Array<{ display_name: string; email: string; codes: string[] }> };
    const codes = await Promise.all([first, again].map(async (r) => ((await r.json()) as { transaction: { code: string } }).transaction.code));
    expect(body.customers).toEqual([
      expect.objectContaining({ display_name: 'Cust One', email: 'cust1@example.com', codes: [codes[1], codes[0]] }),
    ]);
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
      customer_name: 'Track Target', customer_contact: '09998887777', description: 'Trousers',
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
      owner_name: 'DetailOwner', customer_contact: '09123456789', image_ids: [],
    });
    expect((await req('GET', `/api/plugins/workflow/admin/transactions/${created.transaction.id}`, undefined, ownerCookie)).status).toBe(403);
    expect((await req('GET', '/api/plugins/workflow/admin/transactions/999999', undefined, superCookie)).status).toBe(404);
  });
});
