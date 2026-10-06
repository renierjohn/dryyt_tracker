import { afterEach, describe, expect, it, vi } from 'vitest';
import { verifyTurnstile } from '../worker/turnstile';
import type { Env } from '../worker/types';

const env = { TURNSTILE_SECRET_KEY: 'secret', DEV_MODE: 'false' } as Env;
const req = new Request('https://app.dryyt.com/api/auth/login', { method: 'POST' });

function mockSiteverify(body: unknown, status = 200) {
  return vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify(body), { status }));
}

describe('verifyTurnstile', () => {
  afterEach(() => vi.restoreAllMocks());

  it('accepts a successful token for the same action and hostname', async () => {
    mockSiteverify({ success: true, action: 'login', hostname: 'app.dryyt.com' });
    expect(await verifyTurnstile(env, req, 'tok', 'login')).toBe(true);
  });

  it('rejects a token minted for another action', async () => {
    mockSiteverify({ success: true, action: 'register', hostname: 'app.dryyt.com' });
    expect(await verifyTurnstile(env, req, 'tok', 'login')).toBe(false);
  });

  it('rejects a token minted on another hostname', async () => {
    mockSiteverify({ success: true, action: 'login', hostname: 'evil.example' });
    expect(await verifyTurnstile(env, req, 'tok', 'login')).toBe(false);
  });

  it('rejects a failed or replayed token', async () => {
    mockSiteverify({ success: false, 'error-codes': ['timeout-or-duplicate'] });
    expect(await verifyTurnstile(env, req, 'tok', 'login')).toBe(false);
  });

  it('fails closed when siteverify errors', async () => {
    mockSiteverify({}, 500);
    expect(await verifyTurnstile(env, req, 'tok', 'login')).toBe(false);
  });

  it('rejects a missing token without calling siteverify', async () => {
    const spy = mockSiteverify({ success: true });
    expect(await verifyTurnstile(env, req, undefined, 'login')).toBe(false);
    expect(spy).not.toHaveBeenCalled();
  });

  it('without a secret, only passes in DEV_MODE', async () => {
    expect(await verifyTurnstile({ DEV_MODE: 'true' } as Env, req, undefined, 'login')).toBe(true);
    expect(await verifyTurnstile({ DEV_MODE: 'false' } as Env, req, 'tok', 'login')).toBe(false);
  });
});
