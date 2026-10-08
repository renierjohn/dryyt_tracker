// Ended transactions created more than 3 months ago are deleted — by the
// superadmin console's "Delete" and by the Worker's daily cron (worker/index.ts).
// Open ones are kept however old, so no order still being worked on is lost.
export async function purgeOldEndedTransactions(
  db: D1Database,
  { dryRun = false }: { dryRun?: boolean } = {},
): Promise<{ cutoff: string; transactions: number }> {
  // One cutoff for every statement below, so they all agree on the set.
  const cutoff = (await db.prepare("SELECT datetime('now', '-3 months') AS t").first<{ t: string }>())!.t;
  const where = "status = 'end' AND created_at < ?";

  if (dryRun) {
    const counts = await db
      .prepare(`SELECT COUNT(*) AS n FROM workflow_transactions WHERE ${where}`)
      .bind(cutoff)
      .first<{ n: number }>();
    return { cutoff, transactions: counts?.n ?? 0 };
  }
  const result = await db.prepare(`DELETE FROM workflow_transactions WHERE ${where}`).bind(cutoff).run();
  return { cutoff, transactions: result.meta.changes };
}
