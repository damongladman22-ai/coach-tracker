/**
 * Tests for newcomerMix() in src/college-profiles/data/metrics.js — plain node,
 * no test runner, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/newcomerMix.test.mjs)
 *
 * newcomerMix feeds the "How the roster is built" card. These guard the
 * DEFINITION it shares with the experienced_newcomer_rate benchmark, because a
 * silent drift between the program's number and its peer median would make the
 * comparison on the card wrong without looking wrong.
 */
import { newcomerMix } from '../src/college-profiles/data/metrics.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const row = (season, id, cy) => ({ roster_season: season, player_id: id, class_year: cy })

console.log('newcomerMix')

// 1. The basic split. d and e are new in 2025; a and b returned.
{
  const r = [row(2024, 'a', 'FR'), row(2024, 'b', 'SO'), row(2024, 'c', 'SR'),
             row(2025, 'a', 'SO'), row(2025, 'b', 'JR'), row(2025, 'd', 'FR'), row(2025, 'e', 'SO')]
  const m = newcomerMix(r, [2024, 2025])
  check('one transition', m.transitions.length === 1)
  check('returners are not newcomers', m.pooled.known === 2, JSON.stringify(m.pooled))
  check('FR counted as freshman', m.pooled.fr === 1)
  check('SO counted as experienced', m.pooled.experienced === 1)
  check('share = experienced / known', m.pooled.share === 0.5)
}

// 2. A coverage gap is not a recruiting class.
{
  const r = [row(2023, 'a', 'FR'), row(2025, 'z', 'JR')]
  const m = newcomerMix(r, [2023, 2025])
  check('non-consecutive seasons are skipped', m.transitions.length === 0 && m.pooled.known === 0)
}

// 3. "Not on LAST season's roster", not "first seen ever" -- matching the
//    benchmark. A player who leaves for a year and returns counts again. This
//    is where it deliberately differs from newcomers().
{
  const r = [row(2024, 'a', 'FR'), row(2025, 'b', 'FR'), row(2026, 'a', 'JR'), row(2026, 'b', 'SO')]
  const m = newcomerMix(r, [2024, 2025, 2026])
  const t26 = m.transitions.find(t => t.to === 2026)
  check('a returner after a gap year is a newcomer again', t26 && t26.jr === 1 && t26.known === 1,
    JSON.stringify(t26))
}

// 4. A player listed twice in one season counts once.
{
  const r = [row(2024, 'a', 'FR'), row(2025, 'n', 'SO'), row(2025, 'n', 'SO')]
  const m = newcomerMix(r, [2024, 2025])
  check('duplicate roster rows count once', m.pooled.known === 1, JSON.stringify(m.pooled))
}

// 5. Rows with no player_id are ignored, as in the benchmark.
{
  const r = [row(2024, 'a', 'FR'), row(2025, null, 'JR'), row(2025, 'k', 'FR')]
  const m = newcomerMix(r, [2024, 2025])
  check('rows without a player_id are ignored', m.pooled.known === 1 && m.pooled.jr === 0)
}

// 6. Unknown class year is counted, but never in the share.
{
  const r = [row(2024, 'a', 'FR'), row(2025, 'u', null), row(2025, 'v', 'RS'), row(2025, 'w', 'GR')]
  const m = newcomerMix(r, [2024, 2025])
  check('unknown class years go to unk', m.pooled.unk === 2)
  check('unknown class years stay out of the share', m.pooled.known === 1 && m.pooled.share === 1)
  check('GR is experienced', m.pooled.gr === 1 && m.pooled.experienced === 1)
}

// 7. Pooled = counts summed across transitions, then divided -- not an
//    average of per-season rates.
{
  const r = [row(2023, 'a', 'FR'),
             row(2024, 'a', 'SO'), row(2024, 'b', 'JR'),                      // 2024: 1 new, experienced
             row(2025, 'a', 'JR'), row(2025, 'b', 'SR'),
             row(2025, 'c', 'FR'), row(2025, 'd', 'FR'), row(2025, 'e', 'FR')] // 2025: 3 new, freshmen
  const m = newcomerMix(r, [2023, 2024, 2025])
  check('pooled share is 1 of 4, not the average of 100% and 0%', m.pooled.share === 0.25,
    String(m.pooled.share))
}

// 8. Empty input is safe.
{
  const m = newcomerMix([], [])
  check('empty input gives a null share', m.pooled.known === 0 && m.pooled.share === null)
  const n = newcomerMix(null, null)
  check('null input does not throw', n.pooled.known === 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
