/**
 * Tests for nonSeniorReturnRate() in src/college-profiles/data/metrics.js —
 * plain node, no test runner, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/returnRate.test.mjs)
 *
 * The early-leaver definition here is SHARED with program_early_departures
 * (pipeline out_sql/12_program_early_departures.sql). The Roster stability card
 * shows the browser's return rate beside the database's leaver counts, so a
 * drift between the two would put two different populations on one card.
 */
import { nonSeniorReturnRate } from '../src/college-profiles/data/metrics.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const row = (season, id, cy) => ({ roster_season: season, player_id: id, class_year: cy })

console.log('nonSeniorReturnRate')

// The same roster the SQL was tested with (school A): p1 FR, p2 SO, p3 JR,
// p4 SR, p5 no class, p6 JR listed twice; p1 and p3 return.
const a = [row(2024, 'p1', 'FR'), row(2024, 'p2', 'SO'), row(2024, 'p3', 'JR'),
           row(2024, 'p4', 'SR'), row(2024, 'p5', null), row(2024, 'p6', 'JR'),
           row(2024, 'p6', 'JR'), row(2025, 'p1', 'SO'), row(2025, 'p3', 'SR')]

// 1. Four-year school: SR and GR are not eligible; a missing class is.
{
  const r = nonSeniorReturnRate(a, [2024, 2025])
  const t = r.transitions[0]
  check('eligible = FR, SO, JR, no-class, once each', t && t.eligible === 5, JSON.stringify(t))
  check('returned counts p1 and p3', t && t.returned === 2)
  check('rate = returned / eligible', t && t.rate === 0.4)
  check('earlyDeparture = 1 - rate', Math.abs(r.earlyDeparture - 0.6) < 1e-12)
}

// 2. No division given behaves exactly like a four-year school.
{
  const r1 = nonSeniorReturnRate(a, [2024, 2025])
  const r2 = nonSeniorReturnRate(a, [2024, 2025], { division: 'NCAA D1' })
  check('division other than JC changes nothing', r1.transitions[0].eligible === r2.transitions[0].eligible)
}

// 3. JC: only first-years (and no-class) are eligible. A sophomore who finishes
//    is not an early departure.
{
  const j = [row(2024, 'j1', 'FR'), row(2024, 'j2', 'SO'), row(2024, 'j3', 'FR'),
             row(2025, 'j3', 'SO'), row(2025, 'j4', 'FR')]
  const r = nonSeniorReturnRate(j, [2024, 2025], { division: 'JC' })
  const t = r.transitions[0]
  check('JC eligible = first-years only', t && t.eligible === 2, JSON.stringify(t))
  check('JC sophomore leaving is not counted', t && t.returned === 1 && t.rate === 0.5)
  const four = nonSeniorReturnRate(j, [2024, 2025])
  check('same roster as a four-year school counts the sophomore', four.transitions[0].eligible === 3)
}

// 4. Nothing to compare.
{
  const r = nonSeniorReturnRate([row(2025, 'x', 'FR')], [2025])
  check('one season gives no rate', r.rate === null && r.earlyDeparture === null)
  const s = nonSeniorReturnRate([row(2024, 'x', 'SR'), row(2025, 'y', 'FR')], [2024, 2025])
  check('a season of seniors only gives no transition', s.transitions.length === 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
