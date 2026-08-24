// Tags whose content is parsed by the HTML tokenizer in "raw text" or "RCDATA" mode
// (textarea, title, xmp, plaintext, noembed, noframes, noscript, template) are never
// tokenized as child elements by HTMLRewriter — the element handler below never fires
// for markup nested inside them. If such a tag were only unwrapped via
// removeAndKeepContent(), its raw text content (which may contain live, unescaped
// markup like `<img src=x onerror=...>`) would be emitted verbatim into the output.
// So every one of these must be dropped entirely, content included, exactly like
// script/style/iframe.
const DROP_ENTIRELY_TAGS = new Set([
  'script',
  'style',
  'iframe',
  'textarea',
  'title',
  'xmp',
  'plaintext',
  'noembed',
  'noframes',
  'noscript',
  'template',
]);
const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'a']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
};

// Only these URL schemes are allowed in a sanitized href. Everything else — javascript:,
// data:, vbscript:, or any scheme we don't recognize — gets the href attribute stripped.
// A value with no scheme at all (a relative path/fragment link) is allowed through.
const ALLOWED_HREF_SCHEMES = new Set(['http', 'https', 'mailto']);

// el.getAttribute() on this HTMLRewriter returns the RAW source text of the attribute —
// it does NOT decode HTML entities. That means `href="&#106;avascript:alert(1)"` is
// returned as that literal string, and a naive `/^javascript:/i` test on it never fires,
// even though a browser will decode the entity and treat it as a javascript: URL. So we
// decode entities ourselves before doing any scheme checks. This covers numeric character
// references (decimal and hex) plus the handful of named entities that matter for this
// specific bypass (NewLine/Tab/colon/amp) — not a full HTML named-entity table, which is
// unnecessary for detecting a URL scheme.
function decodeHtmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&newline;/gi, '\n')
    .replace(/&tab;/gi, '\t')
    .replace(/&colon;/gi, ':')
    .replace(/&amp;/gi, '&');
}

// Returns the decoded, safe href to store, or null if the href must be dropped entirely.
function sanitizeHref(rawHref: string): string | null {
  const decoded = decodeHtmlEntities(rawHref);

  // Strip control characters and whitespace before looking for a scheme — browsers ignore
  // these when parsing a URL, so `java&#9;script:` / `java&NewLine;script:` decode to
  // "java<TAB/LF>script:" which must still be recognized as the javascript: scheme. This
  // character class IS the security fix (not an accidental control-char literal), hence the
  // targeted disable rather than reworking the pattern.
  // eslint-disable-next-line no-control-regex -- intentional: stripping control/whitespace chars is the point of this check
  const normalized = decoded.replace(/[\x00-\x20]+/g, '');

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
  if (schemeMatch && !ALLOWED_HREF_SCHEMES.has(schemeMatch[1].toLowerCase())) {
    return null;
  }

  return decoded;
}

export async function sanitizeHtml(html: string): Promise<string> {
  const rewriter = new HTMLRewriter().on('*', {
    element(el) {
      const tag = el.tagName.toLowerCase();

      if (DROP_ENTIRELY_TAGS.has(tag)) {
        el.remove();
        return;
      }

      if (!ALLOWED_TAGS.has(tag)) {
        el.removeAndKeepContent();
        return;
      }

      const allowedAttrs = ALLOWED_ATTRS[tag] ?? new Set<string>();
      for (const [name] of [...el.attributes]) {
        if (!allowedAttrs.has(name)) {
          el.removeAttribute(name);
        }
      }

      if (tag === 'a') {
        const href = el.getAttribute('href');
        if (href) {
          const safeHref = sanitizeHref(href);
          if (safeHref === null) {
            el.removeAttribute('href');
          } else {
            // Write back the DECODED value. HTMLRewriter re-escapes it correctly on
            // serialization, so this also fixes the (unrelated) usability wrinkle of a
            // legitimately-escaped "&amp;" in a query string round-tripping cleanly,
            // rather than only ever stripping anything that contained an entity.
            el.setAttribute('href', safeHref);
          }
        }
      }
    },
  });

  const response = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  return await response.text();
}
