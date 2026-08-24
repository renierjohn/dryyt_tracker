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
function decodeHtmlEntitiesOnce(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/gi, (_, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&newline;/gi, '\n')
    .replace(/&tab;/gi, '\t')
    .replace(/&colon;/gi, ':')
    .replace(/&amp;/gi, '&');
}

// Hard cap on decode iterations. A single call above ISN'T idempotent in a way that
// matters: for a double-encoded payload like `&amp;#106;avascript:`, the numeric-decode
// step runs BEFORE the trailing `&amp;` -> `&` step in the same pass, so it never sees
// the `&#106;` that only exists once `&amp;` has been unwrapped -- it takes a second
// pass to expose it, a third to confirm nothing further changes, and so on for deeper
// nesting. We loop to a fixed point instead of doing one pass. The cap exists so an
// adversarial, arbitrarily-deep chain of encoding can't force unbounded work; hitting it
// means we could NOT confirm the string was fully decoded, and callers must treat that
// as a decode failure (fail closed) rather than "decoding is done".
const MAX_DECODE_ITERATIONS = 8;

function decodeHtmlEntities(value: string): { value: string; resolved: boolean } {
  let current = value;
  for (let i = 0; i < MAX_DECODE_ITERATIONS; i++) {
    const next = decodeHtmlEntitiesOnce(current);
    if (next === current) {
      return { value: current, resolved: true };
    }
    current = next;
  }
  return { value: current, resolved: false };
}

// After decoding to a fixed point, does the string still contain something that LOOKS
// like an entity reference decodeHtmlEntities didn't (fully) resolve? Any semicolon-
// terminated numeric or named reference from our decode list is guaranteed to be gone
// once decodeHtmlEntities reaches a fixed point, so a leftover match here can only be:
//   - a numeric reference missing its terminating semicolon (`&#106avascript:`) --
//     per the HTML5 tokenizer, numeric character references are decoded by real
//     browsers REGARDLESS of a trailing semicolon (a missing one is just a parse
//     error, not a rejection), so this is still live danger even though our own
//     decoder (which requires the semicolon) left it untouched; or
//   - one of our named entities (amp/newline/tab/colon) missing its semicolon, in a
//     position where a browser's "ambiguous ampersand" handling would still expand it
//     (i.e. NOT immediately followed by an alphanumeric or `=`, the two cases where
//     browsers leave it as literal text instead).
// Either way, a browser may still decode this further at render time, so it must be
// treated as unresolved/unsafe rather than "no scheme, must be a relative link".
const UNRESOLVED_ENTITY_RESIDUE = /&#x?[0-9a-fA-F]+|&(?:amp|newline|tab|colon)(?![a-zA-Z0-9=])/i;

// Returns the decoded, safe href to store, or null if the href must be dropped entirely.
function sanitizeHref(rawHref: string): string | null {
  const { value: decoded, resolved } = decodeHtmlEntities(rawHref);

  // Hit the iteration cap without the string stabilizing -- we can't be sure what this
  // actually decodes to (or an attacker is deliberately nesting encodings to burn CPU).
  // Fail closed.
  if (!resolved) {
    return null;
  }

  // Strip control characters and whitespace before looking for a scheme — browsers ignore
  // these when parsing a URL, so `java&#9;script:` / `java&NewLine;script:` decode to
  // "java<TAB/LF>script:" which must still be recognized as the javascript: scheme. This
  // character class IS the security fix (not an accidental control-char literal), hence the
  // targeted disable rather than reworking the pattern.
  // eslint-disable-next-line no-control-regex -- intentional: stripping control/whitespace chars is the point of this check
  const normalized = decoded.replace(/[\x00-\x20]+/g, '');

  const schemeMatch = /^([a-zA-Z][a-zA-Z0-9+.-]*):/.exec(normalized);
  if (schemeMatch) {
    if (!ALLOWED_HREF_SCHEMES.has(schemeMatch[1].toLowerCase())) {
      return null;
    }
    return decoded;
  }

  // No scheme detected. This is normally a legitimate relative/fragment link
  // (`#section`, `/some/path`) and should be let through. But if fully-decoded residue
  // still looks entity-shaped, don't assume "no scheme" means "relative link" -- that
  // assumption IS the bug this function exists to fix. Fail closed instead.
  if (UNRESOLVED_ENTITY_RESIDUE.test(normalized)) {
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
            // Write back the DECODED value. Verified empirically that HTMLRewriter/lol-html's
            // setAttribute does NOT re-escape a literal "&" on serialization (a prior version
            // of this comment claimed it did -- it doesn't: sanitizeHtml('<a href="?a=1&b=2">')
            // round-trips the "&" raw, byte for byte). That's fine BECAUSE sanitizeHref() above
            // guarantees the decoded value it returns contains no leftover entity-shaped residue
            // (see UNRESOLVED_ENTITY_RESIDUE) -- a bare "&" not followed by anything that looks
            // like character-reference syntax is inert. Writing back the decoded value also
            // fixes the (unrelated) usability wrinkle of a legitimately-escaped "&amp;" in a
            // query string round-tripping cleanly, rather than only ever stripping anything that
            // contained an entity.
            el.setAttribute('href', safeHref);
          }
        }
      }
    },
  });

  const response = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  return await response.text();
}
