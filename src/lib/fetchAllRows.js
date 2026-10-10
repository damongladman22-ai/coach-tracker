/**
 * fetchAllRows — read every row of a filtered query in parallel pages
 * (performance pass, 2026-10-09).
 *
 * Supabase returns at most 1,000 rows per request. The pages used to be
 * fetched one after another (each waiting for the previous), so a 3,000-row
 * list cost three round trips in a row. This counts the rows first, then asks
 * for every page at once: two round trips whatever the size.
 *
 *   fetchAllRows(client, 'v_college_index', 'id,school,...', q => q.order('id'))
 *
 * `apply` adds the filters AND an order that is unique per row (add the id as
 * a tie-breaker), so parallel pages can never overlap or skip a row. The same
 * select string is used for the count, so filters on embedded tables
 * (schools!inner(...)) count correctly.
 */
export async function fetchAllRows(client, table, cols, apply = q => q, pageSize = 1000) {
  const head = await apply(client.from(table).select(cols, { count: 'exact', head: true }))
  if (head.error) throw head.error
  const n = head.count || 0
  if (n === 0) return []
  const pages = Math.ceil(n / pageSize)
  const results = await Promise.all(Array.from({ length: pages }, (_, i) =>
    apply(client.from(table).select(cols)).range(i * pageSize, i * pageSize + pageSize - 1)))
  const rows = []
  for (const r of results) {
    if (r.error) throw r.error
    rows.push(...(r.data || []))
  }
  return rows
}
