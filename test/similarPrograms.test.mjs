// "More like this" (src/lib/similarPrograms.js), offline.
import assert from 'node:assert/strict'
import { similarPrograms, miles } from '../src/lib/similarPrograms.js'

assert.ok(Math.abs(miles({ lat: 39.96, lon: -82.99 }, { lat: 39.74, lon: -84.18 }) - 65) < 5, 'Columbus to Dayton about 65 miles')

const S = (id, school, conference, division = 'NCAA D1', g = 'W') => ({ id, school, conference, division, program_gender: g, state: 'OH' })
const schools = [S('t', 'Target U', 'Atlantic 10'), S('a', 'Alpha', 'Atlantic 10'), S('b', 'Beta', 'Big East'), S('c', 'Gamma', 'MAC'),
  S('d3', 'Delta', 'NCAC', 'NCAA D3'), S('m', 'Alpha', 'Atlantic 10', 'NCAA D1', 'M')]
const F = (sat, adm, ug, np, control, locale, lat, lon) => ({ sat_average: sat, admission_rate: adm, undergrad_enrollment: ug, avg_net_price: np, control, locale, latitude: lat, longitude: lon })
const facts = new Map([
  ['t', F(1330, 0.65, 8000, 30000, 2, 12, 39.74, -84.18)],
  ['a', F(1300, 0.70, 7000, 28000, 2, 12, 39.10, -84.51)],
  ['b', F(1340, 0.60, 9000, 33000, 2, 11, 39.15, -84.47)],
  ['c', F(1100, 0.90, 20000, 15000, 1, 32, 41.65, -83.61)],
  ['d3', F(1330, 0.65, 8000, 30000, 2, 12, 40.0, -83.0)],
])
const r = similarPrograms(schools[0], facts.get('t'), schools, facts)
assert.deepEqual(r.map(x => x.school_id), ['a', 'b'], 'same conference and similar academics first; a dissimilar program left out')
assert.match(r[0].why, /same conference \(Atlantic 10\).*average SAT 1300 \(vs 1330\).*private/)
assert.ok(!r.some(x => x.school_id === 'd3' || x.school_id === 'm'), 'same division and gender only')
assert.equal(similarPrograms(schools[0], null, schools, new Map()).map(x => x.school_id).join(), 'a', 'no figures: conference alone')

console.log('similarPrograms.test.mjs: all assertions passed')
