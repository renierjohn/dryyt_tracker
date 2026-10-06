export function formatWeight(kg: number | null): string {
  return kg === null ? '—' : `${kg} kg`;
}
