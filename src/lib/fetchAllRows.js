/**
 * fetchAllRows — read every row of a filtered query in parallel pages
 * (performance pass, 2026-10-09).
 *
 * Supabase returns at most 1,000 rows per request. The pages used to be
 * fetched one after another (each waiting for the previous), so a 3,000-row
 * list cost three round trips in a row. This asks for the first page and the
 * total count together, then for every remaining page at once: one round trip
 * up to 1,000 rows, two beyond that, and never more than fetching page by page.
 *
 *   fetchAllRows(client, 'v_college_index', 'id,school,...', q => q.order('id'))
 *
 * `apply` adds the filters AND an order that is unique per row (add the id as
 * a tie-breaker), so parallel pages can never overlap or skip a row. The same
 * select string is used for the count, so filters on embedded tables
 * (schools!inner(...)) count correctly.
 */
export async function fetchAllRows(client, table, cols, apply = q => q, pageSize = 1000) {
  const first = await apply(client.from(table).select(cols, { count: 'exact' })).range(0, pageSize - 1)
  if (first.error) throw first.error
  const rows = [...(first.data || [])]
  const n = first.count ?? rows.length
  if (rows.length < pageSize || n <= pageSize) return rows
  const pages = Math.ceil(n / pageSize)
  const results = await Promise.all(Array.from({ length: pages - 1 }, (_, i) =>
    apply(client.from(table).select(cols)).range((i + 1) * pageSize, (i + 2) * pageSize - 1)))
  for (const r of results) {
    if (r.error) throw r.error
    rows.push(...(r.data || []))
  }
  return rows
}
