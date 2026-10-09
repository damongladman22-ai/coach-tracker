/**
 * Tests for src/lib/attendanceSignal.js (Find programs coach attendance
 * signal, backlog F5). Plain node, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/attendanceSignal.test.mjs)
 */
import {
  teamProgramGender, teamsFor, defaultTeamId, summarizeAttendance, longDate, attendanceReason, teamAge, lineage,
} from '../src/lib/attendanceSignal.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

check('girls -> W, boys -> M', teamProgramGender('Girls') === 'W' && teamProgramGender('Boys') === 'M')
check('unknown gender -> null', teamProgramGender('') === null && teamProgramGender(null) === null)

const teams = [{ id: 3, name: 'U17 Girls ECNL', gender: 'Girls' }, { id: 1, name: 'U15 Boys', gender: 'Boys' },
  { id: 2, name: 'U16 Girls ECNL', gender: 'Girls' }, { id: 4, name: 'Futsal', gender: null }]
check('women\'s search offers girls teams and unknowns, by name',
  teamsFor(teams, 'W').map(t => t.id).join() === '4,2,3', teamsFor(teams, 'W').map(t => t.id).join())
check('men\'s search offers boys teams and unknowns', teamsFor(teams, 'M').map(t => t.id).join() === '4,1')
check('no gender yet offers all', teamsFor(teams, '').length === 4)
check('default is the first starred team on offer', defaultTeamId(teamsFor(teams, 'W'), [1, 3, 2]) === 2)
check('starred team not on offer -> none', defaultTeamId(teamsFor(teams, 'W'), [1]) === null)
check('no favorites -> none', defaultTeamId(teams, null) === null)

const rows = [
  { coach_id: 'c1', game_id: 'g1', coaches: { school_id: 'osu' }, games: { game_date: '2026-07-11' } },
  { coach_id: 'c1', game_id: 'g2', coaches: { school_id: 'osu' }, games: { game_date: '2026-07-14' } },
  { coach_id: 'c2', game_id: 'g2', coaches: { school_id: 'osu' }, games: { game_date: '2026-07-14' } },
  { coach_id: 'c3', game_id: 'g3', coaches: { school_id: 'ken' }, games: { game_date: '2026-03-02' } },
  { coach_id: 'c4', game_id: 'g9', coaches: null, games: { game_date: '2026-03-02' } },
]
const m = summarizeAttendance(rows)
check('one entry per school, rows without a school skipped', m.size === 2)
const o = m.get('osu')
check('coaches and games counted once each', o.coaches === 2 && o.games === 2, JSON.stringify(o))
check('latest game date', o.latest === '2026-07-14')
check('empty input', summarizeAttendance(null).size === 0)

check('long date', longDate('2026-07-14') === 'July 14, 2026' && longDate('2026-03-02T00:00:00') === 'March 2, 2026')
check('bad date -> null', longDate('') === null && longDate(null) === null)
check('reason, plural', attendanceReason(o) === '2 coaches from this program attended 2 of your games, most recently July 14, 2026.',
  attendanceReason(o))
check('reason, singular', attendanceReason(m.get('ken')) === '1 coach from this program attended 1 of your games, most recently March 2, 2026.',
  attendanceReason(m.get('ken')))
check('reason without a date', attendanceReason({ coaches: 1, games: 2, latest: null }) === '1 coach from this program attended 2 of your games.')
check('no signal -> no line', attendanceReason(null) === null && attendanceReason({ coaches: 0 }) === null)

// Lineage across seasons
const seasons = [{ id: 's26', start_date: '2026-08-01' }, { id: 's24', start_date: '2024-08-01' }, { id: 's25', start_date: '2025-08-01' }]
const ag = n => ({ name: 'U' + n })
const all = [
  { id: 36, name: 'U17 Girls ECNL', gender: 'Girls', season_id: 's26', program_id: 1, age_groups: ag(17) },
  { id: 37, name: 'U17 Girls ECNL RL', gender: 'Girls', season_id: 's26', program_id: 2, age_groups: ag(17) },
  { id: 12, name: 'U16 Girls ECNL', gender: 'Girls', season_id: 's25', program_id: 1, age_groups: ag(16) },
  { id: 13, name: 'U16 Girls ECNL RL', gender: 'Girls', season_id: 's25', program_id: 2, age_groups: ag(16) },
  { id: 14, name: 'U16 Boys ECNL', gender: 'Boys', season_id: 's25', program_id: 1, age_groups: ag(16) },
  { id: 5, name: 'U15 Girls ECNL', gender: 'Girls', season_id: 's24', program_id: 1, age_groups: ag(15) },
  { id: 6, name: 'U15 Girls ECNL RL', gender: 'Girls', season_id: 's24', program_id: 2, age_groups: null },
]
check('age from age group, else the name', teamAge(all[0]) === 17 && teamAge(all[6]) === 15 && teamAge({ name: 'Reserves' }) === null)
const lin = lineage(all[0], all, seasons)
check('lineage walks back one age per season, same program and gender', lin.map(l => l.team.id).join() === '36,12,5',
  lin.map(l => l.team.id).join())
check('lineage carries the seasons', lin.map(l => l.season.id).join() === 's26,s25,s24')
check('RL lineage stays RL', lineage(all[1], all, seasons).map(l => l.team.id).join() === '37,13,6')
const dup = [...all, { id: 99, name: 'U16 Girls ECNL B', gender: 'Girls', season_id: 's25', program_id: 1, age_groups: ag(16) }]
check('two candidates in a season: stop rather than guess', lineage(all[0], dup, seasons).map(l => l.team.id).join() === '36')
check('no program: just the team', lineage({ ...all[0], program_id: null }, all, seasons).length === 1)
check('no team: empty', lineage(null, all, seasons).length === 0)
const offeredNow = teamsFor(all.filter(t => t.season_id === 's26'), 'W')
check('a star from last season picks its successor', defaultTeamId(offeredNow, [12], all, seasons) === 36)
check('a star from two seasons back too', defaultTeamId(offeredNow, [6], all, seasons) === 37)
check('a current star wins over an old one', defaultTeamId(offeredNow, [12, 37], all, seasons) === 37)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
