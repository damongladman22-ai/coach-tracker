// Reach / Good fit / Safety (src/lib/fitTier.js), offline.
import assert from 'node:assert/strict'
import { satEquivalent, strengthIndex, academicFit, athleticFit, fitFor, tierCounts } from '../src/lib/fitTier.js'

assert.equal(satEquivalent(1250), 1250)
assert.equal(satEquivalent(28), 1310, 'ACT read as ACT')
assert.equal(satEquivalent(21, 'ACT'), 1080)
assert.equal(satEquivalent(2000), null)

// Strength: twelve D1 women's programs ranked by RPI, a D2 program by record.
const programOf = new Map()
const rows = []
for (let i = 1; i <= 12; i++) {
  programOf.set('d1-' + i, { division: 'NCAA D1', gender: 'W' })
  rows.push({ school_id: 'd1-' + i, season: 2025, wins: 10, losses: 5, ties: 1, rpi_rank: i * 10 })
  programOf.set('d2-' + i, { division: 'NCAA D2', gender: 'W' })
  rows.push({ school_id: 'd2-' + i, season: 2026, wins: i, losses: 12 - i, ties: 0 })
  rows.push({ school_id: 'd2-' + i, season: 2024, wins: 99, losses: 0, ties: 0 })   // three seasons back: ignored
}
const idx = strengthIndex(rows, programOf)
assert.equal(idx.get('d1-1').pct, 1, 'best RPI is the strongest')
assert.equal(idx.get('d1-12').pct, 0)
assert.equal(idx.get('d1-1').basis, 'RPI')
assert.equal(idx.get('d2-12').basis, 'record')
assert.ok(idx.get('d2-12').pct > idx.get('d2-1').pct)

// Academic.
assert.equal(academicFit({ sat_average: 1400, admission_rate: 0.6 }, 1250).tier, 'reach', '150 above')
assert.equal(academicFit({ sat_average: 1250, admission_rate: 0.2 }, 1250).tier, 'reach', 'admits under 25%')
assert.equal(academicFit({ sat_average: 1100, admission_rate: 0.8 }, 1250).tier, 'safety')
assert.equal(academicFit({ sat_average: 1100, admission_rate: 0.4 }, 1250).tier, 'good', 'selective even if below')
assert.equal(academicFit({ sat_average: 1220, admission_rate: 0.7 }, 1250).tier, 'good')
assert.equal(academicFit({ sat_average: null, admission_rate: 0.85 }, 1250).tier, 'safety')
assert.equal(academicFit({ admission_rate: 0.2 }, null).tier, 'reach', 'no score: admission rate only')
assert.equal(academicFit({}, 1250), null)
assert.match(academicFit({ sat_average: 1350, admission_rate: 0.5 }, 1250).why, /average SAT 1350, 100 above yours, admits 50%/)

// Athletic.
const s = pct => ({ pct, basis: 'RPI' })
assert.equal(athleticFit('NCAA D1', s(0.9), ['NCAA D1']).tier, 'reach', 'top quarter at a single level')
assert.equal(athleticFit('NCAA D1', s(0.5), ['NCAA D1']).tier, 'good')
assert.equal(athleticFit('NCAA D1', s(0.1), ['NCAA D1']).tier, 'safety')
assert.equal(athleticFit('NCAA D1', s(0.6), ['NCAA D1', 'NCAA D2']).tier, 'reach', 'stronger half of the top level')
assert.equal(athleticFit('NCAA D1', s(0.3), ['NCAA D1', 'NCAA D2']).tier, 'good')
assert.equal(athleticFit('NCAA D2', s(0.3), ['NCAA D1', 'NCAA D2']).tier, 'safety', 'weaker half of the bottom level')
assert.equal(athleticFit('NCAA D2', s(0.7), ['NCAA D1', 'NCAA D2']).tier, 'good')
assert.equal(athleticFit('NCAA D1', s(0.1), ['NCAA D2', 'NCAA D3']).tier, 'reach', 'above the target')
assert.equal(athleticFit('NCAA D3', s(0.9), ['NCAA D1']).tier, 'safety', 'below the target')
assert.equal(athleticFit('NAIA', null, ['NAIA', 'JC']).tier, 'good', 'no results data')
assert.equal(athleticFit('NCAA D1', s(0.5), null), null, 'any level: no athletic label')
assert.equal(athleticFit('NCAA D1', s(0.5), ['NCAA D1'], 0.2).tier, 'reach', 'few openings move it toward reach')
assert.match(athleticFit('NCAA D1', s(0.5), ['NCAA D1'], 0.2).why, /under one estimated freshman opening/)
assert.match(athleticFit('NCAA D1', s(0.8), ['NCAA D1'], null, 'W').why, /top quarter of D1 women by RPI/)

// Overall.
const p = (o = {}) => ({ division: 'NCAA D1', gender: 'W', sat_average: 1250, admission_rate: 0.7, est_freshman: 2, ...o })
const me = { sat: 1250, targets: ['NCAA D1'] }
assert.equal(fitFor(p({ sat_average: 1400 }), s(0.5), me).tier, 'reach', 'academic reach wins')
assert.equal(fitFor(p(), s(0.9), me).tier, 'reach', 'athletic reach wins')
assert.equal(fitFor(p(), s(0.5), me).tier, 'good')
assert.equal(fitFor(p(), s(0.1), me).tier, 'safety', 'athletic safety, academic good at a 70% college')
assert.equal(fitFor(p({ admission_rate: 0.4 }), s(0.1), me).tier, 'good', 'not a safety at a selective college')
assert.equal(fitFor(p({ sat_average: 1100, admission_rate: 0.9 }), s(0.5), { sat: 1250, targets: null }).tier, 'safety', 'no level: academic alone')
assert.equal(fitFor(p({ sat_average: null, admission_rate: null }), s(0.5), { sat: null, targets: null }), null)
const f = fitFor(p(), s(0.1), me)
assert.equal(f.label, 'Safety')
assert.equal(f.why.length, 2)
assert.deepEqual(tierCounts([f, fitFor(p(), s(0.9), me), null]), { reach: 1, good: 0, safety: 1 })

console.log('fitTier.test.mjs: all assertions passed')
