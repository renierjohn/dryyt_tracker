import { SELF, env } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import type { Env } from '../../worker/types';

// cloudflare:test's `env` is typed as the (unaugmented, effectively empty) `Cloudflare.Env`
// global — cast through `unknown` to the worker's actual `Env` shape to access the AVATARS
// binding with real types instead of `any`.
const typedEnv = env as unknown as Env;

function post(path: string, body?: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
}

function extractCookie(res: Response): string {
  return res.headers.get('set-cookie')!.split(';')[0];
}

async function registerAndLogin(email: string): Promise<string> {
  const res = await post('/api/auth/register', { email, password: 'password123', display_name: 'Avatar Tester' });
  return extractCookie(res);
}

// Real JPEG magic bytes followed by arbitrary padding — enough for detectImageMimeType,
// not a decodable image, which is fine: only the header is validated, not full decoding.
function jpegBytes(size = 100): Uint8Array {
  const bytes = new Uint8Array(size);
  bytes.set([0xff, 0xd8, 0xff, 0xe0], 0);
  return bytes;
}

function uploadAvatar(cookie: string, bytes: Uint8Array, filename: string, declaredType: string) {
  const formData = new FormData();
  formData.append('file', new File([bytes], filename, { type: declaredType }));
  // Deliberately no Content-Type header here — fetch sets the multipart boundary
  // itself from the FormData body; setting one manually breaks the boundary parsing.
  return SELF.fetch('https://example.com/api/profile/avatar', {
    method: 'POST',
    headers: { Cookie: cookie },
    body: formData,
  });
}

describe('POST /api/profile/avatar', () => {
  it('accepts a valid JPEG and stores it in R2', async () => {
    const cookie = await registerAndLogin('avatar-upload@example.com');
    const res = await uploadAvatar(cookie, jpegBytes(), 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(200);
    const body = await res.json() as { avatar_key: string };
    expect(body.avatar_key).toBeTruthy();
    const stored = await typedEnv.AVATARS.get(body.avatar_key);
    expect(stored).not.toBeNull();
  });

  it('rejects a file over 5MB with 400', async () => {
    const cookie = await registerAndLogin('avatar-toobig@example.com');
    const res = await uploadAvatar(cookie, jpegBytes(6 * 1024 * 1024), 'big.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('file_too_large');
  });

  it('rejects non-image content even with a spoofed image Content-Type', async () => {
    const cookie = await registerAndLogin('avatar-spoofed@example.com');
    const fakeBytes = new TextEncoder().encode('this is not an image');
    const res = await uploadAvatar(cookie, fakeBytes, 'fake.jpg', 'image/jpeg');
    expect(res.status).toBe(400);
    const body = await res.json() as { error: string };
    expect(body.error).toBe('unsupported_file_type');
  });

  it('replaces the previous avatar object in R2 on a second upload', async () => {
    const cookie = await registerAndLogin('avatar-replace@example.com');
    const firstRes = await uploadAvatar(cookie, jpegBytes(), 'first.jpg', 'image/jpeg');
    const firstKey = (await firstRes.json() as { avatar_key: string }).avatar_key;

    const secondRes = await uploadAvatar(cookie, jpegBytes(), 'second.jpg', 'image/jpeg');
    const secondKey = (await secondRes.json() as { avatar_key: string }).avatar_key;

    expect(secondKey).not.toBe(firstKey);
    expect(await typedEnv.AVATARS.get(firstKey)).toBeNull();
    expect(await typedEnv.AVATARS.get(secondKey)).not.toBeNull();
  });

  it('returns 401 when unauthenticated', async () => {
    const res = await uploadAvatar('', jpegBytes(), 'photo.jpg', 'image/jpeg');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/avatars/:key', () => {
  it('streams a stored avatar with the correct content type', async () => {
    const cookie = await registerAndLogin('avatar-serve@example.com');
    const uploadRes = await uploadAvatar(cookie, jpegBytes(), 'photo.jpg', 'image/jpeg');
    const key = (await uploadRes.json() as { avatar_key: string }).avatar_key;

    const res = await SELF.fetch(`https://example.com/api/avatars/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('image/jpeg');
  });

  it('returns 404 for a missing key', async () => {
    const res = await SELF.fetch('https://example.com/api/avatars/does-not-exist.jpg');
    expect(res.status).toBe(404);
  });
});
