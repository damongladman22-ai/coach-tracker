/**
 * Find programs (backlog F3) -- the pure parts: states, regions, ranking and
 * the plain-words reason on each row. No network. Tested by
 * test/findPrograms.test.mjs.
 *
 * Decisions (Damon, 2026-10-09): rank by openings first; division, men's /
 * women's and states are hard filters, never part of the score.
 *
 * The numbers come from program_openings_outlook (pipeline
 * out_sql/17_program_openings_outlook.sql), built with the same rules as the
 * College Profile "Projected openings" card (college-profiles/data/metrics.js).
 */

export const POSITIONS = [
  { code: 'GK', one: 'goalkeeper', many: 'goalkeepers' },
  { code: 'D', one: 'defender', many: 'defenders' },
  { code: 'M', one: 'midfielder', many: 'midfielders' },
  { code: 'F', one: 'forward', many: 'forwards' },
]

export const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'JC']

// U.S. Census Bureau regions. Washington, D.C. is in the South.
export const STATES = [
  ['AL', 'Alabama', 'South'], ['AK', 'Alaska', 'West'], ['AZ', 'Arizona', 'West'],
  ['AR', 'Arkansas', 'South'], ['CA', 'California', 'West'], ['CO', 'Colorado', 'West'],
  ['CT', 'Connecticut', 'Northeast'], ['DE', 'Delaware', 'South'],
  ['DC', 'District of Columbia', 'South'], ['FL', 'Florida', 'South'],
  ['GA', 'Georgia', 'South'], ['HI', 'Hawaii', 'West'], ['ID', 'Idaho', 'West'],
  ['IL', 'Illinois', 'Midwest'], ['IN', 'Indiana', 'Midwest'], ['IA', 'Iowa', 'Midwest'],
  ['KS', 'Kansas', 'Midwest'], ['KY', 'Kentucky', 'South'], ['LA', 'Louisiana', 'South'],
  ['ME', 'Maine', 'Northeast'], ['MD', 'Maryland', 'South'],
  ['MA', 'Massachusetts', 'Northeast'], ['MI', 'Michigan', 'Midwest'],
  ['MN', 'Minnesota', 'Midwest'], ['MS', 'Mississippi', 'South'], ['MO', 'Missouri', 'Midwest'],
  ['MT', 'Montana', 'West'], ['NE', 'Nebraska', 'Midwest'], ['NV', 'Nevada', 'West'],
  ['NH', 'New Hampshire', 'Northeast'], ['NJ', 'New Jersey', 'Northeast'],
  ['NM', 'New Mexico', 'West'], ['NY', 'New York', 'Northeast'],
  ['NC', 'North Carolina', 'South'], ['ND', 'North Dakota', 'Midwest'], ['OH', 'Ohio', 'Midwest'],
  ['OK', 'Oklahoma', 'South'], ['OR', 'Oregon', 'West'], ['PA', 'Pennsylvania', 'Northeast'],
  ['RI', 'Rhode Island', 'Northeast'], ['SC', 'South Carolina', 'South'],
  ['SD', 'South Dakota', 'Midwest'], ['TN', 'Tennessee', 'South'], ['TX', 'Texas', 'South'],
  ['UT', 'Utah', 'West'], ['VT', 'Vermont', 'Northeast'], ['VA', 'Virginia', 'South'],
  ['WA', 'Washington', 'West'], ['WV', 'West Virginia', 'South'], ['WI', 'Wisconsin', 'Midwest'],
  ['WY', 'Wyoming', 'West'], ['PR', 'Puerto Rico', 'Territories'],
]
export const REGIONS = ['Northeast', 'Midwest', 'South', 'West']

const BY_ABBR = new Map(STATES.map(([a]) => [a, a]))
const BY_NAME = new Map(STATES.map(([a, n]) => [n.toLowerCase(), a]))
// Keys are compared with one trailing period removed.
for (const k of ['washington, d.c', 'washington dc', 'washington d.c', 'd.c', 'dc']) BY_NAME.set(k, 'DC')

/** 'Ohio' | 'OH' | ' oh ' -> 'OH'; anything else -> null. */
export function stateAbbr(value) {
  const s = String(value || '').trim()
  if (!s) return null
  if (BY_ABBR.has(s.toUpperCase())) return s.toUpperCase()
  return BY_NAME.get(s.toLowerCase().replace(/\.$/, '')) || null
}

export function statesInRegion(region) {
  return STATES.filter(s => s[2] === region).map(s => s[0])
}

export function stateName(abbr) {
  const s = STATES.find(x => x[0] === abbr)
  return s ? s[1] : abbr
}

const num = v => (v == null || v === '' ? null : Number(v))

/** The number a program is ranked by: estimated openings for freshmen. The
 * database fills a thin program's freshman share from its division, so this
 * is set for nearly every row; all estimated openings is the last fallback. */
export function rankValue(row) {
  const f = num(row.est_freshman)
  return f != null ? f : (num(row.est_spots) ?? 0)
}

/**
 * Keep the rows that pass the hard filters and order them by openings.
 *   rows       program_openings_outlook rows with an embedded `schools` object
 *   divisions  Set of division names (empty or null = every division)
 *   states     Set of state abbreviations (empty or null = every state)
 *   minSeason  leave out programs whose newest roster is older than this
 *              (their numbers would describe a different entering class)
 * Ties: more players graduating first, then name. Returns a new array.
 */
export function rankPrograms(rows, { divisions = null, states = null, minSeason = null } = {}) {
  const out = (rows || []).filter(r => {
    const s = r.schools || {}
    if (minSeason != null && (r.current_season == null || r.current_season < minSeason)) return false
    if (divisions && divisions.size && !divisions.has(s.division)) return false
    if (states && states.size && !states.has(stateAbbr(s.state))) return false
    return true
  })
  return out.sort((a, b) =>
    (rankValue(b) - rankValue(a)) ||
    ((b.graduating || 0) - (a.graduating || 0)) ||
    String(a.schools?.school || '').localeCompare(String(b.schools?.school || '')))
}

/** Rounded for display: 0.4 -> 'under 1', 2.6 -> 'about 3'. */
export function aboutText(x) {
  const v = num(x)
  if (v == null) return null
  if (v < 0.5) return 'under 1'
  return 'about ' + Math.round(v)
}

const plural = (n, one, many) => (n === 1 ? one : many)

/**
 * Plain-words reasons for one row, in the order the page shows them.
 * Every number is the program's own; nothing is a guess dressed as a fact:
 * graduations are counted, early leavers and the freshman share are averages.
 */
export function reasons(row, posCode, entryYear) {
  const p = POSITIONS.find(x => x.code === posCode) || { one: 'player', many: 'players' }
  const out = []
  const g = row.graduating || 0
  out.push(g === 0
    ? `No ${p.many} on the current roster finish before fall ${entryYear}.`
    : `${g} ${plural(g, p.one, p.many)} on the current roster ${plural(g, 'finishes', 'finish')} before fall ${entryYear}.`)
  const er = num(row.early_rate)
  if (er != null && (row.continuing || 0) > 0) {
    const early = (row.continuing || 0) * er
    const more = aboutText(early)
    const n = Math.round(early)
    out.push(`It usually loses ${Math.round(er * 100)}% of players who still have eligibility, ` +
      `which could free ${more} more ${p.one} ${more !== 'under 1' && n > 1 ? 'spots' : 'spot'}.`)
  } else if (er == null) {
    out.push('Not enough seasons tracked to estimate early leavers.')
  }
  const fs = num(row.fresh_share)
  if (fs != null && row.fresh_share_source === 'division') {
    const div = row.schools?.division || 'its division'
    out.push(`Too few of its newcomers are tracked, so this uses ${div}: ` +
      `${Math.round(fs * 100)}% of newcomers there arrive as freshmen.`)
  } else if (fs != null) {
    out.push(`${Math.round(fs * 100)}% of its newcomers arrive as freshmen; the rest transfer in.`)
  } else {
    out.push('Too few newcomers tracked to say how many arrive as freshmen.')
  }
  return out
}

/** True when the program's newest roster is older than the newest anywhere. */
export function isBehind(row, latestSeason) {
  return latestSeason != null && row.current_season != null && row.current_season < latestSeason
}
