// Tests for src/ask/welcomeExamples.js (assistant welcome screen examples).
import { GROUPS, groupQs, cleanGender, findPlaceholder, splitPlaceholders } from '../src/ask/welcomeExamples.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) console.log('  ok   ' + name)
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const all = g => GROUPS.flatMap(gr => groupQs(gr, g)).map(x => x.q)

check('gender values cleaned', cleanGender('w') === 'W' && cleanGender(' M ') === 'M' &&
  cleanGender('x') === null && cleanGender(null) === null && cleanGender('') === null)

// Gender wording
const none = all(null)
check('no pick: no gender named', none.every(q => !/women|men's/i.test(q)), none.find(q => /women|men's/i.test(q)))
check('no pick: no double spaces', none.every(q => !/ {2}/.test(q)), none.find(q => / {2}/.test(q)))
check('no pick: first example reads cleanly',
  none[0] === 'Which programs within [distance] miles of [town or ZIP] will need a [position] for the class of [year]?', none[0])
const w = all('W'), m = all('M')
check("women's pick names women's", w.filter(q => /women's/i.test(q)).length === 5, String(w.filter(q => /women's/i.test(q)).length))
check("men's pick names men's only", m.filter(q => /\bmen's/i.test(q)).length === 5 && !m.some(q => /women/i.test(q)))
check("men's wording", m[2] === "How has [college] men's soccer done over the last three seasons, and who is on the staff?", m[2])
check('same count every way', none.length === 8 && w.length === 8 && m.length === 8)

// No college, town or score is chosen for the family
check('no named colleges', !none.some(q => /Kenyon|Denison|Wesleyan|Wooster|Columbus|1250/.test(q)))
check('college examples ask for the college', none.slice(2, 6).every(q => q.includes('[college]')))
check('every example but the team one has a part to fill', none.filter(q => !findPlaceholder(q)).length === 1)

// Placeholders
const t = 'Draft an email to the [college] soccer coaches about [topic]'
check('first placeholder', JSON.stringify(findPlaceholder(t)) === JSON.stringify({ start: 22, end: 31 }), JSON.stringify(findPlaceholder(t)))
check('next placeholder after the cursor', findPlaceholder(t, 31).start === t.indexOf('[topic]'))
check('wraps to the first', findPlaceholder(t, t.length).start === 22)
check('none left', findPlaceholder('Draft an email to the Kenyon soccer coaches') === null)
check('ignores a long bracket', findPlaceholder('see [' + 'x'.repeat(60) + ']') === null)
const parts = splitPlaceholders('Which [a] or [b]?')
check('split for display', parts.map(p => (p.ph ? '<' + p.text + '>' : p.text)).join('') === 'Which <[a]> or <[b]>?')

const plan = GROUPS[3]
check('team example hidden for a widget', groupQs(plan, 'M', false).length === 1 && groupQs(plan, 'M', true).length === 2)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
