/**
 * Tests for src/lib/findPrograms.js — plain node, no deps. Exit code is the
 * verdict.
 *
 *     npm test          (or: node test/findPrograms.test.mjs)
 */
import {
  stateAbbr, statesInRegion, rankValue, rankPrograms, aboutText, reasons, isBehind, STATES,
} from '../src/lib/findPrograms.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

// States
check('state names and abbreviations', stateAbbr('Ohio') === 'OH' && stateAbbr(' oh ') === 'OH' &&
  stateAbbr('OH') === 'OH' && stateAbbr('District of Columbia') === 'DC' && stateAbbr('Washington, D.C.') === 'DC')
check('unknown state is null', stateAbbr('Ontario') === null && stateAbbr('') === null && stateAbbr(null) === null)
check('50 states + DC + PR', STATES.length === 52)
check('every state is in a region', STATES.every(s => ['Northeast', 'Midwest', 'South', 'West', 'Territories'].includes(s[2])))
check('Midwest has 12 states', statesInRegion('Midwest').length === 12)

// Ranking value: freshman estimate when known, else all spots; numerics may be strings
check('rank by freshman estimate', rankValue({ est_spots: '4.00', est_freshman: '3.10' }) === 3.1)
check('fall back to all spots', rankValue({ est_spots: '4.00', est_freshman: null }) === 4)

const row = (id, school, division, state, spots, fresh, grad) =>
  ({ school_id: id, est_spots: spots, est_freshman: fresh, graduating: grad,
     schools: { school, division, state } })
const rows = [
  row('a', 'Alpha', 'NCAA D1', 'Ohio', '2.00', '1.50', 2),
  row('b', 'Bravo', 'NCAA D1', 'Michigan', '5.00', '2.00', 3),
  row('c', 'Charlie', 'NCAA D3', 'Ohio', '3.00', null, 1),
  row('d', 'Delta', 'NCAA D1', 'California', '2.00', '2.00', 2),
  row('e', 'Echo', 'NCAA D1', 'Texas', '2.00', '2.00', 4),
]
const ids = list => list.map(r => r.school_id).join('')
check('no filters: openings first, ties by graduating then name',
  ids(rankPrograms(rows)) === 'cebda', ids(rankPrograms(rows)))
check('division filter is hard', ids(rankPrograms(rows, { divisions: new Set(['NCAA D3']) })) === 'c')
check('state filter is hard and reads full names', ids(rankPrograms(rows, { states: new Set(['OH']) })) === 'ca')
check('empty sets mean everything', rankPrograms(rows, { divisions: new Set(), states: new Set() }).length === 5)
check('does not reorder the input', ids(rows) === 'abcde')
const aged = rows.map((r, i) => ({ ...r, current_season: i === 1 ? 2024 : 2026 }))
check('extra hard filter (major)', ids(rankPrograms(rows, { keep: r => r.school_id !== 'c' })) === 'ebda')
check('too-old rosters left out', ids(rankPrograms(aged, { minSeason: 2025 })) === 'ceda', ids(rankPrograms(aged, { minSeason: 2025 })))

// Display text
check('about text', aboutText(0.4) === 'under 1' && aboutText(2.6) === 'about 3' && aboutText(null) === null)
const r1 = reasons({ graduating: 3, continuing: 6, early_rate: '0.15', fresh_share: '0.8' }, 'D', 2027)
check('reason: graduations counted', r1[0] === '3 defenders on the current roster finish before fall 2027.', r1[0])
check('reason: early leavers', r1[1] === 'It is expected to lose about 15% of players who still have eligibility, which could free about 1 more defender spot.', r1[1])
const r6 = reasons({ graduating: 3, continuing: 10, early_rate: '0.22', transitions: 0, fresh_share: '0.8' }, 'D', 2027)
check('reason: no history -> similar programs, said plainly', r6[1] ===
  'Too few seasons tracked for its own history, so this uses similar programs: about 22% of players who still have eligibility are expected to leave, which could free about 2 more defender spots.', r6[1])
const r7 = reasons({ graduating: 3, continuing: 10, early_rate: '0.22', transitions: 4, fresh_share: '0.8' }, 'D', 2027)
check('reason: with history -> expected', r7[1].startsWith('It is expected to lose about 22%'), r7[1])
const r4 = reasons({ graduating: 2, continuing: 12, early_rate: '0.25', fresh_share: null }, 'M', 2027)
check('reason: plural spots', r4[1].endsWith('could free about 3 more midfielder spots.'), r4[1])
check('reason: freshman share', r1[2].startsWith('80% of its newcomers arrive as freshmen'), r1[2])
const r2 = reasons({ graduating: 1, continuing: 0, early_rate: null, fresh_share: null }, 'GK', 2028)
check('reason: singular', r2[0] === '1 goalkeeper on the current roster finishes before fall 2028.', r2[0])
check('reason: no rate said plainly', r2[1] === 'Not enough seasons tracked to estimate early leavers.')
check('reason: no share said plainly', r2[2].startsWith('Too few newcomers'))
const r5 = reasons({ graduating: 2, continuing: 0, early_rate: null, fresh_share: '0.6', fresh_share_source: 'division',
  schools: { division: 'NCAA D1' } }, 'D', 2027)
check('reason: division share named', r5[2] === 'Too few of its newcomers are tracked, so this uses NCAA D1: 60% of newcomers there arrive as freshmen.', r5[2])
const r3 = reasons({ graduating: 0, continuing: 2, early_rate: '0.1', fresh_share: '0.5' }, 'F', 2027)
check('reason: none graduating', r3[0] === 'No forwards on the current roster finish before fall 2027.', r3[0])
check('reason: under 1 more', r3[1].endsWith('could free under 1 more forward spot.'), r3[1])

check('roster behind', isBehind({ current_season: 2025 }, 2026) && !isBehind({ current_season: 2026 }, 2026))

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
