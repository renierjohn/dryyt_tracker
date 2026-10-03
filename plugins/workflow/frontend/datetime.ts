// SQLite datetime('now') values are UTC without a zone ("2026-10-03 01:18:48").
export function formatDateTime(value: string | null): string {
  if (!value) return '—';
  return new Date(value.replace(' ', 'T') + 'Z').toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}
