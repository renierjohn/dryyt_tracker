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
