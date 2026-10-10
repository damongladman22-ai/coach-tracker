/**
 * fetchAllRows — read every row of a filtered query, fetching pages in
 * parallel (performance pass, 2026-10-09).
 *
 * Supabase returns at most 1,000 rows per request. The pages used to be
 * fetched one after another, so a 3,000-row list cost three round trips in a
 * row. Counting the rows first turned out to be slow on joined queries (the
 * Find programs count took longer than a page), so this asks for no count:
 *   1. the first page;
 *   2. if it was full, the next BATCH pages at once, and again until a page
 *      comes back short.
 * Up to 1,000 rows: one round trip. Up to 5,000: two. Never more round trips
 * than page-by-page; a page past the end just comes back empty.
 *
 *   fetchAllRows(client, 'v_college_index', 'id,school,...', q => q.order('id'))
 *
 * `apply` adds the filters AND an order that is unique per row (add the id as
 * a tie-breaker), so parallel pages can never overlap or skip a row.
 */
const BATCH = 4

export async function fetchAllRows(client, table, cols, apply = q => q, pageSize = 1000) {
  const page = i => apply(client.from(table).select(cols)).range(i * pageSize, i * pageSize + pageSize - 1)
  const first = await page(0)
  if (first.error) throw first.error
  const rows = [...(first.data || [])]
  if (rows.length < pageSize) return rows
  for (let next = 1; ; next += BATCH) {
    const results = await Promise.all(Array.from({ length: BATCH }, (_, k) => page(next + k)))
    let done = false
    for (const r of results) {
      if (r.error) throw r.error
      const data = r.data || []
      if (!done) rows.push(...data)
      if (data.length < pageSize) done = true
    }
    if (done) return rows
  }
}
