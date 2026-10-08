import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getOwnerRoleId } from '../helpers';

async function createTransaction(cookie: string): Promise<number> {
  const res = await SELF.fetch('https://example.com/api/plugins/workflow/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ customer_name: 'Purge candidate' }),
  });
  return ((await res.json()) as { transaction: { id: number } }).transaction.id;
}

describe("customer's own transactions", () => {
  async function json(path: string, cookie: string, init: RequestInit = {}) {
    return SELF.fetch(`https://example.com${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
    });
  }

  async function login(email: string): Promise<string> {
    const res = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'password123' }),
    });
    return res.headers.get('set-cookie')!.split(';')[0];
  }

  it('lists only transactions registered for the signed-in customer', async () => {
    const owner = await createUserWithRoleAndLogin('my-txn-owner@example.com', await getOwnerRoleId(), 'Owner');
    await json('/api/owner/users', owner, {
      method: 'POST',
      body: JSON.stringify({ email: 'my-txn-cust@example.com', password: 'password123', display_name: 'Cust' }),
    });
    const customer = await login('my-txn-cust@example.com');

    const mine = (await (await json('/api/plugins/workflow/transactions', owner, {
      method: 'POST',
      body: JSON.stringify({ customer_name: 'Cust', customer_email: 'my-txn-cust@example.com' }),
    })).json()) as { transaction: { id: number; code: string } };
    await json('/api/plugins/workflow/transactions', owner, {
      method: 'POST',
      body: JSON.stringify({ customer_name: 'Someone else' }),
    });

    const res = await json('/api/plugins/workflow/my-transactions', customer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: Array<{ code: string; customer_contact?: unknown }> };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ code: mine.transaction.code, owner_name: 'Owner', weight_kg: null });
    expect((body.transactions[0] as { control_number?: string }).control_number).toMatch(/^\d{6}$/);
    expect(body.transactions[0].customer_contact).toBeUndefined();
    // Still can't list/manage the owner's transactions.
    expect((await json('/api/plugins/workflow/transactions', customer)).status).toBe(403);
  });

  it('requires a session', async () => {
    expect((await SELF.fetch('https://example.com/api/plugins/workflow/my-transactions')).status).toBe(401);
  });
});

describe("owner page for a 'user'-role customer", () => {
  it('redacts code/customer/description except on their own transactions', async () => {
    const owner = await createUserWithRoleAndLogin('redact-owner@example.com', await getOwnerRoleId(), 'RedactOwner');
    const post = (path: string, body: unknown) =>
      SELF.fetch(`https://example.com${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: owner },
        body: JSON.stringify(body),
      });
    await post('/api/owner/users', { email: 'redact-cust@example.com', password: 'password123', display_name: 'Cust' });
    const login = await SELF.fetch('https://example.com/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: 'redact-cust@example.com', password: 'password123' }),
    });
    const customer = login.headers.get('set-cookie')!.split(';')[0];
    const mine = ((await (await post('/api/plugins/workflow/transactions', {
      customer_name: 'Cust', customer_email: 'redact-cust@example.com', description: 'Mine',
    })).json()) as { transaction: { id: number; code: string } }).transaction;
    await post('/api/plugins/workflow/transactions', { customer_name: 'Other', description: 'Theirs' });

    const res = await SELF.fetch('https://example.com/api/plugins/workflow/owners/RedactOwner/transactions', {
      headers: { Cookie: customer },
    });
    const body = (await res.json()) as {
      transactions: Array<{ id: number; code: string | null; customer_name: string | null; description: string | null }>;
    };
    expect(body.transactions).toHaveLength(2);
    const own = body.transactions.find((t) => t.id === mine.id)!;
    expect(own).toMatchObject({ code: mine.code, customer_name: 'Cust' });
    const other = body.transactions.find((t) => t.id !== mine.id)!;
    expect(other).toMatchObject({ code: null, customer_name: null, description: null });
  });

  it('only lists in-progress and on-hold transactions, their own included', async () => {
    const owner = await createUserWithRoleAndLogin('status-cust-owner@example.com', await getOwnerRoleId(), 'StatusCustOwner');
    const customer = await createUserWithRoleAndLogin('status-cust@example.com', 2, 'StatusCust');
    const customerId = (await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind('status-cust@example.com').first<{ id: number }>())!.id;
    for (const status of ['hold', 'in_progress', 'done', 'ready_to_pickup', 'end']) {
      const id = await createTransaction(owner);
      await env.DB.prepare('UPDATE workflow_transactions SET status = ?, customer_user_id = ? WHERE id = ?')
        .bind(status, customerId, id)
        .run();
    }

    const res = await SELF.fetch('https://example.com/api/plugins/workflow/owners/StatusCustOwner/transactions', {
      headers: { Cookie: customer },
    });
    const body = (await res.json()) as { transactions: Array<{ status: string }> };
    expect(body.transactions.map((t) => t.status).sort()).toEqual(['hold', 'in_progress']);
  });
});

describe('owner page viewed by another owner', () => {
  it('redacts code/customer/description and done_at', async () => {
    const ownerA = await createUserWithRoleAndLogin('redact2-a@example.com', await getOwnerRoleId(), 'Redact2A');
    const ownerB = await createUserWithRoleAndLogin('redact2-b@example.com', await getOwnerRoleId(), 'Redact2B');
    await SELF.fetch('https://example.com/api/plugins/workflow/transactions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: ownerA },
      body: JSON.stringify({ customer_name: 'A customer', description: 'Secret' }),
    });
    const res = await SELF.fetch('https://example.com/api/plugins/workflow/owners/Redact2A/transactions', {
      headers: { Cookie: ownerB },
    });
    const body = (await res.json()) as { transactions: Array<Record<string, unknown>> };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ code: null, customer_name: null, description: null });
    expect(body.transactions[0].done_at).toBeUndefined();

    const own = await SELF.fetch('https://example.com/api/plugins/workflow/owners/Redact2A/transactions', {
      headers: { Cookie: ownerA },
    });
    const ownBody = (await own.json()) as { transactions: Array<{ customer_name: string }> };
    expect(ownBody.transactions[0].customer_name).toBe('A customer');
  });
});

describe('POST /api/plugins/workflow/admin/transactions/purge-old', () => {
  it('deletes transactions over 3 months old, keeping newer ones', async () => {
    const owner = await createUserWithRoleAndLogin('purge-owner@example.com', await getOwnerRoleId(), 'PurgeOwner');
    const oldId = await createTransaction(owner);
    const newId = await createTransaction(owner);
    await env.DB.prepare("UPDATE workflow_transactions SET created_at = datetime('now', '-4 months') WHERE id = ?").bind(oldId).run();

    const superCookie = await createUserWithRoleAndLogin('purge-super@example.com', 1, 'Super');
    const purge = (body: unknown, cookie = superCookie) =>
      SELF.fetch('https://example.com/api/plugins/workflow/admin/transactions/purge-old', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: cookie },
        body: JSON.stringify(body),
      });

    expect((await purge({}, owner)).status).toBe(403);

    const preview = (await (await purge({ dry_run: true })).json()) as { transactions: number; dry_run: boolean };
    expect(preview).toMatchObject({ dry_run: true });
    expect(preview.transactions).toBeGreaterThanOrEqual(1);
    expect(await env.DB.prepare('SELECT id FROM workflow_transactions WHERE id = ?').bind(oldId).first()).not.toBeNull();

    const res = await purge({});
    expect(res.status).toBe(200);
    expect(await env.DB.prepare('SELECT id FROM workflow_transactions WHERE id = ?').bind(oldId).first()).toBeNull();
    expect(await env.DB.prepare('SELECT id FROM workflow_transactions WHERE id = ?').bind(newId).first()).not.toBeNull();
  });
});
