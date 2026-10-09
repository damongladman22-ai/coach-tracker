import { SEASON_YEARS } from './landscapeFormat.js'

/**
 * pinSeries — a pinned program's per-season composition and origin shares for
 * the Trend lens (backlog G6, Damon 2026-10-09: "Pin programs on Trend" for
 * Position mix, Class mix and Geography). Pure; tested by
 * test/pinSeries.test.mjs.
 *
 * Every value uses the EXACT definition the backdrop band uses (pipeline
 * rebuild_benchmarks_part.sql), so the pinned line is comparable with it:
 *   position   players at the position / players with GK, D, M or F;
 *              the season needs 9 such players
 *   class      players in the class / players with FR, SO, JR, SR or GR;
 *              the season needs 9 such players
 *   international  players whose hometown_country is not the United States /
 *              players with a hometown_country; needs 9 with a country
 *   in_state   U.S. players whose hometown_state equals the school's state /
 *              U.S. players ('United States') with a hometown_state; needs 9
 * A season below its floor gets no point (a gap in the line), as the backdrop
 * leaves such programs out.
 *
 * Each series: { [bucket]: [{ season, value }] } in season order.
 */
export const POSITION_BUCKETS = ['GK', 'D', 'M', 'F']
export const CLASS_BUCKETS = ['FR', 'SO', 'JR', 'SR', 'GR']
export const MIN_CLASSIFIED = 9
const US = 'United States'

function bySeason(rosters) {
  const out = {}
  for (const r of rosters || []) (out[r.roster_season] = out[r.roster_season] || []).push(r)
  return out
}

/** field: 'position' | 'class_year'; buckets: the valid values. */
export function compositionSeries(rosters, field, buckets) {
  const seasons = bySeason(rosters)
  const out = Object.fromEntries(buckets.map(b => [b, []]))
  for (const s of SEASON_YEARS) {
    const rows = (seasons[s] || []).filter(r => buckets.includes(r[field]))
    if (rows.length < MIN_CLASSIFIED) continue
    for (const b of buckets) out[b].push({ season: s, value: rows.filter(r => r[field] === b).length / rows.length })
  }
  return out
}

/** { international: [...], in_state: [...] } for one program. */
export function originSeries(rosters, schoolState) {
  const seasons = bySeason(rosters)
  const out = { international: [], in_state: [] }
  for (const s of SEASON_YEARS) {
    const rows = seasons[s] || []
    const withCountry = rows.filter(r => r.hometown_country != null && String(r.hometown_country) !== '')
    if (withCountry.length >= MIN_CLASSIFIED) {
      const intl = withCountry.filter(r => r.hometown_country !== US).length
      out.international.push({ season: s, value: intl / withCountry.length })
    }
    if (schoolState) {
      const dom = rows.filter(r => r.hometown_country === US && r.hometown_state != null && r.hometown_state !== '')
      if (dom.length >= MIN_CLASSIFIED) {
        out.in_state.push({ season: s, value: dom.filter(r => r.hometown_state === schoolState).length / dom.length })
      }
    }
  }
  return out
}
