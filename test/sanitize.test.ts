import { describe, it, expect } from 'vitest';
import { sanitizeHtml } from '../worker/sanitize';

describe('sanitizeHtml', () => {
  it('keeps allowed tags and text', async () => {
    const result = await sanitizeHtml('<p>Hello <strong>world</strong></p>');
    expect(result).toBe('<p>Hello <strong>world</strong></p>');
  });

  it('removes script tags and their content entirely', async () => {
    const result = await sanitizeHtml('<p>safe</p><script>alert(1)</script>');
    expect(result).not.toContain('script');
    expect(result).not.toContain('alert(1)');
    expect(result).toContain('<p>safe</p>');
  });

  it('removes style and iframe tags and their content entirely', async () => {
    const result = await sanitizeHtml('<style>body{color:red}</style><iframe src="evil"></iframe><p>ok</p>');
    expect(result).not.toContain('style');
    expect(result).not.toContain('iframe');
    expect(result).not.toContain('color:red');
    expect(result).toContain('<p>ok</p>');
  });

  it('unwraps disallowed tags but keeps their text content', async () => {
    const result = await sanitizeHtml('<div>keep this text</div>');
    expect(result).not.toContain('<div>');
    expect(result).toContain('keep this text');
  });

  it('strips on* attributes from allowed tags', async () => {
    const result = await sanitizeHtml('<p onclick="evil()">text</p>');
    expect(result).not.toContain('onclick');
    expect(result).toContain('<p>text</p>');
  });

  it('keeps href and title on links but strips other attributes', async () => {
    const result = await sanitizeHtml('<a href="https://example.com" title="Example" class="evil">link</a>');
    expect(result).toContain('href="https://example.com"');
    expect(result).toContain('title="Example"');
    expect(result).not.toContain('class');
  });

  it('strips javascript: hrefs', async () => {
    const result = await sanitizeHtml('<a href="javascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
  });

  it('strips javascript: hrefs with an embedded tab/newline in the scheme', async () => {
    const result = await sanitizeHtml('<a href="jav\tascript:alert(1)">click</a>');
    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('href=');
  });

  it('preserves lists', async () => {
    const result = await sanitizeHtml('<ul><li>one</li><li>two</li></ul>');
    expect(result).toBe('<ul><li>one</li><li>two</li></ul>');
  });

  describe('raw-text/RCDATA tags (Finding 1)', () => {
    it('drops textarea entirely, including its raw unescaped payload', async () => {
      const result = await sanitizeHtml('<textarea><img src=x onerror=alert(1)></textarea>');
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onerror=');
      expect(result).not.toContain('textarea');
    });

    it('drops title entirely, including its raw unescaped payload', async () => {
      const result = await sanitizeHtml('<title><img src=x onerror=alert(1)></title><p>ok</p>');
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onerror=');
      expect(result).toContain('<p>ok</p>');
    });

    it('drops noscript entirely, including its raw unescaped payload', async () => {
      const result = await sanitizeHtml('<noscript><img src=x onerror=alert(1)></noscript>');
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onerror=');
    });

    it('drops xmp, plaintext, noembed, noframes, and template entirely', async () => {
      const result = await sanitizeHtml(
        '<xmp><img src=x onerror=alert(1)></xmp>' +
          '<noembed><img src=x onerror=alert(2)></noembed>' +
          '<noframes><img src=x onerror=alert(3)></noframes>' +
          '<template><img src=x onerror=alert(4)></template>',
      );
      expect(result).not.toContain('<img');
      expect(result).not.toContain('onerror=');
    });
  });

  describe('href scheme allowlist and entity-encoded javascript: bypasses (Finding 2)', () => {
    it('strips href with a decimal-entity-encoded javascript: scheme', async () => {
      const result = await sanitizeHtml('<a href="&#106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips href with a hex-entity-encoded javascript: scheme', async () => {
      const result = await sanitizeHtml('<a href="&#x6a;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips href with a numeric-entity tab inside the scheme', async () => {
      const result = await sanitizeHtml('<a href="java&#9;script:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips href with a &NewLine; entity inside the scheme', async () => {
      const result = await sanitizeHtml('<a href="java&NewLine;script:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips a data: href (no scheme allowlist bypass)', async () => {
      const result = await sanitizeHtml('<a href="data:text/html,<script>alert(1)</script>">click</a>');
      expect(result).not.toContain('data:');
      expect(result).not.toContain('href=');
    });

    it('keeps a normal https:// href', async () => {
      const result = await sanitizeHtml('<a href="https://example.com">link</a>');
      expect(result).toContain('href="https://example.com"');
    });

    it('keeps a mailto: href', async () => {
      const result = await sanitizeHtml('<a href="mailto:x@example.com">email</a>');
      expect(result).toContain('href="mailto:x@example.com"');
    });
  });
});
