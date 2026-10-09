/**
 * Recruiting style — backlog G8, "recruiting-strategy patterns" (Damon,
 * 2026-10-09: a College Profile card first). Pure; tested by
 * test/recruitingStyle.test.mjs.
 *
 * WHAT IT DOES
 * Turns four numbers the profile already shows into plain labels, each read
 * against the peer group the page compares with (division or conference):
 *   build      experienced share of newcomers   (Arrivals card, newcomerMix pooled
 *                                                 vs experienced_newcomer_rate pooled)
 *   reach      in-state share of U.S. players    (Geography card, inStateShare
 *                                                 vs share / origin / in_state)
 *   abroad     international share               (Geography card, latest roster
 *                                                 vs share / origin / international)
 *   stability  underclassman return rate         (Roster stability card,
 *                                                 vs return_rate pooled)
 * Every value is computed exactly as the card it comes from computes it, so
 * the labels never disagree with the numbers elsewhere on the page.
 *
 * THE READING RULE (the same as Arrivals): above the peer p75 is "more than
 * most", below p25 is "fewer than most", in between is typical. The
 * distribution decides, not a fixed number of points.
 *
 * SHIFT (build only): has the program moved toward or away from transfers in
 * its two newest seasons, by more than its peer group moved? Only said when
 * both periods have at least MIN_KNOWN known-class newcomers, the change
 * beyond the peers' own change is at least SHIFT_PTS, and a two-proportion
 * test gives |z| >= SHIFT_Z. Measured on the 2022-2026 data (2026-10-09):
 * D1 experienced share rose from 28% to 39% over the period, so the peers'
 * own drift is subtracted; with these thresholds 90 of 1,898 programs with
 * enough newcomers are flagged.
 */

export const MIN_KNOWN = 10
export const SHIFT_PTS = 0.20
export const SHIFT_Z = 2.5

/** 'high' above p75, 'low' below p25, 'typical' between; null without a value or band. */
export function bandOf(value, cell) {
  if (value == null || !cell || cell.p25 == null || cell.p75 == null) return null
  if (value > cell.p75) return 'high'
  if (value < cell.p25) return 'low'
  return 'typical'
}

/**
 * International share as the Geography card computes it: from the latest
 * season of geographyOverTime().byRoster, international players over players
 * with a known origin (international countries + U.S. states).
 */
export function intlShareFromGeo(geo) {
  const seasons = geo?.seasons
  if (!seasons || !seasons.length) return null
  const scope = geo.byRoster?.[seasons[seasons.length - 1]]
  if (!scope) return null
  const intl = Object.values(scope.intl || {}).reduce((a, b) => a + b, 0)
  const dom = Object.values(scope.states || {}).reduce((a, b) => a + b, 0)
  const known = intl + dom
  return known ? { share: intl / known, intl, known } : null
}

export const LABELS = {
  build: { high: 'Leans on transfers', low: 'Builds through freshmen', typical: 'Typical mix of freshmen and transfers' },
  reach: { high: 'Recruits heavily in-state', low: 'Recruits mostly out of state', typical: 'Typical in-state share' },
  abroad: { high: 'International lean', low: 'Mostly domestic', typical: 'Typical international share' },
  stability: { high: 'Stable roster', low: 'High turnover', typical: 'Typical turnover' },
}

/**
 * The four rows. Inputs are the page's own values:
 *   mix        newcomerMix(...)            -> uses mix.pooled
 *   inState    inStateShare(...)           -> { share, inState, domestic } | null
 *   intl       intlShareFromGeo(...)       -> { share, intl, known } | null
 *   returnRate nonSeniorReturnRate(...).rate
 *   scope      useProgramBenchmarks().div | .conf (the page's peer toggle)
 *   schoolState for the reach wording
 * Each row: { key, title, value, cell, band, label, detail } where detail
 * names the measure. A row with no value or no peer band has band null and
 * a label saying why.
 */
export function styleRows({ mix, inState, intl, returnRate, scope, schoolState }) {
  const cell = (m, d, b, o) => (scope ? scope.cell(m, d, b, o) : null)
  const rows = []

  const p = mix?.pooled
  const buildVal = p && p.known >= MIN_KNOWN ? p.share : null
  rows.push({
    key: 'build', title: 'How it builds', value: buildVal,
    cell: cell('experienced_newcomer_rate', 'overall', 'ALL', { pooled: true }),
    detail: 'of its newcomers arrive with college experience',
    thinText: 'Too few newcomers tracked to say',
  })
  rows.push({
    key: 'reach', title: 'Reach', value: inState ? inState.share : null,
    cell: cell('share', 'origin', 'in_state'),
    detail: `of its U.S. players are from ${schoolState || 'its own state'}`,
    thinText: 'Too few known home states to say',
  })
  rows.push({
    key: 'abroad', title: 'International', value: intl ? intl.share : null,
    cell: cell('share', 'origin', 'international'),
    detail: 'of its players come from outside the U.S.',
    thinText: 'Too few known hometowns to say',
  })
  rows.push({
    key: 'stability', title: 'Stability', value: returnRate ?? null,
    cell: cell('return_rate', 'overall', 'ALL', { pooled: true }),
    detail: 'of players with eligibility left come back the next season',
    thinText: 'Not enough back-to-back seasons tracked to say',
  })

  for (const r of rows) {
    r.band = bandOf(r.value, r.cell)
    // "Mostly domestic" needs a real lower tail: when a quarter of peers have
    // no international players at all, being below p25 is impossible anyway.
    if (r.key === 'abroad' && r.band === 'low' && !(r.cell.p25 > 0)) r.band = 'typical'
    r.label = r.value == null ? r.thinText
      : r.band ? LABELS[r.key][r.band]
        : 'No peer comparison available'
  }
  return rows
}

/**
 * Shift toward / away from transfers in the two newest seasons.
 *   mix          newcomerMix(...) (uses mix.transitions)
 *   currentSeason the program's newest roster season S
 *   seasonCell   scope.seasonCell (experienced_newcomer_rate per season)
 * Recent = newcomers arriving in S-1 and S; earlier = before S-1.
 * Returns null when there is not enough to say, or when the change is not
 * clearly bigger than the peers' own change. Otherwise
 *   { dir: 'toward' | 'away', recent, earlier, recentSpan, earlierSpan,
 *     peerRecent, peerEarlier, rel, z }
 */
export function styleShift(mix, currentSeason, seasonCell) {
  if (!mix?.transitions?.length || currentSeason == null || !seasonCell) return null
  const rec = { known: 0, exp: 0, seasons: [] }
  const ear = { known: 0, exp: 0, seasons: [] }
  for (const t of mix.transitions) {
    const g = t.to >= currentSeason - 1 ? rec : ear
    g.known += t.known; g.exp += t.experienced; g.seasons.push(t.to)
  }
  if (rec.known < MIN_KNOWN || ear.known < MIN_KNOWN) return null
  const peerAvg = seasons => {
    const v = seasons.map(s => seasonCell('experienced_newcomer_rate', 'overall', 'ALL', s)?.median)
      .filter(x => x != null && Number.isFinite(x))
    return v.length === seasons.length && v.length ? v.reduce((a, b) => a + b, 0) / v.length : null
  }
  const peerRecent = peerAvg(rec.seasons)
  const peerEarlier = peerAvg(ear.seasons)
  if (peerRecent == null || peerEarlier == null) return null
  const pr = rec.exp / rec.known
  const pe = ear.exp / ear.known
  const pp = (rec.exp + ear.exp) / (rec.known + ear.known)
  const se = Math.sqrt(pp * (1 - pp) * (1 / rec.known + 1 / ear.known))
  if (!(se > 0)) return null
  const rel = (pr - pe) - (peerRecent - peerEarlier)
  const z = rel / se
  if (Math.abs(rel) < SHIFT_PTS || Math.abs(z) < SHIFT_Z) return null
  const span = s => (s.length ? [Math.min(...s), Math.max(...s)] : null)
  return {
    dir: rel > 0 ? 'toward' : 'away', recent: pr, earlier: pe,
    recentSpan: span(rec.seasons), earlierSpan: span(ear.seasons),
    peerRecent, peerEarlier, rel, z,
  }
}
