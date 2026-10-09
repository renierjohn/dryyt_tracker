// Prints a claim slip for a registered transaction in its own tab: tablet
// browsers ignore print() on an iframe and print the top page, so the slip
// must be the top-level document of the window being printed.
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
export function notesToText(html: string): string {
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

// Android/HarmonyOS tablets print to Bluetooth thermal printers (e.g. RPP02N)
// through the RawBT app, which takes raw ESC/POS bytes via an intent URL.
export const printsViaRawBT = /Android|HarmonyOS/i.test(navigator.userAgent);

// Plain ASCII only; the printer's code page is unknown.
const toAscii = (value: string) => value.replace(/[—–]/g, '-').replace(/[^\n -~]/g, '');

export const trackUrlFor = (code: string) => `${window.location.origin}/track?code=${encodeURIComponent(code)}`;

export const ownerLineOf = (receipt: Receipt) => [receipt.ownerContact, receipt.ownerEmail].filter(Boolean).join(' - ');

// Builds a small ESC/POS job (text + the printer's own QR command) and hands
// it to RawBT. Call from a click: the intent URL needs a user gesture.
export function printViaRawBT(receipt: Receipt): void {
  const trackUrl = trackUrlFor(receipt.code);
  const t = (value: string) => toAscii(value.replace(/•/g, '*'));
  const notes = notesToText(receipt.notesHtml);
  const ownerLine = ownerLineOf(receipt);
  const qrLength = trackUrl.length + 3;
  const ESC = '\x1b';
  const GS = '\x1d';
  const job =
    `${ESC}@${ESC}a\x01${ESC}!\x30${t(receipt.ownerName)}\n${ESC}!\x00${t(ownerLine)}\n\n` +
    `${ESC}a\x00Name: ${t(receipt.customerName)}\n` +
    `Control Number: ${t(receipt.controlNumber ?? '-')}\n` +
    `Weight: ${receipt.weightKg === null ? '-' : `${receipt.weightKg} kg`}\n` +
    `Notes: ${t(notes || '-')}\n\n` +
    `${ESC}a\x01` +
    `${GS}(k\x04\x001A2\x00` + // QR model 2
    `${GS}(k\x03\x001C\x06` + // module size 6
    `${GS}(k\x03\x001E1` + // error correction M
    `${GS}(k${String.fromCharCode(qrLength & 0xff, qrLength >> 8)}1P0${trackUrl}` +
    `${GS}(k\x03\x001Q0\n` + // print the QR
    `${receipt.code}\n${ESC}d\x04`;
  window.location.href = `intent:base64,${btoa(job)}#Intent;scheme=rawbt;package=ru.a402d.rawbtprinter;end;`;
}

// Must be called synchronously in the click handler, before any await, or the
// browser blocks the popup.
export function openReceiptWindow(): Window | null {
  if (printsViaRawBT) return null;
  const win = window.open('', '_blank');
  win?.document.write('<!doctype html><title>Preparing slip…</title><p style="font:14px system-ui;padding:16px">Preparing slip…</p>');
  return win;
}

export async function printReceipt(receipt: Receipt, win: Window | null): Promise<void> {
  const trackUrl = trackUrlFor(receipt.code);
  if (!win || win.closed) throw new Error('Print window was blocked or closed');
  const { toDataURL } = await import('qrcode');
  const qr = await toDataURL(trackUrl, { width: 320, margin: 1, errorCorrectionLevel: 'M' });
  const notes = notesToText(receipt.notesHtml);
  const ownerLine = ownerLineOf(receipt);

  // The slip prints itself once the QR image has loaded, and closes after.
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(receipt.code)}</title>
<style>
  @page { margin: 12mm; }
  body { margin: 0; padding: 0 8mm; font: 14px/1.5 system-ui, sans-serif; color: #000; background: #fff; }
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
  <script>
    window.addEventListener('afterprint', () => window.close());
    window.addEventListener('load', () => setTimeout(() => window.print(), 250));
  </script>
</body></html>`;

  win.document.open();
  win.document.write(html);
  win.document.close();
}
