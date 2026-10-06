// Prints a claim slip for a registered transaction from a hidden iframe, so
// the page's own styles and layout don't leak into the printout.
export interface Receipt {
  ownerName: string;
  ownerContact: string | null;
  ownerEmail: string;
  customerName: string;
  controlNumber: string | null;
  weightKg: number | null;
  // The editor's HTML; printed as plain text.
  notesHtml: string;
  code: string;
}

const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]!);

// Rich-text notes → plain text, one line per paragraph/list item/line break.
// DOMParser builds an inert document, so nothing in the HTML runs.
function notesToText(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  doc.querySelectorAll('br').forEach((br) => br.replaceWith('\n'));
  doc.querySelectorAll('li').forEach((li) => li.prepend('• '));
  doc.querySelectorAll('p, li, h1, h2, h3, h4, h5, h6, blockquote, pre, tr').forEach((el) => el.append('\n'));
  return (doc.body.textContent ?? '')
    .replace(/\u00a0/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n');
}

export async function printReceipt(receipt: Receipt): Promise<void> {
  const trackUrl = `${window.location.origin}/track?code=${encodeURIComponent(receipt.code)}`;
  const { toDataURL } = await import('qrcode');
  const qr = await toDataURL(trackUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  const notes = notesToText(receipt.notesHtml);
  const ownerLine = [receipt.ownerContact, receipt.ownerEmail].filter(Boolean).join(' - ');

  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${escapeHtml(receipt.code)}</title>
<style>
  @page { margin: 12mm; }
  body { margin: 0; padding: 0 8mm; font: 14px/1.5 system-ui, sans-serif; color: #000; }
  .center { text-align: center; }
  h1 { margin: 0; font-size: 20px; }
  .owner { margin: 0 0 16px; }
  p { margin: 0; }
  .notes { white-space: pre-line; }
  .qr { display: flex; flex-direction: column; align-items: flex-end; margin: 16px 8mm 0 0; }
  img { display: block; width: 160px; height: 160px; }
  .code { font: 600 18px/1.4 ui-monospace, monospace; letter-spacing: 3px; }
</style></head>
<body>
  <h1 class="center">${escapeHtml(receipt.ownerName)}</h1>
  <p class="center owner">${escapeHtml(ownerLine)}</p>
  <p>Name: ${escapeHtml(receipt.customerName)}</p>
  <p>Control Number: ${escapeHtml(receipt.controlNumber ?? '—')}</p>
  <p>Weight: ${receipt.weightKg === null ? '—' : `${receipt.weightKg} kg`}</p>
  <p class="notes">Notes: ${notes ? escapeHtml(notes) : '—'}</p>
  <div class="qr">
    <img src="${qr}" alt="">
    <p class="code">${escapeHtml(receipt.code)}</p>
  </div>
</body></html>`;

  const frame = document.createElement('iframe');
  frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0;';
  document.body.appendChild(frame);
  const doc = frame.contentDocument!;
  doc.open();
  doc.write(html);
  doc.close();
  const img = doc.querySelector('img')!;
  if (!img.complete) await new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
  frame.contentWindow!.addEventListener('afterprint', () => frame.remove(), { once: true });
  frame.contentWindow!.focus();
  frame.contentWindow!.print();
}
