// Shared ?page= / ?q= handling for paginated list endpoints.
export const PAGE_SIZE = 10;

export function parsePage(raw: string | undefined): { page: number; limit: number; offset: number } {
  const n = Number(raw);
  const page = Number.isInteger(n) && n > 0 ? n : 1;
  return { page, limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE };
}

// A LIKE pattern matching `q` anywhere, with % _ \ escaped (use ESCAPE '\').
export function likePattern(q: string): string {
  return `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
}
