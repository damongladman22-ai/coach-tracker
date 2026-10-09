/**
 * Tests for src/lib/divisionMix.js — plain node, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/divisionMix.test.mjs)
 */
import { divisionKey, divisionMix, inDivision } from '../src/lib/divisionMix.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

check('division names map to keys', divisionKey('NCAA D1') === 'D1' && divisionKey('NCAA D2') === 'D2' &&
  divisionKey('NCAA D3') === 'D3' && divisionKey('NAIA') === 'NAIA' && divisionKey('JC') === 'JC')
check('unknown or missing is Other', divisionKey('USCAA') === 'OTHER' && divisionKey(null) === 'OTHER')

// ECNL Girls Playoffs and Finals 2026, U16 Girls ECNL: 117 D1, 7 D2, 3 D3, 1 JC.
const s = (id, division) => ({ id, division })
const schools = []
for (let i = 0; i < 117; i++) schools.push(s('a' + i, 'NCAA D1'))
for (let i = 0; i < 7; i++) schools.push(s('b' + i, 'NCAA D2'))
for (let i = 0; i < 3; i++) schools.push(s('c' + i, 'NCAA D3'))
schools.push(s('d0', 'JC'))
const m = divisionMix(schools.concat(schools.slice(0, 20)))   // repeats: several coaches per college
check('counts colleges once each', m.total === 128, m.total)
check('parts in order, empty divisions left out', m.parts.map(p => p.key + p.count).join(' ') === 'D1117 D27 D33 JC1',
  m.parts.map(p => p.key + p.count).join(' '))
check('shares add to 1', Math.abs(m.parts.reduce((a, p) => a + p.share, 0) - 1) < 1e-9)
check('empty input', divisionMix([]).total === 0 && divisionMix(null).parts.length === 0)
check('rows without an id are ignored', divisionMix([{ division: 'NCAA D1' }]).total === 0)

check('ALL passes everything', inDivision(s('x', 'NAIA'), 'ALL') && inDivision(s('x', null), null))
check('a chip keeps only its division', inDivision(s('x', 'NCAA D2'), 'D2') && !inDivision(s('x', 'NCAA D1'), 'D2'))
check('Other chip holds unknown divisions', inDivision(s('x', 'USCAA'), 'OTHER'))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
