/**
 * PostgREST (Supabase) silently caps every select at 1000 rows. Any read of a
 * table that can grow past that (transactions, income, merchant memory,
 * snapshots) MUST paginate or totals silently understate reality.
 *
 * Usage — the caller supplies a page builder; include a stable .order() so
 * pages don't shuffle between requests:
 *
 *   const rows = await fetchAllRows((from, to) =>
 *     supabase
 *       .from('transactions_uploaded')
 *       .select('id, amount, txn_date')
 *       .eq('owner_id', ownerId)
 *       .is('deleted_at', null)
 *       .order('id')
 *       .range(from, to),
 *   );
 */
export async function fetchAllRows<T>(
  buildPage: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  pageSize = 1000,
): Promise<T[]> {
  const all: T[] = [];
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await buildPage(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const rows = data ?? [];
    all.push(...rows);
    if (rows.length < pageSize) return all;
  }
}
