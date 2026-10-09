// Pure, coverage-agnostic metric helpers for College Profiles.
// Every function reads the loaded active-roster rows (all seasons) and the
// derived season list; nothing here touches the network or PitchSide.

const TERMINAL = new Set(['SR', 'GR']) // exhausted / near-exhausted eligibility
// At a two-year college a sophomore has finished, so only first-years still have
// eligibility there. Shared with program_early_departures (pipeline
// out_sql/12_program_early_departures.sql) -- change both or neither.
const JC_TERMINAL = new Set(['SO', 'JR', 'SR', 'GR'])

// "JC" is not enough to know a program is two-year: 29 of 598 JC programs list
// juniors and seniors, and 9 of them are four-year rosters outright (Abraham
// Baldwin, East Central, Union County, ...; measure_jc_class_labels.py,
// 2026-09-29). A JC counts as two-year unless at least this share of its active
// roster rows, across every tracked season, are JR / SR / GR (Damon,
// 2026-09-29). The SQL uses the same test on the same rows.
export const TWO_YEAR_MAX_UPPER_SHARE = 0.25
const UPPER = new Set(['JR', 'SR', 'GR'])

/** True when a JC program's own rosters look two-year. Pass every loaded roster row. */
export function isTwoYearProgram(rosters, division) {
  if (division !== 'JC') return false
  const rows = rosters || []
  let upper = 0
  for (const r of rows) if (UPPER.has(r.class_year)) upper++
  return upper < TWO_YEAR_MAX_UPPER_SHARE * rows.length || rows.length === 0
}
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
 * Denominator = players with remaining eligibility in season N (not SR/GR; at a
 * JC, first-years only); numerator = those still present in N+1.
 * Only back-to-back seasons count (Damon, 2026-10-09). A program tracked in
 * 2021 and 2026 only has no 2021 -> 2022 data, and treating 2021 -> 2026 as one
 * year counted every 2021 underclassman who had simply graduated as an early
 * leaver (Notre Dame W: 0% return, ~22 early leavers on the openings card).
 * program_early_departures (pipeline out_sql/12) already required N+1, and
 * program_openings_outlook (out_sql/17) applies the same rule.
 * Pass { twoYear } (isTwoYearProgram) so a two-year program is judged on
 * two-year eligibility: a sophomore there who finishes is not an early departure.
 * Returns { rate, earlyDeparture, transitions:[{from,to,eligible,returned,rate}] }
 */
export function nonSeniorReturnRate(rosters, seasons, { twoYear = false } = {}) {
  const terminal = twoYear ? JC_TERMINAL : TERMINAL
  const transitions = []
  for (let i = 0; i < seasons.length - 1; i++) {
    const a = seasons[i], b = seasons[i + 1]
    if (b !== a + 1) continue
    const nextIds = idsInSeason(rosters, b)
    let eligible = 0, returned = 0
    const seen = new Set()
    for (const r of rosters) {
      if (r.roster_season !== a || !r.player_id) continue
      if (terminal.has(r.class_year)) continue
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

/**
 * Deterministic spots opening after the current season = players with no
 * eligibility left: SR + GR, and at a two-year program also SO + JR.
 */
export function projectedOpeningsAfterCurrent(currentRoster, { twoYear = false } = {}) {
  const terminal = twoYear ? JC_TERMINAL : TERMINAL
  return (currentRoster || []).filter(r => terminal.has(r.class_year)).length
}

/**
 * Next-season estimate for Projected openings (item 1 of the transfer-display
 * plan, Damon 2026-09-29). An ESTIMATE, for next season only; the graduation
 * bars stay facts.
 *   graduating   = current-roster rows whose grad_year is next season -- the
 *                  card's own "next" bar, counted the same way, so they agree
 *   eligible     = the rest of the roster that still has eligibility, by the
 *                  same rule as nonSeniorReturnRate (two-year: first-years only)
 *   earlyLeavers = eligible x this program's own early-departure rate
 *   spots        = graduating + earlyLeavers
 *   freshmen     = spots x (1 - this program's experienced share of newcomers),
 *                  only when at least `minKnown` newcomers are tracked
 * Returns null when there is no early-departure rate to project from.
 */
export function nextSeasonOpeningsEstimate({ currentRoster, currentSeason, returnStats, mix, twoYear = false, minKnown = 10 }) {
  if (currentSeason == null || !returnStats || returnStats.earlyDeparture == null) return null
  const terminal = twoYear ? JC_TERMINAL : TERMINAL
  const season = currentSeason + 1
  let graduating = 0, eligible = 0
  for (const r of currentRoster || []) {
    if (r.grad_year === season) { graduating++; continue }
    if (!terminal.has(r.class_year)) eligible++
  }
  const earlyRate = returnStats.earlyDeparture
  const earlyLeavers = eligible * earlyRate
  const spots = graduating + earlyLeavers
  const p = mix?.pooled
  const frShare = p && p.known >= minKnown && p.share != null ? 1 - p.share : null
  const freshmen = frShare == null ? null : spots * frShare
  return { season, graduating, eligible, earlyRate, earlyLeavers, spots, frShare, freshmen }
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

/** 'state|city' exactly as stored: the hometown_geocodes key (G5). */
export function cityKey(state, city) { return `${state}|${city}` }

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
 * Each scope: { states:{name:count}, intl:{country:count}, cities:{key:count},
 *               unknown, total, distinctStates }.
 * cities (backlog G5, 2026-10-09) counts U.S. players by 'state|city' with
 * the two values EXACTLY as stored, the key of the hometown_geocodes table;
 * a U.S. player with no city counts toward the state only.
 */
export function geographyOverTime(rosters, seasons) {
  const first = firstSeenMap(rosters)
  const repByPlayer = new Map() // freshest row per player (latest season)
  for (const r of rosters) {
    if (!r.player_id) continue
    const cur = repByPlayer.get(r.player_id)
    if (!cur || r.roster_season > cur.roster_season) repByPlayer.set(r.player_id, r)
  }

  const emptyScope = () => ({ states: {}, intl: {}, cities: {}, unknown: 0, total: 0, distinctStates: 0 })
  const add = (scope, row) => {
    const b = bucketOf(row)
    if (b.kind === 'state') {
      scope.states[b.name] = (scope.states[b.name] || 0) + 1
      if ((row.hometown_city || '').trim()) {
        const k = cityKey(row.hometown_state, row.hometown_city)
        scope.cities[k] = (scope.cities[k] || 0) + 1
      }
    } else if (b.kind === 'intl') scope.intl[b.name] = (scope.intl[b.name] || 0) + 1
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


/**
 * Roster composition over time: per-season counts by position group, plus the
 * multi-year average and first->last delta per group. Reads the full-roster
 * rows already loaded (coverage-agnostic).
 * Returns { seasons, rows:[{season,total,byPos:{GK,D,M,F},unlisted}], avg, delta }
 */
export function compositionOverTime(rosters, seasons) {
  const groups = ['GK', 'D', 'M', 'F']
  const rows = seasons.map(y => {
    const inYear = rosters.filter(r => r.roster_season === y)
    const byPos = { GK: 0, D: 0, M: 0, F: 0 }
    let unlisted = 0
    for (const r of inYear) {
      if (byPos[r.position] != null) byPos[r.position]++
      else unlisted++
    }
    const total = byPos.GK + byPos.D + byPos.M + byPos.F
    return { season: y, total, byPos, unlisted }
  })
  const avg = { GK: 0, D: 0, M: 0, F: 0 }
  for (const g of groups) {
    const sum = rows.reduce((a, r) => a + r.byPos[g], 0)
    avg[g] = rows.length ? sum / rows.length : 0
  }
  const delta = { GK: 0, D: 0, M: 0, F: 0 }
  if (rows.length >= 2) {
    const first = rows[0].byPos, last = rows[rows.length - 1].byPos
    for (const g of groups) delta[g] = last[g] - first[g]
  }
  return { seasons, rows, avg, delta }
}


/** Median of a numeric array (assumes length > 0). */
function medianOf(nums) {
  const s = [...nums].sort((a, b) => a - b)
  const mid = s.length >> 1
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

/**
 * Size profile: height by position group for the current roster, with the
 * program median (the headline), average, min/max spread, and sample size, on
 * a shared height domain. The division/conference benchmark overlay (median +
 * p25–p75 IQR band) is applied at the card layer from program_benchmarks.
 * Returns { domainMin, domainMax, groups:[{k,label,n,median,avg,min,max}] }
 */
export function sizeProfile(currentRoster) {
  const groups = [
    { k: 'F', label: 'Attack' },
    { k: 'M', label: 'Midfield' },
    { k: 'D', label: 'Defense' },
    { k: 'GK', label: 'Goalkeeper' },
  ]
  let dMin = Infinity, dMax = -Infinity
  const out = groups.map(g => {
    const hs = (currentRoster || [])
      .filter(r => r.position === g.k && r.height_inches != null)
      .map(r => r.height_inches)
    if (!hs.length) return { ...g, n: 0 }
    const n = hs.length
    const avg = hs.reduce((a, b) => a + b, 0) / n
    const median = medianOf(hs)
    const min = Math.min(...hs), max = Math.max(...hs)
    dMin = Math.min(dMin, min); dMax = Math.max(dMax, max)
    return { ...g, n, median, avg, min, max }
  })
  if (!isFinite(dMin)) { dMin = 60; dMax = 76 } else { dMin -= 1; dMax += 1 }
  return { domainMin: dMin, domainMax: dMax, groups: out }
}

/**
 * How each season's newcomers arrived — as freshmen, or with college experience.
 * Feeds the "How the roster is built" card (transfer-display plan, 2026-09-28).
 *
 * NEWCOMER here = on season N+1's roster and NOT on season N's, per consecutive
 * transition. That deliberately matches the `experienced_newcomer_rate` and
 * `newcomer_rate` benchmarks, so the program's number and its peer median are
 * computed the same way. (`newcomers()` above means "first seen ever"; the two
 * differ only for a player who leaves and later returns.) A gap in coverage —
 * 2023 then 2025 — is skipped rather than read as a recruiting class.
 *
 * CLASS YEAR CARRIES THE MEASURE. A newcomer listed SO/JR/SR/GR almost always
 * arrived from another program: measured 2026-09-28, only 3.0% of the transfers
 * recorded then are listed FR. It covers every program, where traced transfer
 * records cover about two in five experienced newcomers (41.6%, 2026-10-02).
 *
 * POOLED across transitions (counts summed, then divided) rather than averaged:
 * a small program's per-season newcomer count is too noisy to average.
 *
 * Returns {
 *   transitions: [{ from, to, fr, so, jr, sr, gr, unk, known, experienced, share }],
 *   pooled:      { fr, so, jr, sr, gr, unk, known, experienced, share },
 * }   share = experienced / known, or null when nothing is known.
 */
export function newcomerMix(rosters, seasons) {
  const CLASSES = ['FR', 'SO', 'JR', 'SR', 'GR']
  const blank = () => ({ fr: 0, so: 0, jr: 0, sr: 0, gr: 0, unk: 0 })
  const finish = o => {
    const known = o.fr + o.so + o.jr + o.sr + o.gr
    const experienced = o.so + o.jr + o.sr + o.gr
    return { ...o, known, experienced, share: known ? experienced / known : null }
  }
  const transitions = []
  const pooled = blank()
  const list = seasons || []
  for (let i = 0; i < list.length - 1; i++) {
    const a = list[i], b = list[i + 1]
    if (b !== a + 1) continue
    const prev = idsInSeason(rosters || [], a)
    if (!prev.size) continue
    const t = blank()
    const seen = new Set()
    for (const r of rosters || []) {
      if (r.roster_season !== b || !r.player_id) continue
      if (seen.has(r.player_id)) continue
      seen.add(r.player_id)
      if (prev.has(r.player_id)) continue
      const cy = String(r.class_year || '').toUpperCase().trim()
      const k = CLASSES.includes(cy) ? cy.toLowerCase() : 'unk'
      t[k]++
      pooled[k]++
    }
    transitions.push({ from: a, to: b, ...finish(t) })
  }
  return { transitions, pooled: finish(pooled) }
}
