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

  describe('double-encoded javascript: bypass of the entity decoder (residual finding)', () => {
    // decodeHtmlEntities used to be a single left-to-right, non-recursive pass ending in
    // `&amp;` -> `&`. For a double-encoded payload, the numeric-decode step ran BEFORE that
    // last step could expose the numeric reference underneath, so it never fired -- and the
    // resulting string then looked "scheme-less" and fell through to the "must be a relative
    // link" branch, unstripped. These assert that no shape of double-encoding survives.

    it('strips a double-encoded (named-then-numeric) javascript: href', async () => {
      const result = await sanitizeHtml('<a href="&amp;#106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips a double-encoded (decimal-then-numeric) javascript: href', async () => {
      const result = await sanitizeHtml('<a href="&#38;#106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips a triple-encoded javascript: href', async () => {
      // &amp;amp;#106; -> (decode) &amp;#106; -> (decode) &#106; -> (decode) 'j'
      const result = await sanitizeHtml('<a href="&amp;amp;#106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips a numeric entity missing its terminating semicolon (fail-closed residue check)', async () => {
      // Real browsers still decode a numeric character reference even without the trailing
      // ";" (a parse error, not a rejection). Our decoder requires the ";", so this never
      // resolves to "javascript:" internally -- it must be caught by the residual-entity
      // fail-closed check instead of falling through as "no scheme, must be relative".
      const result = await sanitizeHtml('<a href="&#106avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips when decoding cannot reach a fixed point within the iteration cap', async () => {
      // NESTED (not sibling) "amp;" layers: each decode pass peels exactly one layer off
      // the front ("&" + "amp;"*N + rest -> "&" + "amp;"*(N-1) + rest), so N layers need N
      // passes just to expose the numeric reference underneath, plus a couple more to
      // resolve and then confirm it's stable -- comfortably more than the 8-pass cap. This
      // must fail closed (stripped), not be treated as "fully decoded, no scheme found".
      const deeplyNested = '&' + 'amp;'.repeat(20) + '#106;avascript:alert(1)';
      const result = await sanitizeHtml(`<a href="${deeplyNested}">click</a>`);
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('does NOT strip a legitimate fragment link', async () => {
      const result = await sanitizeHtml('<a href="#section">jump</a>');
      expect(result).toContain('href="#section"');
    });

    it('does NOT strip a legitimate relative path link', async () => {
      const result = await sanitizeHtml('<a href="/some/path">go</a>');
      expect(result).toContain('href="/some/path"');
    });

    it('does NOT strip a legitimate relative link with an ordinary query string', async () => {
      const result = await sanitizeHtml('<a href="/some/path?a=1&b=2">go</a>');
      expect(result).toContain('href=');
      expect(result).toContain('/some/path?a=1');
    });

    it('strips a decimal entity with a leading zero (&#0106;)', async () => {
      const result = await sanitizeHtml('<a href="&#0106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips an uppercase-hex, uppercase-X entity (&#X6A;)', async () => {
      const result = await sanitizeHtml('<a href="&#X6A;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('strips a numeric entity with whitespace injected inside the entity syntax', async () => {
      const result = await sanitizeHtml('<a href="&#\t106;avascript:alert(1)">click</a>');
      expect(result).not.toContain('javascript:');
      expect(result).not.toContain('href=');
    });

    it('still keeps https:// and mailto: hrefs after the fix', async () => {
      const httpsResult = await sanitizeHtml('<a href="https://example.com">link</a>');
      expect(httpsResult).toContain('href="https://example.com"');

      const mailtoResult = await sanitizeHtml('<a href="mailto:x@example.com">email</a>');
      expect(mailtoResult).toContain('href="mailto:x@example.com"');
    });

    it('integration: the double-encoded payload never survives sanitizeHtml() as decodable javascript: syntax', async () => {
      const payloads = [
        '&amp;#106;avascript:alert(1)',
        '&#38;#106;avascript:alert(1)',
        '&amp;amp;#106;avascript:alert(1)',
        '&#106avascript:alert(1)',
      ];
      for (const payload of payloads) {
        const result = await sanitizeHtml(`<p>before</p><a href="${payload}">click</a><p>after</p>`);
        // No href attribute should remain at all for these payloads.
        expect(result).not.toContain('href=');
        // Belt-and-suspenders: no substring a browser could decode into a javascript: URL --
        // no literal "javascript:", and no numeric/named entity residue that decodes to one.
        expect(result).not.toContain('javascript:');
        expect(result).not.toMatch(/&#x?6a;|&#106;?/i);
        expect(result).toContain('<p>before</p>');
        expect(result).toContain('<p>after</p>');
      }
    });
  });
});

describe("sanitizeHtml(html, 'rich')", () => {
  const rich = (html: string) => sanitizeHtml(html, 'rich');

  it('keeps headings, tables, code blocks and extra inline styles', async () => {
    const html =
      '<h2>Title</h2><p><u>u</u><s>s</s><sub>1</sub><sup>2</sup><code>c</code></p>' +
      '<pre><code class="language-plaintext">x</code></pre><blockquote><p>q</p></blockquote><hr>' +
      '<figure class="table"><table><tbody><tr><td colspan="2">a</td></tr></tbody></table></figure>';
    expect(await rich(html)).toBe(html);
  });

  it('keeps allowlisted inline styles and drops the rest', async () => {
    const out = await rich(
      `<p style="text-align:center;color:hsl(0, 75%, 60%);position:fixed;font-family:'Courier New', monospace">x</p>`,
    );
    expect(out).toBe(`<p style="text-align:center;color:hsl(0, 75%, 60%);font-family:'Courier New', monospace">x</p>`);
  });

  it('drops style values that load resources or escape the attribute', async () => {
    expect(await rich('<span style="background-color:url(https://x.test/a.png)">x</span>')).toBe('<span>x</span>');
    expect(await rich('<span style="color:red&quot; onmouseover=&quot;alert(1)">x</span>')).toBe('<span>x</span>');
    expect(await rich('<span style="width:expression(alert(1))">x</span>')).toBe('<span>x</span>');
  });

  it("keeps CKEditor's content classes but not arbitrary ones", async () => {
    expect(await rich('<mark class="marker-yellow m3-banner">x</mark>')).toBe('<mark class="marker-yellow">x</mark>');
    expect(await rich('<span class="evil">x</span>')).toBe('<span>x</span>');
  });

  it('keeps https images, drops data:/javascript: ones and non-numeric sizes', async () => {
    expect(await rich('<img src="https://example.com/a.png" alt="A" width="100" height="x">')).toBe(
      '<img src="https://example.com/a.png" alt="A" width="100">',
    );
    expect(await rich('<p>a<img src="data:image/png;base64,AAAA">b</p>')).toBe('<p>ab</p>');
    expect(await rich('<p>a<img src="javascript:alert(1)">b</p>')).toBe('<p>ab</p>');
  });

  it('only keeps disabled checkbox inputs (todo lists)', async () => {
    expect(await rich('<input type="checkbox" checked="checked">')).toBe('<input type="checkbox" checked="checked" disabled="">');
    expect(await rich('<p>a<input type="text" value="x">b</p>')).toBe('<p>ab</p>');
  });

  it('forces rel=noopener on links that open a new tab', async () => {
    expect(await rich('<a href="https://x.test" target="_top" rel="opener">x</a>')).toBe(
      '<a href="https://x.test" target="_blank" rel="noopener noreferrer">x</a>',
    );
  });

  it('still drops scripts and event handlers', async () => {
    expect(await rich('<h2 onclick="alert(1)">t</h2><script>alert(1)</script>')).toBe('<h2>t</h2>');
  });

  it('basic profile is unchanged: rich-only tags are unwrapped', async () => {
    expect(await sanitizeHtml('<h2 style="color:red">t</h2>')).toBe('t');
  });
});
