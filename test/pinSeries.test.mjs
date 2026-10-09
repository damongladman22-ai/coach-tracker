/**
 * Tests for src/csip-landscape/data/pinSeries.js (G6 Trend pinning). Plain
 * node, no deps.
 *
 *     npm test          (or: node test/pinSeries.test.mjs)
 */
import { compositionSeries, originSeries, POSITION_BUCKETS, CLASS_BUCKETS } from '../src/csip-landscape/data/pinSeries.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const near = (a, b) => Math.abs(a - b) < 1e-9
const rows = (season, n, f) => Array.from({ length: n }, (_, i) => ({ roster_season: season, ...f(i) }))

// 2024: 20 players, 2 GK / 6 D / 8 M / 4 F, plus 2 with no position. 2025: only 8 with a position.
const r = [
  ...rows(2024, 2, () => ({ position: 'GK' })), ...rows(2024, 6, () => ({ position: 'D' })),
  ...rows(2024, 8, () => ({ position: 'M' })), ...rows(2024, 4, () => ({ position: 'F' })),
  ...rows(2024, 2, () => ({ position: null })),
  ...rows(2025, 8, () => ({ position: 'D' })),
]
const pos = compositionSeries(r, 'position', POSITION_BUCKETS)
check('share over players with a position', near(pos.D[0].value, 6 / 20) && near(pos.GK[0].value, 0.1) && pos.D[0].season === 2024)
check('shares add to 1', near(POSITION_BUCKETS.reduce((a, b) => a + pos[b][0].value, 0), 1))
check('season below 9 classified: no point', pos.D.length === 1)
check('zero-filled: a position with nobody is 0', near(compositionSeries([...rows(2024, 9, () => ({ position: 'D' }))], 'position', POSITION_BUCKETS).GK[0].value, 0))

const cls = compositionSeries([...rows(2026, 6, () => ({ class_year: 'FR' })), ...rows(2026, 4, () => ({ class_year: 'SR' })), { roster_season: 2026, class_year: 'RS' }],
  'class_year', CLASS_BUCKETS)
check('class share ignores unknown classes', near(cls.FR[0].value, 0.6) && near(cls.SR[0].value, 0.4) && near(cls.GR[0].value, 0))

const us = st => ({ hometown_country: 'United States', hometown_state: st })
const geo = [
  ...rows(2025, 6, () => us('Ohio')), ...rows(2025, 3, () => us('Michigan')),
  ...rows(2025, 1, () => ({ hometown_country: 'England', hometown_state: null })),
  ...rows(2025, 2, () => ({ hometown_country: null, hometown_state: 'Ohio' })),   // no country: left out
]
const o = originSeries(geo, 'Ohio')
check('international over players with a country', o.international.length === 1 && near(o.international[0].value, 1 / 10), JSON.stringify(o))
check('in-state over U.S. players with a state', near(o.in_state[0].value, 6 / 9))
check('no school state: no in-state line', originSeries(geo, null).in_state.length === 0)
check('below 9 with a country: no point', originSeries(rows(2025, 8, () => us('Ohio')), 'Ohio').international.length === 0)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
