// Pure, coverage-agnostic metric helpers for College Profiles.
// Every function reads the loaded active-roster rows (all seasons) and the
// derived season list; nothing here touches the network or PitchSide.

const TERMINAL = new Set(['SR', 'GR']) // exhausted / near-exhausted eligibility
export const POS_ORDER = ['GK', 'D', 'M', 'F']
const US_NAMES = new Set(['United States', 'USA', 'US', 'U.S.', 'U.S.A.'])

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

/**
 * Geography buckets for the current roster, from the normalized location
 * columns: U.S. players bucket by hometown_state, international by
 * hometown_country. Returns [{ name, intl, count }] desc, Unknown last.
 */
export function geographyBuckets(currentRoster) {
  const map = new Map()
  let unknown = 0
  for (const r of currentRoster || []) {
    const country = (r.hometown_country || '').trim()
    const state = (r.hometown_state || '').trim()
    const intl = !!country && !US_NAMES.has(country)
    const name = intl ? country : state
    if (!name) { unknown++; continue }
    const key = (intl ? 'C:' : 'S:') + name
    const cur = map.get(key) || { name, intl, count: 0 }
    cur.count++
    map.set(key, cur)
  }
  const arr = [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name))
  if (unknown > 0) arr.push({ name: 'Unknown', intl: false, count: unknown })
  return arr
}

/** Classify a roster row's origin using the normalized columns. */
function bucketOf(row) {
  const country = (row.hometown_country || '').trim()
  const state = (row.hometown_state || '').trim()
  const intl = !!country && !US_NAMES.has(country)
  if (intl) return { kind: 'intl', name: country }
  if (state) return { kind: 'state', name: state }
  return { kind: 'unknown', name: null }
}

/**
 * Recruiting geography over time. Two lenses:
 *   byRoster[year]     — everyone on that season's roster (footprint that year)
 *   byRecruit[year]    — players first seen that season (that recruiting class)
 *   all                — every distinct player, once (all-time footprint)
 * Each scope: { states:{name:count}, intl:{country:count}, unknown, total, distinctStates }.
 */
export function geographyOverTime(rosters, seasons) {
  const first = firstSeenMap(rosters)
  const repByPlayer = new Map() // freshest row per player (latest season)
  for (const r of rosters) {
    if (!r.player_id) continue
    const cur = repByPlayer.get(r.player_id)
    if (!cur || r.roster_season > cur.roster_season) repByPlayer.set(r.player_id, r)
  }

  const emptyScope = () => ({ states: {}, intl: {}, unknown: 0, total: 0, distinctStates: 0 })
  const add = (scope, row) => {
    const b = bucketOf(row)
    if (b.kind === 'state') scope.states[b.name] = (scope.states[b.name] || 0) + 1
    else if (b.kind === 'intl') scope.intl[b.name] = (scope.intl[b.name] || 0) + 1
    else scope.unknown++
    scope.total++
  }
  const finalize = s => { s.distinctStates = Object.keys(s.states).length; return s }

  const byRoster = {}, byRecruit = {}
  for (const y of seasons) { byRoster[y] = emptyScope(); byRecruit[y] = emptyScope() }
  const all = emptyScope()

  for (const r of rosters) if (byRoster[r.roster_season]) add(byRoster[r.roster_season], r)
  for (const [pid, row] of repByPlayer) {
    const fy = first.get(pid)
    if (byRecruit[fy]) add(byRecruit[fy], row)
    add(all, row)
  }

  for (const y of seasons) { finalize(byRoster[y]); finalize(byRecruit[y]) }
  finalize(all)
  return { seasons, byRoster, byRecruit, all }
}
