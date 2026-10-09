/**
 * Tests for src/college-profiles/data/resultsStanding.js — plain node, no
 * deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/resultsStanding.test.mjs)
 */
import {
  divShort, ordinal, inProgress, buildPeerIndex, standing, headlineLines, rowText,
  MIN_GAMES, MIN_DIV_PEERS,
} from '../src/college-profiles/data/resultsStanding.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

// Helpers
check('division short names', divShort('D-I') === 'D1' && divShort('D-II') === 'D2' && divShort('D-III') === 'D3' &&
  divShort('NCAA D2') === 'D2' && divShort('NAIA') === 'NAIA')
check('ordinals', ordinal(1) === '1st' && ordinal(2) === '2nd' && ordinal(3) === '3rd' && ordinal(4) === '4th' &&
  ordinal(11) === '11th' && ordinal(12) === '12th' && ordinal(13) === '13th' && ordinal(21) === '21st' && ordinal(22) === '22nd')
check('season in progress until 15 December', inProgress(2026, new Date(2026, 9, 9)) &&
  inProgress(2026, new Date(2026, 11, 14)) && !inProgress(2026, new Date(2026, 11, 15)) &&
  !inProgress(2025, new Date(2026, 9, 9)) && !inProgress(2026, new Date(2027, 0, 5)))

// A D-I women's season: 20 programs. Numbers come back from Supabase as strings.
const row = (id, w, l, t, conf, cw, cl, ct, rank, season = 2025, division = 'D-I') => {
  const g = w + l + t
  const cg = cw == null ? 0 : cw + cl + ct
  return {
    school_id: id, season: String(season), division, conference: conf,
    wins: String(w), losses: String(l), ties: String(t),
    win_pct: g ? ((w + 0.5 * t) / g).toFixed(3) : null,
    conf_wins: cw == null ? null : String(cw), conf_losses: cl == null ? null : String(cl), conf_ties: ct == null ? null : String(ct),
    conf_win_pct: cg ? ((cw + 0.5 * ct) / cg).toFixed(3) : null,
    rpi_rank: rank == null ? null : String(rank),
  }
}
const rows = []
// Big Ten: b0 best overall (15-1-0), b1..b4 below; conference records differ from overall order.
rows.push(row('b0', 15, 1, 0, 'Big Ten', 6, 2, 0, 2))
rows.push(row('b1', 12, 4, 0, 'Big Ten', 7, 1, 0, 9))
rows.push(row('b2', 10, 6, 0, 'Big Ten', 5, 3, 0, 30))
rows.push(row('b3', 10, 6, 0, 'Big Ten', 2, 6, 0, 31))
rows.push(row('b4', 4, 12, 0, 'Big Ten', 0, 8, 0, 200))
// Others: 15 programs from 14-2 down to 0-16.
for (let i = 0; i < 15; i++) rows.push(row('o' + i, 14 - i, 2 + i, 0, 'Other', null, null, null, i < 10 ? 3 + i * 10 : null))
// Too few games: counts for nothing.
rows.push(row('few', 3, 0, 0, 'Big Ten', null, null, null, null))
// A different season, to check seasons do not mix.
rows.push(row('b0', 1, 15, 0, 'Big Ten', 0, 8, 0, null, 2024))
const idx = buildPeerIndex(rows)

check('index groups by season and division', idx.get('2025|D-I').length === 21 && idx.get('2024|D-I').length === 1)

// Division standing
const sB2 = standing('b2', 2025, idx, 'div')
// b2 is 10-6 (.625). Peers with 5+ games: 19 others. Strictly lower: b4 (.250) and o5..o14 (8-8 .500 down) = 11.
// o4 is 10-6 too (a tie, not counted as lower).
check('better than: strictly lower, rounded down', sB2.record.kind === 'div' && sB2.record.pct === Math.floor(100 * 11 / 19),
  JSON.stringify(sB2.record))
check('division peer count includes the program', sB2.record.n === 20)
check('too-few-games peers are left out', !idx.get('2025|D-I').filter(r => r.id === 'few').some(r => r.games >= MIN_GAMES))
const sB0 = standing('b0', 2025, idx, 'div')
check('best record', sB0.record.best && !sB0.record.tied && sB0.record.pct === 100)
check('headline: best', headlineLines(sB0, 'D1 Women')[0].text === 'Best record in D1 Women')
check('headline: better than', headlineLines(sB2, 'D1 Women')[0].text === `Better record than ${sB2.record.pct}% of D1 Women`)
check('headline: peer count note', headlineLines(sB2, 'D1 Women')[0].note === 'of 20 programs with 5+ games')
check('row: better than', rowText(sB2) === `Better than ${sB2.record.pct}%`, rowText(sB2))
check('row: names another division', rowText(sB2, 'D2 Women') === `Better than ${sB2.record.pct}% of D2 Women`)
check('row: best', rowText(sB0) === 'Best' && rowText(sB0, 'D2 Women') === 'Best in D2 Women')

// Ties at the top
const tieRows = rows.filter(r => r.season === '2025').concat([row('b5', 15, 1, 0, 'Big Ten', 4, 4, 0, 5)])
const tIdx = buildPeerIndex(tieRows)
const tB0 = standing('b0', 2025, tIdx, 'div')
check('tied for the best', tB0.record.best && tB0.record.tied &&
  headlineLines(tB0, 'D1 Women')[0].text === 'Tied for the best record in D1 Women')

// Conference standing
const cB2 = standing('b2', 2025, idx, 'conf')
check('conference: tied 3rd-best record of 5', cB2.record.kind === 'conf' && cB2.record.rank === 3 && cB2.record.tied &&
  cB2.record.of === 5, JSON.stringify(cB2.record))
check('conference: headline wording', headlineLines(cB2, 'D1 Women')[0].text === 'Tied 3rd-best record of 5 in the Big Ten',
  headlineLines(cB2, 'D1 Women')[0].text)
check('conference: conference-record rank is separate', cB2.confRecord.rank === 3 && !cB2.confRecord.tied && cB2.confRecord.of === 5,
  JSON.stringify(cB2.confRecord))
check('conference: second line', headlineLines(cB2, 'D1 Women')[1].text === '3rd-best conference record of 5')
const cB1 = standing('b1', 2025, idx, 'conf')
check('conference: best conference record', headlineLines(cB1, 'D1 Women')[1].text === 'Best conference record of 5')
check('conference: row text', rowText(cB2) === 'Tied 3rd-best record of 5', rowText(cB2))
check('conference: row names another conference', rowText(cB2, null, true) === 'Tied 3rd-best record of 5 in the Big Ten')
check('conference: row text 1st', rowText(standing('b0', 2025, idx, 'conf')) === 'Best record of 5')
const cO3 = standing('o3', 2025, idx, 'conf')
check('conference: no conference record, no second line', cO3.record.kind === 'conf' && cO3.confRecord === null)
const smallConf = buildPeerIndex([row('x1', 9, 1, 0, 'Tiny', 3, 0, 0, null), row('x2', 5, 5, 0, 'Tiny', 1, 2, 0, null),
  ...rows.filter(r => r.season === '2025' && r.conference !== 'Big Ten')])
check('conference with fewer than 4 programs says nothing', standing('x1', 2025, smallConf, 'conf').record === null)

// Ranking "of N"
check('rank of N counts ranked programs that season', sB0.rankOf === 15, String(sB0.rankOf))
check('no rank, no of N', standing('o12', 2025, idx, 'div').rankOf === null)

// Too few games / missing
const sFew = standing('few', 2025, idx, 'div')
check('too few games', sFew.tooFewGames && sFew.record === null && rowText(sFew) === null)
check('too few games headline', headlineLines(sFew, 'D1 Women')[0].text === `Standing among peers shows after ${MIN_GAMES} games.` &&
  headlineLines(sFew, 'D1 Women')[0].muted)
check('seasons do not mix', standing('b0', 2024, idx, 'div').tooFewGames === false &&
  standing('b0', 2024, idx, 'div').record === null)
check('unknown program is null', standing('zz', 2025, idx, 'div') === null && headlineLines(null, 'x').length === 0)
check('no index is null', standing('b0', 2025, null, 'div') === null)
const thin = buildPeerIndex(rows.filter(r => r.season === '2025').slice(0, MIN_DIV_PEERS))
check('division with too few peers says nothing', standing('b0', 2025, thin, 'div').record === null)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
