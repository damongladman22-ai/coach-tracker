/**
 * Tests for src/college-profiles/data/peerOverlays.js — plain node, no deps.
 * Exit code is the verdict.
 *
 *     npm test          (or: node test/peerOverlays.test.mjs)
 */
import {
  classShares, classRowsToShow, inStateShare, transitionPeer, CLASSES, MIN_CLASSED, MIN_DOMESTIC,
} from '../src/college-profiles/data/peerOverlays.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const near = (a, b) => Math.abs(a - b) < 1e-9

// Class mix: shares over players WITH a class; unknown classes left out
const roster = [
  ...Array(6).fill({ class_year: 'FR' }), ...Array(5).fill({ class_year: 'SO' }), ...Array(4).fill({ class_year: 'JR' }),
  ...Array(3).fill({ class_year: 'SR' }), ...Array(2).fill({ class_year: 'GR' }),
  { class_year: null }, { class_year: 'RS' }, { class_year: '' },
]
const mix = classShares(roster)
check('classed counts only FR-GR', mix.classed === 20, String(mix?.classed))
check('shares over classed players', near(mix.shares.FR, 0.3) && near(mix.shares.GR, 0.1))
check('shares add to 1', near(CLASSES.reduce((a, c) => a + mix.shares[c.k], 0), 1))
check('below 9 classed players: nothing', classShares(Array(MIN_CLASSED - 1).fill({ class_year: 'FR' })) === null &&
  classShares(Array(MIN_CLASSED).fill({ class_year: 'FR' })) !== null)
check('empty roster: nothing', classShares([]) === null && classShares(null) === null)

// Which rows: present, or peers have it
const jc = classShares([...Array(12).fill({ class_year: 'FR' }), ...Array(8).fill({ class_year: 'SO' })])
const jcCells = { FR: { p75: 0.6 }, SO: { p75: 0.45 }, JR: { p75: 0 }, SR: { p75: 0 }, GR: null }
check('two-year college shows FR and SO only', classRowsToShow(jc, k => jcCells[k]).map(c => c.k).join(',') === 'FR,SO')
const fourCells = { FR: { p75: 0.3 }, SO: { p75: 0.25 }, JR: { p75: 0.25 }, SR: { p75: 0.2 }, GR: { p75: 0.08 } }
const noGr = classShares([...Array(5).fill({ class_year: 'FR' }), ...Array(5).fill({ class_year: 'SR' })])
check('a class the peers have still shows at 0%', classRowsToShow(noGr, k => fourCells[k]).length === 5)
check('no mix, no rows', classRowsToShow(null, () => null).length === 0)

// In-state: U.S. players with a known state; exact state match; state-without-country left out
const us = (st) => ({ hometown_country: 'United States', hometown_state: st })
const geo = [
  ...Array(4).fill(us('Ohio')), ...Array(6).fill(us('Michigan')),
  { hometown_country: 'Canada', hometown_state: 'Ontario' },
  { hometown_country: 'United States', hometown_state: null },
  { hometown_country: null, hometown_state: 'Ohio' },
]
const ins = inStateShare(geo, 'Ohio')
check('in-state share over U.S. players with a state', ins && ins.domestic === 10 && ins.inState === 4 && near(ins.share, 0.4),
  JSON.stringify(ins))
check('state without a country is left out (as the substrate does)', ins.inState === 4)
check('below 9 U.S. players with a state: nothing', inStateShare(Array(MIN_DOMESTIC - 1).fill(us('Ohio')), 'Ohio') === null)
check('no school state: nothing', inStateShare(geo, null) === null && inStateShare(geo, '') === null)
check('exact match only', inStateShare(geo, 'OH').inState === 0)

// Per-season peer cell: arrival season, n >= 5
const cells = {
  2025: { median: 0.78, n: 290, p25: 0.7, p75: 0.85 },
  2026: { median: 0.8, n: 4 },
}
const seasonCell = (m, d, b, season) => (m === 'return_rate' && d === 'overall' && b === 'ALL' ? cells[season] || null : null)
check('uses the arrival season', transitionPeer(seasonCell, { from: 2024, to: 2025 }).median === 0.78)
check('fewer than 5 peer programs: no tick', transitionPeer(seasonCell, { from: 2025, to: 2026 }) === null)
check('missing season: no tick', transitionPeer(seasonCell, { from: 2020, to: 2021 }) === null)
check('no benchmark: no tick', transitionPeer(undefined, { from: 2024, to: 2025 }) === null)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
