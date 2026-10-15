// Event invites (src/lib/eventInvites.js), offline.
import assert from 'node:assert/strict'
import { eventKey, isShowcase, pickEvent, gameLine, inviteList } from '../src/lib/eventInvites.js'

assert.equal(eventKey('ECNL Florida Fall 2025'), eventKey('ECNL Florida Fall'))
assert.equal(eventKey('ECNL Girls Ohio Valley 2025-26'), eventKey('ECNL Girls Ohio Valley 2026-27'))
assert.notEqual(eventKey('ECNL Girls North Carolina - Fall'), eventKey('ECNL Florida Fall'))
assert.equal(eventKey('ECNL Florida Fall'), eventKey('ECNL Florida - Winter'), 'the club names editions differently')
assert.equal(eventKey('ECNL Girls North Carolina - Fall'), eventKey('ECNL North Carolina - Spring'))
assert.notEqual(eventKey('ECNL RL Florida'), eventKey('ECNL Florida'), 'RL is a different event')

const fl = { id: 1, event_name: 'ECNL Florida Fall', start_date: '2026-12-05', end_date: '2026-12-07', team_games: 3 }
const nc = { id: 2, event_name: 'ECNL Girls North Carolina - Fall', start_date: '2026-10-10', end_date: '2026-10-12', team_games: 3 }
const lg = { id: 3, event_name: 'ECNL Girls Ohio Valley 2026-27', start_date: '2026-08-01', end_date: '2027-07-31', team_games: 10 }
const none = { id: 4, event_name: 'ECNL Phoenix', start_date: '2027-03-01', end_date: '2027-03-03', team_games: 0 }
assert.equal(isShowcase(fl), true)
assert.equal(isShowcase(lg), false, 'a season-long league is not a showcase')
assert.equal(pickEvent([fl, lg], 'Florida').event.id, 1)
assert.equal(pickEvent([fl, lg], '').event.id, 1, 'the only upcoming showcase')
assert.equal(pickEvent([fl, nc, lg], '').choices.length, 2, 'two showcases: ask which')
assert.equal(pickEvent([fl, nc, lg], 'the Florida showcase').event.id, 1)
assert.deepEqual(pickEvent([], 'x'), { choices: [] })
assert.equal(pickEvent([lg, none], '').event.id, 3, 'no showcase with games: the league schedule, not a club event without games')
assert.equal(pickEvent([lg, none], 'Phoenix').event.id, 4, 'named: any upcoming event')

assert.equal(gameLine({ game_date: '2026-12-05', game_time: '09:00:00', timezone: 'America/New_York', opponent: 'Florida United' }),
  'Sat, Dec 5, 9:00 AM ET vs Florida United')
assert.equal(gameLine({ game_date: '2026-12-06', game_time: '14:30:00' }), 'Sun, Dec 6, 2:30 PM')
assert.equal(gameLine({}), 'time to be announced')

const schoolOf = new Map([
  ['a', { school: 'Alpha University', program_gender: 'W', division: 'NCAA D1' }],
  ['b', { school: 'Beta College', program_gender: 'W', division: 'NCAA D3' }],
  ['c', { school: 'Gamma State', program_gender: 'W', division: 'NCAA D2' }],
  ['m', { school: 'Alpha University', program_gender: 'M', division: 'NCAA D1' }],
])
const coach = (sid, f, l, extra = {}) => ({ school_id: sid, first_name: f, last_name: l, title: 'Assistant Coach', is_active: true, ...extra })
const past = [
  { coach_id: 1, game_id: 10, season: '2025-2026', coaches: coach('a', 'Ann', 'One') },
  { coach_id: 2, game_id: 11, season: '2025-2026', coaches: coach('b', 'Bo', 'Two', { is_active: false }) },
  { coach_id: 3, game_id: 12, season: '2025-2026', coaches: coach('m', 'Men', 'Coach') },
]
const team = [
  { coach_id: 1, game_id: 20, coaches: coach('a', 'Ann', 'One') },
  { coach_id: 4, game_id: 21, coaches: coach('c', 'Cy', 'Four') },
  { coach_id: 4, game_id: 22, coaches: coach('c', 'Cy', 'Four') },
]
const list = inviteList(past, team, schoolOf, 'W')
assert.deepEqual(list.map(x => x.school_id), ['a', 'c', 'b'], 'both first, then games watched, then event only')
assert.ok(!list.some(x => x.school_id === 'm'), "the men's program is left out")
assert.match(list[0].why, /watched your team \(1 game: Ann One\).*logged at this event before \(2025-2026: Ann One\)/)
assert.match(list[2].why, /Bo Two \(no longer on staff\)/)
assert.equal(list[1].watched_your_team.games, 2)

console.log('eventInvites.test.mjs: all assertions passed')
