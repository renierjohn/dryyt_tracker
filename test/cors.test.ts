import { SELF } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';

describe('CORS on /api/*', () => {
  it('echoes an allowed Origin, with credentials', async () => {
    const res = await SELF.fetch('https://example.com/api/health', { headers: { Origin: 'https://other.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://other.example');
    expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(res.headers.get('Vary')).toContain('Origin');
  });

  it('sends the first configured domain for an unlisted or missing Origin', async () => {
    const res = await SELF.fetch('https://example.com/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
    const noOrigin = await SELF.fetch('https://example.com/api/health');
    expect(noOrigin.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
  });

  it('answers preflight before auth', async () => {
    const res = await SELF.fetch('https://example.com/api/owner/users', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://allowed.example',
        'Access-Control-Request-Method': 'POST',
        'Access-Control-Request-Headers': 'Content-Type',
      },
    });
    expect(res.status).toBe(204);
    expect(res.headers.get('Access-Control-Allow-Origin')).toBe('https://allowed.example');
    expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    expect(res.headers.get('Access-Control-Allow-Headers')).toBe('Content-Type');
  });
});
