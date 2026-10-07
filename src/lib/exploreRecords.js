/**
 * exploreRecords — record and ranking helpers for the Explore Colleges list
 * (backlog G1, 2026-10-07: "show me ranked D2 programs").
 *
 * Pure: no React, no Supabase. The page loads program_results for the latest
 * season and the one before it, and these helpers index, label and sort.
 *
 * WHY THE RULES ARE WHAT THEY ARE
 *  - Win % alone puts a 1-0-0 team above a 15-2-1 team, which early in a
 *    season is most of the list. So a program needs MIN_GAMES games before it
 *    is ranked by record; programs below that sort after it, by win % and then
 *    games, so nothing disappears.
 *  - RPI (NCAA Division I) and NPI (Division II) are separate national lists.
 *    #1 in each are not comparable, so with no division filter the rank sort
 *    groups by list (RPI first, then NPI) instead of interleaving them.
 *  - Programs with no record or no ranking for the chosen season always sort
 *    last, alphabetically, never as zeros.
 */

export const MIN_GAMES = 5

// program_results.division: D-I uses RPI, D-II uses NPI, D-III and below are
// unranked. Exact match: 'D-II' would prefix-match 'D-I'.
export function rankSystem(division) {
  if (division === 'D-I') return 'RPI'
  if (division === 'D-II') return 'NPI'
  return null
}

const num = v => (v == null ? null : Number(v))

/** program_results rows -> Map(season -> Map(school_id -> record)). */
export function indexResults(rows) {
  const out = new Map()
  for (const r of rows || []) {
    const season = Number(r.season)
    if (!out.has(season)) out.set(season, new Map())
    const w = num(r.wins) || 0, l = num(r.losses) || 0, t = num(r.ties) || 0
    out.get(season).set(r.school_id, {
      wins: w, losses: l, ties: t, games: w + l + t,
      winPct: num(r.win_pct),
      rank: num(r.rpi_rank),
      system: rankSystem(r.division),
    })
  }
  return out
}

/** The two seasons to offer: the latest present and the one before it. */
export function seasonsOffered(index) {
  const all = [...index.keys()].sort((a, b) => b - a)
  return all.slice(0, 2)
}

/**
 * Label for a season in the switch. The latest season reads "so far" until
 * the college season is over (mid-December), "final" after that and for any
 * earlier season.
 */
export function seasonLabel(season, latest, today = new Date()) {
  if (season !== latest) return `${season} final`
  const over = today.getFullYear() > season ||
    (today.getMonth() === 11 && today.getDate() >= 15)
  return over ? `${season} final` : `${season} so far`
}

export function recordText(rec) {
  if (!rec) return null
  return `${rec.wins}–${rec.losses}–${rec.ties}`
}

export function pctText(x) {
  return x == null ? '' : x.toFixed(3).replace(/^0(?=\.)/, '')
}

const byName = (a, b) => (a.school || '').localeCompare(b.school || '')

/** Sort rows (each has .id) by the chosen season's record, best first. */
export function sortByRecord(rows, recs) {
  const tier = r => {
    const rec = recs.get(r.id)
    if (!rec || rec.winPct == null || rec.games === 0) return 2
    return rec.games >= MIN_GAMES ? 0 : 1
  }
  return [...rows].sort((a, b) => {
    const ta = tier(a), tb = tier(b)
    if (ta !== tb) return ta - tb
    if (ta === 2) return byName(a, b)
    const ra = recs.get(a.id), rb = recs.get(b.id)
    return (rb.winPct - ra.winPct) || (rb.games - ra.games) || byName(a, b)
  })
}

/** Sort rows by RPI / NPI rank, best first; unranked last. */
export function sortByRank(rows, recs) {
  const sysOrder = s => (s === 'RPI' ? 0 : s === 'NPI' ? 1 : 2)
  return [...rows].sort((a, b) => {
    const ra = recs.get(a.id), rb = recs.get(b.id)
    const ka = ra && ra.rank != null && ra.system ? sysOrder(ra.system) : 3
    const kb = rb && rb.rank != null && rb.system ? sysOrder(rb.system) : 3
    if (ka !== kb) return ka - kb
    if (ka === 3) return byName(a, b)
    return (ra.rank - rb.rank) || byName(a, b)
  })
}
