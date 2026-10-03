import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { createUserWithRoleAndLogin, getOwnerRoleId } from '../helpers';

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46]);

async function createTransactionWithCode(cookie: string): Promise<{ id: number; code: string }> {
  const res = await SELF.fetch('https://example.com/api/plugins/workflow/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ customer_name: 'Tracked with photos' }),
  });
  return ((await res.json()) as { transaction: { id: number; code: string } }).transaction;
}

async function createTransaction(cookie: string): Promise<number> {
  const res = await SELF.fetch('https://example.com/api/plugins/workflow/transactions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ customer_name: 'With photos' }),
  });
  return ((await res.json()) as { transaction: { id: number } }).transaction.id;
}

function upload(id: number, bytes: Uint8Array, cookie: string, type = 'image/jpeg') {
  const form = new FormData();
  form.append('file', new File([bytes], 'photo.jpg', { type }));
  return SELF.fetch(`https://example.com/api/plugins/workflow/transactions/${id}/images`, {
    method: 'POST',
    headers: { Cookie: cookie },
    body: form,
  });
}

describe('transaction images', () => {
  it('stores an image, lists it on the transaction and serves it back to the owner', async () => {
    const cookie = await createUserWithRoleAndLogin('wf-img-owner@example.com', await getOwnerRoleId(), 'ImgOwner');
    const id = await createTransaction(cookie);

    const res = await upload(id, JPEG, cookie);
    expect(res.status).toBe(201);
    const { image } = (await res.json()) as { image: { id: number; size: number; content_type: string } };
    expect(image).toMatchObject({ size: JPEG.length, content_type: 'image/jpeg' });

    const list = (await (
      await SELF.fetch('https://example.com/api/plugins/workflow/transactions', { headers: { Cookie: cookie } })
    ).json()) as { transactions: { id: number; image_ids: number[] }[] };
    expect(list.transactions.find((t) => t.id === id)?.image_ids).toEqual([image.id]);

    const served = await SELF.fetch(`https://example.com/api/plugins/workflow/transactions/${id}/images/${image.id}`, {
      headers: { Cookie: cookie },
    });
    expect(served.status).toBe(200);
    expect(served.headers.get('content-type')).toBe('image/jpeg');
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);
  });

  it('rejects files over 1 MB and non-images', async () => {
    const cookie = await createUserWithRoleAndLogin('wf-img-limits@example.com', await getOwnerRoleId(), 'ImgLimits');
    const id = await createTransaction(cookie);

    const big = new Uint8Array(1024 * 1024 + 1);
    big.set(JPEG);
    const tooBig = await upload(id, big, cookie);
    expect(tooBig.status).toBe(400);
    expect(((await tooBig.json()) as { error: string }).error).toBe('file_too_large');

    const notImage = await upload(id, new TextEncoder().encode('<svg onload=alert(1)>'), cookie, 'image/svg+xml');
    expect(((await notImage.json()) as { error: string }).error).toBe('unsupported_file_type');
  });

  it("keeps images private to the transaction's owner", async () => {
    const ownerRole = await getOwnerRoleId();
    const cookie = await createUserWithRoleAndLogin('wf-img-private@example.com', ownerRole, 'ImgPrivate');
    const other = await createUserWithRoleAndLogin('wf-img-other@example.com', ownerRole, 'ImgOther');
    const id = await createTransaction(cookie);
    const { image } = (await (await upload(id, JPEG, cookie)).json()) as { image: { id: number } };

    expect((await upload(id, JPEG, other)).status).toBe(404);
    const url = `https://example.com/api/plugins/workflow/transactions/${id}/images/${image.id}`;
    expect((await SELF.fetch(url, { headers: { Cookie: other } })).status).toBe(404);
    expect((await SELF.fetch(url)).status).toBe(401);
  });

  it('lists and serves photos on the public track-by-code lookup, but only with the right code', async () => {
    const cookie = await createUserWithRoleAndLogin('wf-img-track@example.com', await getOwnerRoleId(), 'ImgTrack');
    const { id, code } = await createTransactionWithCode(cookie);
    const other = await createTransactionWithCode(cookie);
    const { image } = (await (await upload(id, JPEG, cookie)).json()) as { image: { id: number } };

    const lookup = (await (await SELF.fetch(`https://example.com/api/plugins/workflow/track/${code}`)).json()) as {
      transaction: Record<string, unknown>;
    };
    expect(lookup.transaction.image_ids).toEqual([image.id]);
    expect(lookup.transaction.id).toBeUndefined();

    const served = await SELF.fetch(`https://example.com/api/plugins/workflow/track/${code.toLowerCase()}/images/${image.id}`);
    expect(served.status).toBe(200);
    expect(new Uint8Array(await served.arrayBuffer())).toEqual(JPEG);

    const wrongCode = await SELF.fetch(`https://example.com/api/plugins/workflow/track/${other.code}/images/${image.id}`);
    expect(wrongCode.status).toBe(404);
  });
});

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

  it('lists only transactions registered for the signed-in customer, with their photos', async () => {
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
    const imageId = ((await (await upload(mine.transaction.id, JPEG, owner)).json()) as { image: { id: number } }).image.id;

    const res = await json('/api/plugins/workflow/my-transactions', customer);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { transactions: Array<{ code: string; image_ids: number[]; customer_contact?: unknown }> };
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]).toMatchObject({ code: mine.transaction.code, image_ids: [imageId] });
    expect(body.transactions[0].customer_contact).toBeUndefined();

    const photo = await SELF.fetch(
      `https://example.com/api/plugins/workflow/transactions/${mine.transaction.id}/images/${imageId}`,
      { headers: { Cookie: customer } },
    );
    expect(photo.status).toBe(200);
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
