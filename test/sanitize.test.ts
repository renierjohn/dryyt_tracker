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

  it('preserves lists', async () => {
    const result = await sanitizeHtml('<ul><li>one</li><li>two</li></ul>');
    expect(result).toBe('<ul><li>one</li><li>two</li></ul>');
  });
});
