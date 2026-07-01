// Pure, coverage-agnostic metric helpers for College Profiles.
// Every function reads the loaded active-roster rows (all seasons) and the
// derived season list; nothing here touches the network or PitchSide.

const TERMINAL = new Set(['SR', 'GR']) // exhausted / near-exhausted eligibility
export const POS_ORDER = ['GK', 'D', 'M', 'F']

export function rosterSize(currentRoster) {
  return currentRoster?.length || 0
}

function firstSeenMap(rosters) {
  const m = new Map()
  for (const r of rosters) {
    if (!r.player_id) continue
    const prev = m.get(r.player_id)
    if (prev == null || r.roster_season < prev) m.set(r.player_id, r.roster_season)
  }
  return m
}

function idsInSeason(rosters, season) {
  const s = new Set()
  for (const r of rosters) if (r.roster_season === season && r.player_id) s.add(r.player_id)
  return s
}

/**
 * Non-senior return rate, averaged across every consecutive season transition.
 * Denominator = players with remaining eligibility (not SR/GR) in season N;
 * numerator = those still present in N+1.
 * Returns { rate, earlyDeparture, transitions:[{from,to,eligible,returned,rate}] }
 */
export function nonSeniorReturnRate(rosters, seasons) {
  const transitions = []
  for (let i = 0; i < seasons.length - 1; i++) {
    const a = seasons[i], b = seasons[i + 1]
    const nextIds = idsInSeason(rosters, b)
    let eligible = 0, returned = 0
    const seen = new Set()
    for (const r of rosters) {
      if (r.roster_season !== a || !r.player_id) continue
      if (TERMINAL.has(r.class_year)) continue
      if (seen.has(r.player_id)) continue
      seen.add(r.player_id)
      eligible++
      if (nextIds.has(r.player_id)) returned++
    }
    if (eligible > 0) transitions.push({ from: a, to: b, eligible, returned, rate: returned / eligible })
  }
  if (!transitions.length) return { rate: null, earlyDeparture: null, transitions }
  const rate = transitions.reduce((s, t) => s + t.rate, 0) / transitions.length
  return { rate, earlyDeparture: 1 - rate, transitions }
}

/** Deterministic spots opening after the current season = graduating SR + GR. */
export function projectedOpeningsAfterCurrent(currentRoster) {
  return (currentRoster || []).filter(r => TERMINAL.has(r.class_year)).length
}

/**
 * Projected openings by graduation year across the next `span` seasons.
 * Deterministic aging: buckets current-roster players by grad_year, split by
 * position group. Returns [{ year, isNext, total, byPos:{GK,D,M,F}, players:[] }].
 */
export function projectedOpeningsByYear(currentRoster, currentSeason, span = 4) {
  if (currentSeason == null) return []
  const out = []
  for (let i = 1; i <= span; i++) {
    const year = currentSeason + i
    const players = (currentRoster || []).filter(r => r.grad_year === year)
    const byPos = { GK: 0, D: 0, M: 0, F: 0 }
    for (const r of players) if (byPos[r.position] != null) byPos[r.position]++
    out.push({ year, isNext: i === 1, total: players.length, byPos, players })
  }
  return out
}

/** Newcomers = current-roster players first seen in the current season. */
export function newcomers(rosters, currentRoster, currentSeason) {
  if (currentSeason == null) return 0
  const first = firstSeenMap(rosters)
  let n = 0
  const counted = new Set()
  for (const r of currentRoster || []) {
    const id = r.player_id
    if (id) {
      if (counted.has(id)) continue
      counted.add(id)
      if (first.get(id) === currentSeason) n++
    } else {
      n++
    }
  }
  return n
}
