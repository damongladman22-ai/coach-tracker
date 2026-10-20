// Tests for src/ask/welcomeExamples.js (assistant welcome screen examples).
import { GROUPS, groupQs, cleanGender } from '../src/ask/welcomeExamples.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name)
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const all = g => GROUPS.flatMap(gr => groupQs(gr, g)).map(x => x.q)

check('gender values cleaned', cleanGender('w') === 'W' && cleanGender(' M ') === 'M' &&
  cleanGender('x') === null && cleanGender(null) === null && cleanGender('') === null)

const none = all(null)
check('no pick: no gender named', none.every(q => !/women|men's/i.test(q)), none.find(q => /women|men's/i.test(q)))
check('no pick: no double spaces', none.every(q => !/  /.test(q)), none.find(q => /  /.test(q)))
check('no pick: first example reads cleanly',
  none[0] === 'Which D3 programs within 150 miles of Columbus, Ohio will need a goalkeeper for the class of 2028?', none[0])
check('no pick: nursing example starts with D2', none[1].startsWith('D2 and D3 programs'), none[1])

const w = all('W'), m = all('M')
check("women's pick names women's", w.filter(q => /women's/i.test(q)).length === 5, String(w.filter(q => /women's/i.test(q)).length))
check("men's pick names men's only", m.filter(q => /\bmen's/i.test(q)).length === 5 && !m.some(q => /women/i.test(q)))
check("men's wording", m[2] === "How has Kenyon men's soccer done over the last three seasons, and who is on the staff?", m[2])
check("men's nursing example", m[1].startsWith("Men's D2 and D3 programs"), m[1])
check('same count every way', none.length === 8 && w.length === 8 && m.length === 8)

const plan = GROUPS[3]
check('team example hidden for a widget', groupQs(plan, 'M', false).length === 1 && groupQs(plan, 'M', true).length === 2)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
