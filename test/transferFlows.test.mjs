/**
 * Tests for summariseTransfers() in src/csip-landscape/data/transferSummary.js —
 * plain node, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/transferFlows.test.mjs)
 *
 * The Landscape Transfers section reads program_transfer_flows. These guard
 * that into / out of are read from the right end of each flow, that the season
 * falls back to the pooled window outside the census, and that conference
 * corridors are limited to the selected division.
 */
import { summariseTransfers } from '../src/csip-landscape/data/transferSummary.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}
const d = (s, from, to, move, n) => ({ roster_season: s, level: 'division', from_group: from, to_group: to, from_division: from, to_division: to, move, n })
const c = (s, fc, tc, fd, td, n) => ({ roster_season: s, level: 'conference', from_group: fc, to_group: tc, from_division: fd, to_division: td, move: 'lateral', n })

const rows = [
  d(0, 'JC', 'NCAA D1', 'up', 40), d(0, 'NCAA D2', 'NCAA D1', 'up', 25), d(0, 'NCAA D1', 'NCAA D1', 'lateral', 60),
  d(0, 'NCAA D1', 'NCAA D2', 'down', 30), d(0, 'NCAA D1', 'NAIA', 'down', 5), d(0, 'NAIA', 'NCAA D2', 'lateral', 9),
  d(2026, 'JC', 'NCAA D1', 'up', 22), d(2026, 'NCAA D1', 'NCAA D1', 'lateral', 31),
  c(0, 'SEC', 'Big Ten', 'NCAA D1', 'NCAA D1', 7), c(0, 'NJCAA R1', 'SEC', 'JC', 'NCAA D1', 4),
  c(0, 'GLIAC', 'GLVC', 'NCAA D2', 'NCAA D2', 12), c(0, 'ACC', 'SEC', 'NCAA D1', 'NCAA D1', 9),
]
const seasons = [2025, 2026]

console.log('summariseTransfers')
{
  const s = summariseTransfers(rows, { division: 'NCAA D1', season: 0, seasons })
  check('pooled when season is 0', s.pooled && s.season === 0)
  check('into = flows ending at the division, by origin', JSON.stringify(s.into) === JSON.stringify([
    { group: 'NCAA D1', n: 60 }, { group: 'JC', n: 40 }, { group: 'NCAA D2', n: 25 }]), JSON.stringify(s.into))
  check('outOf = flows starting at the division, by destination', JSON.stringify(s.outOf) === JSON.stringify([
    { group: 'NCAA D1', n: 60 }, { group: 'NCAA D2', n: 30 }, { group: 'NAIA', n: 5 }]), JSON.stringify(s.outOf))
  check('moves into: up / lateral / down', s.moves.up === 65 && s.moves.lateral === 60 && s.moves.down === 0)
  check('corridors touch the division only, largest first',
    s.corridors.map(x => x.n).join(',') === '9,7,4', s.corridors.map(x => x.from_group + '>' + x.to_group).join(' '))
}
{
  const s = summariseTransfers(rows, { division: 'NCAA D1', season: 2026, seasons })
  check('a census season is used as is', !s.pooled && s.season === 2026)
  check('season rows only', s.into.reduce((a, i) => a + i.n, 0) === 53)
}
{
  const s = summariseTransfers(rows, { division: 'NCAA D1', season: 2023, seasons })
  check('a season outside the census falls back to pooled', s.pooled && s.season === 0)
}
{
  const s = summariseTransfers(rows, { division: 'NCAA D1', season: 0, seasons, topCorridors: 2 })
  check('corridor list is capped', s.corridors.length === 2)
  const e = summariseTransfers([], { division: 'NCAA D3', season: 0, seasons: [] })
  check('no rows -> empty lists', e.into.length === 0 && e.outOf.length === 0 && e.corridors.length === 0)
}

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
