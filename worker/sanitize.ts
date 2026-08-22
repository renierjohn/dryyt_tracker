const ALLOWED_TAGS = new Set(['p', 'br', 'strong', 'em', 'b', 'i', 'ul', 'ol', 'li', 'a']);
const DROP_ENTIRELY_TAGS = new Set(['script', 'style', 'iframe']);
const ALLOWED_ATTRS: Record<string, Set<string>> = {
  a: new Set(['href', 'title']),
};

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
          const normalized = href.replace(/[\x00-\x20]+/g, '');
          if (/^javascript:/i.test(normalized)) {
            el.removeAttribute('href');
          }
        }
      }
    },
  });

  const response = rewriter.transform(new Response(html, { headers: { 'content-type': 'text/html' } }));
  return await response.text();
}
