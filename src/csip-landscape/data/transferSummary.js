// Pure helpers for the Landscape Transfers section. No React, so the tests can
// import them with plain node.

/**
 * Pure: summarise the flows for one division. Exported for tests.
 *   season: the Landscape selection; used when it is a census season, else the
 *           pooled window (0).
 * Returns { season, pooled, into, outOf, moves, corridors } where
 *   into / outOf = [{ group, n }] by the OTHER end's division, largest first
 *                  (same-division moves appear under the division itself)
 *   moves        = { up, lateral, down } for moves INTO the division
 *   corridors    = top conference-to-conference flows touching the division
 */
export function summariseTransfers(rows, { division, season, seasons, topCorridors = 8 }) {
  const useSeason = seasons && seasons.includes(season) ? season : 0
  const pick = (rows || []).filter(r => r.roster_season === useSeason)
  const div = pick.filter(r => r.level === 'division')

  const sumBy = (list, key) => {
    const m = {}
    for (const r of list) m[r[key]] = (m[r[key]] || 0) + r.n
    return Object.entries(m).map(([group, n]) => ({ group, n })).sort((a, b) => b.n - a.n || a.group.localeCompare(b.group))
  }
  const inRows = div.filter(r => r.to_group === division)
  const outRows = div.filter(r => r.from_group === division)
  const moves = { up: 0, lateral: 0, down: 0 }
  for (const r of inRows) moves[r.move] = (moves[r.move] || 0) + r.n

  const corridors = pick
    .filter(r => r.level === 'conference' && (r.to_division === division || r.from_division === division))
    .sort((a, b) => b.n - a.n || a.from_group.localeCompare(b.from_group))
    .slice(0, topCorridors)

  return {
    season: useSeason,
    pooled: useSeason === 0,
    into: sumBy(inRows, 'from_group'),
    outOf: sumBy(outRows, 'to_group'),
    moves,
    corridors,
  }
}
