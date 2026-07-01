// Pure, coverage-agnostic metric helpers for College Profiles.
// Every function reads the loaded active-roster rows (all seasons) and the
// derived season list; nothing here touches the network or PitchSide.

const TERMINAL = new Set(['SR', 'GR']) // exhausted / near-exhausted eligibility

export function rosterSize(currentRoster) {
  return currentRoster?.length || 0
}

// player_id -> earliest season seen (newcomer detection via the identity spine)
function firstSeenMap(rosters) {
  const m = new Map()
  for (const r of rosters) {
    if (!r.player_id) continue
    const prev = m.get(r.player_id)
    if (prev == null || r.roster_season < prev) m.set(r.player_id, r.roster_season)
  }
  return m
}

// set of player_ids active in a given season
function idsInSeason(rosters, season) {
  const s = new Set()
  for (const r of rosters) if (r.roster_season === season && r.player_id) s.add(r.player_id)
  return s
}

/**
 * Non-senior (underclassman) return rate, averaged across every consecutive
 * season transition present. Denominator = players with remaining eligibility
 * (class_year not SR/GR) in season N; numerator = those still present in N+1.
 *
 * Returns { rate, earlyDeparture, transitions:[{from,to,eligible,returned,rate}] }
 * rate is a 0–1 fraction (null if no computable transition).
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
 * Newcomers = current-roster players first seen in the current season
 * (true freshmen + transfers-in). Rows without a player_id are untrackable, so
 * counted as new.
 */
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
