/**
 * collegeValue — earnings and debt on Find programs (backlog F19, Damon
 * 2026-10-15: bring the assistant's earnings sort, debt and visit-award lines
 * to the page).
 *
 * The figures are the College Scorecard ones on the Campus and cost card:
 * median earnings 10 years after starting (former students who received
 * federal aid) and median federal loan debt of students who completed, with
 * that debt as a monthly payment over 10 years.
 *
 * Pure: no React, no Supabase. Tested by test/collegeValue.test.mjs.
 */

export const ORDERS = [
  { key: 'openings', label: 'Most estimated openings' },
  { key: 'earnings', label: 'Highest median earnings' },
  { key: 'debt', label: 'Lowest median debt' },
]

const num = x => (x == null || x === '' || isNaN(Number(x)) ? null : Number(x))
const money = x => '$' + Math.round(x).toLocaleString('en-US')

/** "Median earnings $75,537 (10 years after starting) · median debt $23,250, about $246 a month", or null. */
export function valueLine(f) {
  if (!f) return null
  const earn = num(f.median_earnings_10yr), debt = num(f.median_debt), monthly = num(f.median_debt_monthly)
  const parts = []
  if (earn != null) parts.push(`Median earnings ${money(earn)} (10 years after starting)`)
  if (debt != null) parts.push(`${parts.length ? 'median' : 'Median'} debt at graduation ${money(debt)}${monthly != null ? `, about ${money(monthly)} a month` : ''}`)
  return parts.length ? parts.join(' · ') : null
}

/**
 * The list in the chosen order. 'openings' keeps the given order (the ranking
 * from findPrograms.js); 'earnings' puts the highest first and 'debt' the
 * lowest first. Programs without the figure go last, in their openings order.
 * factOf(school_id) returns the college's facts or null.
 */
export function orderPrograms(list, order, factOf) {
  if (order !== 'earnings' && order !== 'debt') return list
  const key = order === 'earnings' ? 'median_earnings_10yr' : 'median_debt'
  const dir = order === 'earnings' ? -1 : 1
  return list
    .map((r, i) => ({ r, i, v: num(factOf(r.school_id)?.[key]) }))
    .sort((a, b) => (a.v == null) - (b.v == null) || (a.v != null && dir * (a.v - b.v)) || a.i - b.i)
    .map(x => x.r)
}
