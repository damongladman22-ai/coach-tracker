/**
 * Tests for src/college-profiles/data/recruitingStyle.js (backlog G8,
 * recruiting-strategy patterns). Plain node, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/recruitingStyle.test.mjs)
 */
import { bandOf, intlShareFromGeo, styleRows, styleShift, MIN_KNOWN } from '../src/college-profiles/data/recruitingStyle.js'
import { newcomerMix } from '../src/college-profiles/data/metrics.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const close = (a, b) => Math.abs(a - b) < 1e-9

// bandOf: strict, like the Arrivals card
const c = { p25: 0.2, p75: 0.4, median: 0.3 }
check('band high above p75', bandOf(0.41, c) === 'high')
check('band low below p25', bandOf(0.19, c) === 'low')
check('band edges are typical', bandOf(0.2, c) === 'typical' && bandOf(0.4, c) === 'typical')
check('band null without value or cell', bandOf(null, c) === null && bandOf(0.3, null) === null)

// intlShareFromGeo: the Geography card's latest-roster share
const geo = { seasons: [2025, 2026], byRoster: {
  2025: { intl: { England: 9 }, states: { Ohio: 1 } },
  2026: { intl: { England: 2, Canada: 1 }, states: { Ohio: 7, Texas: 2 } } } }
const ig = intlShareFromGeo(geo)
check('intl share uses the latest season', ig && close(ig.share, 3 / 12) && ig.known === 12, JSON.stringify(ig))
check('intl share null without data', intlShareFromGeo(null) === null && intlShareFromGeo({ seasons: [] }) === null)

// styleRows
const cells = {
  'experienced_newcomer_rate|overall|ALL': { p25: 0.2, p75: 0.4, median: 0.3, n: 300 },
  'share|origin|in_state': { p25: 0.2, p75: 0.5, median: 0.33, n: 300 },
  'share|origin|international': { p25: 0, p75: 0.12, median: 0.05, n: 300 },
  'return_rate|overall|ALL': { p25: 0.68, p75: 0.8, median: 0.74, n: 300 },
}
const scope = { cell: (m, d, b) => cells[`${m}|${d}|${b}`] || null }
const mix = { pooled: { known: 30, experienced: 3, share: 0.1 } }
const rows = styleRows({ mix, inState: { share: 0.08 }, intl: { share: 0.3 }, returnRate: 0.85, scope, schoolState: 'Ohio' })
const by = Object.fromEntries(rows.map(r => [r.key, r]))
check('four rows in order', rows.map(r => r.key).join() === 'build,reach,abroad,stability')
check('few experienced newcomers -> builds through freshmen', by.build.label === 'Builds through freshmen')
check('low in-state share -> mostly out of state', by.reach.label === 'Recruits mostly out of state')
check('reach detail names the state', by.reach.detail.includes('Ohio'))
check('high international share -> international lean', by.abroad.label === 'International lean')
check('high return rate -> stable roster', by.stability.label === 'Stable roster')
const r2 = Object.fromEntries(styleRows({ mix: { pooled: { known: 30, share: 0.55 } }, inState: { share: 0.7 }, intl: { share: 0 },
  returnRate: 0.5, scope, schoolState: 'Ohio' }).map(r => [r.key, r]))
check('many experienced newcomers -> leans on transfers', r2.build.label === 'Leans on transfers')
check('high in-state share -> heavily in-state', r2.reach.label === 'Recruits heavily in-state')
check('zero international with a p25 of 0 -> typical, never "mostly domestic"', r2.abroad.label === 'Typical international share')
check('low return rate -> high turnover', r2.stability.label === 'High turnover')
const r3 = Object.fromEntries(styleRows({ mix: { pooled: { known: MIN_KNOWN - 1, share: 0.9 } }, inState: null, intl: null,
  returnRate: null, scope: null }).map(r => [r.key, r]))
check('thin newcomers said plainly', r3.build.value === null && r3.build.label.startsWith('Too few newcomers'))
check('no state data said plainly', r3.reach.label.startsWith('Too few known home states'))
check('no back-to-back seasons said plainly', r3.stability.label.startsWith('Not enough back-to-back'))
const r4 = Object.fromEntries(styleRows({ mix, inState: { share: 0.3 }, intl: { share: 0.1 }, returnRate: 0.7, scope: null }).map(r => [r.key, r]))
check('no peer band -> no comparison', r4.build.band === null && r4.build.label === 'No peer comparison available')

// styleShift: built from newcomerMix transitions, against the peers' own drift
const roster = []
let id = 0
const season = (y, players) => players.forEach(([pid, cy]) => roster.push({ roster_season: y, player_id: pid, class_year: cy }))
// 2021 has no roster rows, so the first transition counted is 2022 -> 2023.
// 2023-2024 newcomers: all freshmen (12 per season); 2025-2026: 8 of 12 transfers
const returning = []
for (const y of [2021, 2022, 2023, 2024, 2025, 2026]) {
  const fresh = []
  if (y > 2021) {
    for (let i = 0; i < 12; i++) {
      const cy = y >= 2025 ? (i < 8 ? 'JR' : 'FR') : 'FR'
      fresh.push(['n' + (id++), cy])
    }
  }
  season(y, [...returning.map(p => [p, 'SO']), ...fresh])
  returning.length = 0
  fresh.forEach(([p]) => returning.push(p))
}
const seasons = [2021, 2022, 2023, 2024, 2025, 2026]
const m = newcomerMix(roster, seasons)
const peer = { 2022: 0.28, 2023: 0.31, 2024: 0.33, 2025: 0.37, 2026: 0.39 }
const sc = (metric, d, b, s) => (metric === 'experienced_newcomer_rate' && peer[s] != null ? { median: peer[s] } : null)
const sh = styleShift(m, 2026, sc)
check('shift toward transfers found', sh && sh.dir === 'toward', JSON.stringify(sh))
check('shift periods', sh && sh.recentSpan.join() === '2025,2026' && sh.earlierSpan.join() === '2023,2024')
check('shift values', sh && close(sh.recent, 16 / 24) && close(sh.earlier, 0) && close(sh.peerRecent, 0.38) && close(sh.peerEarlier, 0.32))
const flat = { 2022: 0.0, 2023: 0.0, 2024: 0.0, 2025: 0.64, 2026: 0.70 }
check('no shift when the peers moved as much',
  styleShift(m, 2026, (mm, d, b, s) => ({ median: flat[s] })) === null)
check('no shift without every peer season', styleShift(m, 2026, (mm, d, b, s) => (s === 2023 ? null : { median: 0.3 })) === null)
check('no shift without data', styleShift(null, 2026, sc) === null && styleShift(m, null, sc) === null)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
