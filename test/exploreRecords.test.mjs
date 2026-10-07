/**
 * Tests for src/lib/exploreRecords.js — plain node, no deps. Exit code is the
 * verdict.
 *
 *     npm test          (or: node test/exploreRecords.test.mjs)
 */
import { indexResults, seasonsOffered, seasonLabel, sortByRecord, sortByRank, recordText, MIN_GAMES } from '../src/lib/exploreRecords.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

const res = [
  // Supabase returns numerics as strings; the index must coerce them.
  { school_id: 'a', season: 2026, wins: '1', losses: '0', ties: '0', win_pct: '1.000', rpi_rank: null, division: 'D-III' },
  { school_id: 'b', season: 2026, wins: 9, losses: 1, ties: 0, win_pct: 0.9, rpi_rank: 12, division: 'D-I' },
  { school_id: 'c', season: 2026, wins: 6, losses: 2, ties: 2, win_pct: 0.7, rpi_rank: 3, division: 'D-II' },
  { school_id: 'd', season: 2026, wins: 7, losses: 3, ties: 0, win_pct: 0.7, rpi_rank: 1, division: 'D-I' },
  { school_id: 'b', season: 2025, wins: 5, losses: 10, ties: 1, win_pct: 0.344, rpi_rank: 140, division: 'D-I' },
  { school_id: 'a', season: 2024, wins: 1, losses: 1, ties: 1, win_pct: 0.5, rpi_rank: null, division: 'D-III' },
]
const idx = indexResults(res)
const rows = ['a', 'b', 'c', 'd', 'e'].map(id => ({ id, school: id.toUpperCase() + ' College' }))
const cur = idx.get(2026)

console.log('index and seasons')
check('coerces strings', cur.get('a').wins === 1 && cur.get('a').winPct === 1)
check('rank system from division', cur.get('b').system === 'RPI' && cur.get('c').system === 'NPI' && cur.get('a').system === null)
check('offers the latest two seasons', JSON.stringify(seasonsOffered(idx)) === '[2026,2025]')
check('latest season reads "so far" in October', seasonLabel(2026, 2026, new Date(2026, 9, 7)) === '2026 so far')
check('latest season reads "final" after mid-December', seasonLabel(2026, 2026, new Date(2026, 11, 20)) === '2026 final')
check('earlier season reads "final"', seasonLabel(2025, 2026, new Date(2026, 9, 7)) === '2025 final')
check('record text', recordText(cur.get('c')) === '6–2–2')

console.log('sortByRecord')
const byRec = sortByRecord(rows, cur).map(r => r.id).join('')
// b (.900, 10 games), then d (.700, 10 games) before c (.700, 10 games)? equal
// pct and games -> by name: C before D. a has 1 game (< MIN_GAMES) -> after the
// ranked tier. e has no record -> last.
check('MIN_GAMES is 5', MIN_GAMES === 5)
check('a 1-0-0 team does not top the list', byRec === 'bcdae', byRec)

console.log('sortByRank')
const byRank = sortByRank(rows, cur).map(r => r.id).join('')
// RPI list first (d #1, b #12), then NPI (c #3), then unranked by name (a, e).
check('RPI then NPI then unranked', byRank === 'dbcae', byRank)
const last = sortByRank(rows, idx.get(2025)).map(r => r.id).join('')
check('other season uses its own ranks', last === 'bacde', last)

if (failed) { console.log(`\n${failed} failed`); process.exit(1) }
console.log('\nall passed')
