/**
 * Tests for nextSeasonOpeningsEstimate() and projectedOpeningsAfterCurrent() in
 * src/college-profiles/data/metrics.js — plain node, no deps. Exit code is the
 * verdict.
 *
 *     npm test          (or: node test/openingsEstimate.test.mjs)
 *
 * The estimate sits under the graduation bars on Projected openings, so its
 * "graduating" must be counted exactly like the card's "next" bar, and its
 * early-leaver base must use the same eligibility rule as the return rate it
 * multiplies. These guard both.
 */
import { nextSeasonOpeningsEstimate, projectedOpeningsAfterCurrent, projectedOpeningsByYear } from '../src/college-profiles/data/metrics.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const close = (a, b) => Math.abs(a - b) < 1e-9
const p = (id, cy, gy) => ({ id, player_id: id, class_year: cy, grad_year: gy, position: 'M' })

console.log('nextSeasonOpeningsEstimate')

// 2026 roster: 3 seniors graduating 2027, 1 GR graduating 2027, 6 still eligible.
const roster = [p('a', 'SR', 2027), p('b', 'SR', 2027), p('c', 'SR', 2027), p('d', 'GR', 2027),
                p('e', 'JR', 2028), p('f', 'JR', 2028), p('g', 'SO', 2029), p('h', 'SO', 2029),
                p('i', 'FR', 2030), p('j', 'FR', 2030)]
const returnStats = { rate: 0.8, earlyDeparture: 0.2 }
const mix = { pooled: { known: 40, share: 0.25 } }

// 1. The arithmetic.
{
  const e = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats, mix })
  check('season is next season', e.season === 2027)
  check('graduating = rows with next grad_year', e.graduating === 4, JSON.stringify(e))
  check('eligible = the rest with eligibility', e.eligible === 6)
  check('early leavers = eligible x rate', close(e.earlyLeavers, 1.2))
  check('spots = graduating + early leavers', close(e.spots, 5.2))
  check('freshman share = 1 - experienced share', close(e.frShare, 0.75))
  check('freshmen = spots x freshman share', close(e.freshmen, 3.9))
  const bar = projectedOpeningsByYear(roster, 2026)[0]
  check('graduating equals the card\'s "next" bar', bar.isNext && bar.total === e.graduating)
}

// 2. A senior whose grad_year is missing is neither graduating nor eligible.
{
  const e = nextSeasonOpeningsEstimate({ currentRoster: [...roster, p('k', 'SR', null)], currentSeason: 2026, returnStats, mix })
  check('SR without grad_year is not counted as eligible', e.eligible === 6 && e.graduating === 4)
}

// 3. JC: only first-years are eligible to leave early.
{
  const jc = [p('a', 'SO', 2027), p('b', 'SO', 2027), p('c', 'FR', 2028), p('d', 'FR', 2028), p('e', 'SO', 2028)]
  const e = nextSeasonOpeningsEstimate({ currentRoster: jc, currentSeason: 2026, returnStats: { earlyDeparture: 0.5 }, mix, twoYear: true })
  check('JC eligible = first-years only', e.eligible === 2, JSON.stringify(e))
  check('JC early leavers use first-years', close(e.earlyLeavers, 1))
}

// 4. Missing history.
{
  check('no return rate -> no estimate',
    nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats: { rate: null, earlyDeparture: null }, mix }) === null)
  check('no season -> no estimate',
    nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: null, returnStats, mix }) === null)
  const thin = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats, mix: { pooled: { known: 6, share: 0.5 } } })
  check('too few newcomers -> spots but no freshman split', thin && thin.freshmen === null && thin.frShare === null && close(thin.spots, 5.2))
}

// 5. G8: the departure outlook replaces the own average when present.
{
  const own = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats, mix })
  check('no outlook -> own average, said so', own.rateSource === 'own' && close(own.earlyRate, 0.2))
  const o = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats, mix,
    outlook: { rate: 0.25, transitions: 5, basis: 'program' } })
  check('outlook rate used', close(o.earlyRate, 0.25) && close(o.earlyLeavers, 1.5) && close(o.spots, 5.5), JSON.stringify(o))
  check('outlook basis and years carried', o.rateSource === 'program' && o.transitions === 5)
  const d = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026,
    returnStats: { rate: null, earlyDeparture: null }, mix, outlook: { rate: '0.3', transitions: 0, basis: 'division' } })
  check('no history but an outlook -> estimate from similar programs', d && d.rateSource === 'division' && close(d.earlyLeavers, 1.8), JSON.stringify(d))
  const bad = nextSeasonOpeningsEstimate({ currentRoster: roster, currentSeason: 2026, returnStats, mix, outlook: { rate: null } })
  check('outlook without a rate -> own average', bad.rateSource === 'own')
  // Parity with Find programs: early_rate x continuing (S+1) = this card's early leavers.
  check('same base as Find programs (continuing for S+1)', o.eligible === 6)
}

console.log('\nprojectedOpeningsAfterCurrent')
{
  check('four-year: SR + GR', projectedOpeningsAfterCurrent(roster) === 4)
  const jc = [p('a', 'SO', 2027), p('b', 'FR', 2028), p('c', 'FR', 2028)]
  check('JC: sophomores count as openings', projectedOpeningsAfterCurrent(jc, { twoYear: true }) === 1)
  check('JC roster read as four-year misses them', projectedOpeningsAfterCurrent(jc) === 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
