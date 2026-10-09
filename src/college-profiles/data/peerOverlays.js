/**
 * peerOverlays — the program-side numbers for the G4 peer overlays (backlog
 * G4, Damon 2026-10-09: class mix, in-state share, per-season return-rate
 * ticks). Pure; tested by test/peerOverlays.test.mjs.
 *
 * Each number replicates the EXACT definition the peer substrate uses
 * (pipeline rebuild_benchmarks_part.sql), so the program is compared like for
 * like with the peer median and band:
 *
 *   class    share = players in the class / players with a class of FR, SO,
 *            JR, SR or GR. A program needs 9 such players to be in the
 *            substrate, so below 9 nothing is shown.
 *   in_state share = players whose hometown_country is 'United States' and
 *            whose hometown_state equals the school's state / players whose
 *            hometown_country is 'United States' with a hometown_state. The
 *            substrate needs 9 such players. Players with a state but no
 *            country are left out, as the substrate leaves them out.
 *   return rate per season: the benchmark row for the ARRIVAL season (the
 *            "to" season of each transition), never the pooled row.
 */

export const CLASSES = [
  { k: 'FR', label: 'Freshman' },
  { k: 'SO', label: 'Sophomore' },
  { k: 'JR', label: 'Junior' },
  { k: 'SR', label: 'Senior' },
  { k: 'GR', label: 'Graduate' },
]
export const MIN_CLASSED = 9
export const MIN_DOMESTIC = 9
export const MIN_SEASON_PEERS = 5

/** Current-roster class shares, or null below MIN_CLASSED classed players. */
export function classShares(roster) {
  const counts = { FR: 0, SO: 0, JR: 0, SR: 0, GR: 0 }
  for (const r of roster || []) if (r.class_year in counts) counts[r.class_year]++
  const classed = counts.FR + counts.SO + counts.JR + counts.SR + counts.GR
  if (classed < MIN_CLASSED) return null
  const shares = {}
  for (const c of CLASSES) shares[c.k] = counts[c.k] / classed
  return { classed, counts, shares }
}

/**
 * Which class rows to draw: a class the program has players in, or one where
 * the peer middle 50% is above zero. At a two-year college that leaves
 * Freshman and Sophomore instead of five rows, three of them empty.
 *   cellFor(k) -> benchmark cell or null
 */
export function classRowsToShow(mix, cellFor) {
  if (!mix) return []
  return CLASSES.filter(c => mix.counts[c.k] > 0 || ((cellFor(c.k)?.p75) || 0) > 0)
}

/** In-state share of the roster's U.S. players with a known state, or null. */
export function inStateShare(roster, schoolState) {
  if (!schoolState) return null
  let domestic = 0, inState = 0
  for (const r of roster || []) {
    if (r.hometown_country !== 'United States' || !r.hometown_state) continue
    domestic++
    if (r.hometown_state === schoolState) inState++
  }
  if (domestic < MIN_DOMESTIC) return null
  return { share: inState / domestic, inState, domestic }
}

/** The peer cell for one transition, or null when the season has too few peer programs. */
export function transitionPeer(seasonCell, transition) {
  if (!seasonCell || !transition) return null
  const b = seasonCell('return_rate', 'overall', 'ALL', transition.to)
  return b && b.n >= MIN_SEASON_PEERS && b.median != null ? b : null
}
