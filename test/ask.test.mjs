// Ask PitchSide (backlog F2) — the look-ups and answer parsing, offline.
// A fake read-only database client stands in for Supabase; no network, no model.
import assert from 'node:assert/strict'

process.env.VITE_SUPABASE_URL = 'http://localhost'
process.env.VITE_SUPABASE_ANON_KEY = 'x'
const { _internals: T } = await import('../api/ask.js')

// ── a tiny in-memory stand-in for the supabase-js query builder ─────────────
function fakeDb(tables) {
  return {
    from(name) {
      let rows = (tables[name] || []).slice()
      const embed = r => r
      const q = {
        select() { return q },
        eq(col, v) { rows = rows.filter(r => getPath(r, col) === v); return q },
        neq(col, v) { rows = rows.filter(r => getPath(r, col) !== v); return q },
        in(col, vs) { rows = rows.filter(r => vs.includes(getPath(r, col))); return q },
        not() { return q },
        ilike() { return q },
        order() { return q },
        limit(n) { rows = rows.slice(0, n); return q },
        range(a, b) { return Promise.resolve({ data: rows.slice(a, b + 1).map(embed), error: null }) },
        maybeSingle() { return Promise.resolve({ data: rows[0] || null, error: null }) },
        single() { return Promise.resolve({ data: rows[0] || null, error: null }) },
        then(res, rej) { return Promise.resolve({ data: rows, error: null }).then(res, rej) },
      }
      return q
    },
  }
}
const getPath = (o, p) => p.split('.').reduce((x, k) => (x == null ? x : x[k]), o)

const S = (id, school, g, division, conference, city, state) => ({ id, school, program_gender: g, division, conference, city, state })
const schools = [
  S('osu-w', 'Ohio State University', 'W', 'NCAA D1', 'Big Ten', 'Columbus', 'Ohio'),
  S('wis-w', 'University of Wisconsin', 'W', 'NCAA D1', 'Big Ten', 'Madison', 'Wisconsin'),
  S('den-w', 'Denison University', 'W', 'NCAA D3', 'North Coast Athletic Conference', 'Granville', 'Ohio'),
  S('ken-w', 'Kenyon College', 'W', 'NCAA D3', 'North Coast Athletic Conference', 'Gambier', 'Ohio'),
  S('van-w', 'Vanderbilt University', 'W', 'NCAA D1', 'Southeastern Conference', 'Nashville', 'Tennessee'),
]
const facts = {
  'osu-w': { undergrad_enrollment: 46000, avg_net_price: 20000, admission_rate: 0.53, sat_average: 1350, graduation_rate: 0.88, locale: 11, control: 1 },
  'wis-w': { undergrad_enrollment: 37000, avg_net_price: 17000, admission_rate: 0.49, sat_average: 1400, graduation_rate: 0.89, locale: 12, control: 1 },
  'den-w': { undergrad_enrollment: 2300, avg_net_price: 31000, admission_rate: 0.17, sat_average: 1380, graduation_rate: 0.83, locale: 32, control: 2 },
  'ken-w': { undergrad_enrollment: 1700, avg_net_price: 33000, admission_rate: 0.36, sat_average: 1420, graduation_rate: 0.86, locale: 42, control: 2 },
  'van-w': { undergrad_enrollment: 7100, avg_net_price: 25000, admission_rate: 0.06, sat_average: 1530, graduation_rate: 0.93, locale: 11, control: 2 },
}
const tables = {
  schools,
  school_aliases: [{ id: 1, school_id: 'osu-w', alias_norm: 'buckeyes', kind: 'nickname' }],
  school_federal_college: schools.map((s, i) => ({ school_id: s.id, unitid: 100 + i, college_facts: facts[s.id] })),
  college_major_catalog: [
    { cip_code: '51.38', title: 'Registered Nursing', family_code: '51', family_title: 'Health Professions', colleges_bachelors: 900, colleges_associate: 500 },
    { cip_code: '14.19', title: 'Mechanical Engineering', family_code: '14', family_title: 'Engineering', colleges_bachelors: 300, colleges_associate: 10 },
  ],
  college_majors: [
    { unitid: 100, cip_code: '51.38', family_code: '51', title: 'Registered Nursing', family_title: 'Health Professions', credential_level: 3, graduates_2yr: 800 },
    { unitid: 101, cip_code: '14.19', family_code: '14', title: 'Mechanical Engineering', family_title: 'Engineering', credential_level: 3, graduates_2yr: 400 },
    { unitid: 102, cip_code: '51.38', family_code: '51', title: 'Registered Nursing', family_title: 'Health Professions', credential_level: 3, graduates_2yr: 40 },
  ],
}

async function run(tool, input) {
  T.resetCache()
  const log = []
  const tools = T.buildTools(fakeDb(tables), log, {})
  return tools[tool].execute(input, { toolCallId: 't', messages: [] })
}

// find_school: typos, nicknames, partial names
{
  let r = await run('find_school', { name: 'Ohio St' })
  assert.equal(r.matches[0].school_id, 'osu-w')
  r = await run('find_school', { name: 'Wisconson' })
  assert.equal(r.matches[0].school_id, 'wis-w', 'one-letter typo')
  r = await run('find_school', { name: 'the Buckeyes' })
  assert.ok(r.matches.some(m => m.school_id === 'osu-w'), 'nickname')
  r = await run('find_school', { name: 'Siena Heights' })
  assert.equal(r.matches.length, 0)
}

// find_programs: academic filters, major, conference short names, sorting
{
  let r = await run('find_programs', { gender: 'W', states: ['OH'], type: 'private' })
  assert.deepEqual(r.programs.map(p => p.school_id), ['den-w', 'ken-w'], 'private Ohio, most selective first')
  assert.equal(r.programs[0].card.label, 'admitted')
  r = await run('find_programs', { gender: 'W', sat_min: 1400, sort: 'sat' })
  assert.deepEqual(r.programs.map(p => p.school_id), ['van-w', 'ken-w', 'wis-w'])
  r = await run('find_programs', { gender: 'W', major: 'nursing' })
  assert.deepEqual(r.programs.map(p => p.school_id).sort(), ['den-w', 'osu-w'])
  assert.match(r.programs[0].major, /Registered Nursing/)
  r = await run('find_programs', { gender: 'W', conference: 'SEC' })
  assert.deepEqual(r.programs.map(p => p.school_id), ['van-w'], 'SEC -> Southeastern Conference')
  r = await run('find_programs', { gender: 'W', conference: 'NCAC', net_price_max: 32000 })
  assert.deepEqual(r.programs.map(p => p.school_id), ['den-w'])
  r = await run('find_programs', { gender: 'W', setting: 'rural' })
  assert.deepEqual(r.programs.map(p => p.school_id), ['ken-w'])
}

// program_majors
{
  const r = await run('program_majors', { school_id: 'wis-w', search: 'engineering' })
  assert.equal(r.matched, 1)
  assert.equal(r.majors[0].major, 'Mechanical Engineering')
}

// answer parsing: the STATUS and FOLLOW-UPS lines are hidden and read
{
  const text = 'Vanderbilt leads.\n\nBased on 2026.\nSTATUS: unavailable - ID camps\nFOLLOW-UPS: A one | B two | C three'
  assert.equal(T.visibleAnswer(text), 'Vanderbilt leads.\n\nBased on 2026.')
  assert.deepEqual(T.readStatus(text), { status: 'unavailable', gap: 'ID camps' })
  assert.deepEqual(T.readStatus('Done.\nSTATUS: answered\nFOLLOW-UPS: x | y | z'), { status: 'answered', gap: null })
  const late = 'Pitt leads.\n\nSTATUS: answered\n\nBased on 2026 rosters.\n\nFOLLOW-UPS: a b c | d e f | g h i'
  assert.equal(T.visibleAnswer(late), 'Pitt leads.\n\n\nBased on 2026 rosters.', 'text after STATUS is kept')
  const { splitAnswer } = await import('../src/ask/answerText.js')
  assert.deepEqual(splitAnswer(late), { body: 'Pitt leads.\n\n\nBased on 2026 rosters.', followups: ['a b c', 'd e f', 'g h i'] })
  assert.equal(splitAnswer('Pitt leads.\nSTAT').body, 'Pitt leads.', 'half-written STATUS hidden while streaming')
  assert.equal(splitAnswer(text).body, 'Vanderbilt leads.\n\nBased on 2026.')
  assert.equal(T.confMatcher('Big 10')('Big Ten Conference'), true)
  assert.equal(T.confMatcher('ACC')('Atlantic Coast Conference'), true)
  assert.equal(T.confMatcher('ACC')('Southeastern Conference'), false)
}


// programs_watching_team: club names and filler are ignored; ambiguous names ask
{
  const W = { ...tables,
    seasons: [{ id: 's25', name: '2025-26', start_date: '2025-08-01', is_active: false },
      { id: 's26', name: '2026-27', start_date: '2026-08-01', is_active: true }],
    teams: [
      { id: 1, name: 'U16 Girls ECNL', gender: 'Girls', season_id: 's26', program_id: 9, age_groups: { name: 'U16' } },
      { id: 2, name: 'U16 Girls ECNL RL', gender: 'Girls', season_id: 's26', program_id: 9, age_groups: { name: 'U16' } },
      { id: 3, name: 'U17 Girls ECNL', gender: 'Girls', season_id: 's26', program_id: 9, age_groups: { name: 'U17' } },
      { id: 4, name: 'U16 Girls ECNL', gender: 'Girls', season_id: 's25', program_id: 9, age_groups: { name: 'U16' } },
    ],
    attendance: [
      { id: 1, coach_id: 11, game_id: 100, coaches: { school_id: 'den-w', first_name: 'Ann', last_name: 'Lee', title: 'Head Coach', is_active: true }, games: { team_id: 1, game_date: '2026-09-01' } },
      { id: 2, coach_id: 11, game_id: 101, coaches: { school_id: 'den-w', first_name: 'Ann', last_name: 'Lee', title: 'Head Coach', is_active: true }, games: { team_id: 1, game_date: '2026-09-08' } },
      { id: 6, coach_id: 15, game_id: 100, coaches: { school_id: 'den-w', first_name: 'Bo', last_name: 'Diaz', title: 'Associate Head Coach', is_active: true }, games: { team_id: 1, game_date: '2026-09-01' } },
      { id: 5, coach_id: 12, game_id: 101, coaches: { school_id: 'den-w', first_name: 'Bo', last_name: 'Diaz', title: 'Assistant Coach', is_active: false }, games: { team_id: 1, game_date: '2026-09-08' } },
      { id: 3, coach_id: 13, game_id: 101, coaches: { school_id: 'ken-w' }, games: { team_id: 1, game_date: '2026-09-08' } },
      { id: 4, coach_id: 14, game_id: 90, coaches: { school_id: 'osu-w' }, games: { team_id: 4, game_date: '2026-07-12' } },
    ],
  }
  const go = async (input, ctx = {}) => { T.resetCache(); return T.buildTools(fakeDb(W), [], ctx).programs_watching_team.execute(input, { toolCallId: 't', messages: [] }) }
  let r = await go({ team: 'Ohio Premier U16 girls ECNL team' })
  assert.equal(r.team, 'U16 Girls ECNL', 'club name ignored, exact over RL')
  assert.equal(r.programs[0].school_id, 'den-w')
  assert.equal(r.programs[0].games, 2)
  assert.deepEqual(r.programs[0].coaches_seen, [
    { name: 'Ann Lee', title: 'Head Coach', games: 2, latest: '2026-09-08', still_on_staff: undefined },
    { name: 'Bo Diaz', title: 'Associate Head Coach', games: 2, latest: '2026-09-08', still_on_staff: undefined },
  ], 'names who came, with games; two records for one person merge, current one wins')
  assert.equal(r.current_season, '2026-27')
  let one = await go({ team: 'U16 Girls ECNL', school: 'Kenyon' })
  assert.deepEqual(one.programs.map(p => p.school_id), ['ken-w'], 'one college only')
  one = await go({ team: 'U16 Girls ECNL', school: 'Vanderbilt' })
  assert.ok(/No coaches from/.test(one.note))
  r = await go({ team: 'u-16 girl' })
  assert.equal(r.programs.length, 0)
  assert.deepEqual(r.matching_teams, ['U16 Girls ECNL (2011s)', 'U16 Girls ECNL RL (2011s)'], 'ambiguous asks')
  r = await go({ team: 'Ohio Premier girls' })
  assert.equal(r.matching_teams.length, 3)
  assert.equal(r.teams_with_coach_visits[0], 'U16 Girls ECNL (2011s): 2 games with college coaches logged (2 games in 2026-27 as U16 Girls ECNL)', 'offers teams with visits, birth year and seasons')
  r = await go({})
  assert.ok(/No starred team/.test(r.note))
  r = await go({}, { favoriteTeamIds: [3] })
  assert.equal(r.team, 'U17 Girls ECNL')
  assert.equal(r.birth_year, 2010)
  assert.deepEqual(r.seasons, [
    { season: '2026-27', team: 'U17 Girls ECNL', games_with_coaches: 0 },
    { season: '2025-26', team: 'U16 Girls ECNL', games_with_coaches: 1 },
  ], 'same players, last season as U16')
  assert.equal(r.programs[0].school_id, 'osu-w')
  assert.equal(r.showing, undefined)
  r = await go({ team: 'the 2010s girls ECNL' })
  assert.equal(r.team, 'U17 Girls ECNL', 'birth year picks this season\'s team')
  r = await go({ team: "our '11s" })
  assert.deepEqual(r.matching_teams, ['U16 Girls ECNL (2011s)', 'U16 Girls ECNL RL (2011s)'])
}


// distance search: town or ZIP, radius, city fallback for colleges without Scorecard points
{
  const { parseNear, placeKey } = await import('../src/lib/geo.js')
  assert.deepEqual(parseNear('Dublin, Ohio'), { city: 'dublin', state: 'OH' })
  assert.deepEqual(parseNear('zip 43017-1234'), { zip: '43017' })
  assert.deepEqual(parseNear('Columbus'), { city: 'columbus', state: null })
  assert.equal(placeKey('St. Marys'), 'saint marys')
  const LL = { 'osu-w': [40.0, -83.03], 'wis-w': [43.07, -89.4], 'den-w': [40.07, -82.52], 'ken-w': [40.37, -82.40], 'van-w': [36.14, -86.80] }
  const D = { ...tables,
    schools: [...schools, S('ott-w', 'Otterbein University', 'W', 'NCAA D3', 'Ohio Athletic Conference', 'Westerville', 'Ohio')],
    school_federal_college: schools.map((s, i) => ({ school_id: s.id, unitid: 100 + i,
      college_facts: { ...facts[s.id], latitude: LL[s.id][0], longitude: LL[s.id][1] } })),
    geo_points: [
      { kind: 'place', state: 'OH', key: 'columbus', name: 'Columbus, OH', lat: 39.98, lon: -82.98, land_sqmi: 220 },
      { kind: 'place', state: 'GA', key: 'columbus', name: 'Columbus, GA', lat: 32.51, lon: -84.87, land_sqmi: 216 },
      { kind: 'place', state: 'OH', key: 'westerville', name: 'Westerville, OH', lat: 40.12, lon: -82.92, land_sqmi: 12 },
      { kind: 'zip', state: 'OH', key: '43017', name: 'ZIP 43017 (Dublin, OH)', lat: 40.12, lon: -83.13, land_sqmi: 30 },
    ],
  }
  const go = async input => { T.resetCache(); return T.buildTools(fakeDb(D), [], {}).find_programs.execute(input, { toolCallId: 't', messages: [] }) }
  let r = await go({ gender: 'W', near: 'Columbus, OH', radius_miles: 60 })
  assert.deepEqual(r.programs.map(p => p.school_id), ['osu-w', 'ott-w', 'den-w', 'ken-w'], 'nearest first, Otterbein placed by its city')
  assert.equal(r.ranked_by, 'distance')
  assert.equal(r.near, 'Columbus, OH')
  assert.equal(r.programs[0].card.label, 'away')
  assert.ok(r.programs.every(p => p.distance_miles <= 60))
  r = await go({ gender: 'W', near: '43017', radius_miles: 500, divisions: ['NCAA D1'] })
  assert.deepEqual(r.programs.map(p => p.school_id), ['osu-w', 'van-w', 'wis-w'])
  r = await go({ gender: 'W', near: 'Columbus' })
  assert.deepEqual(r.places, ['Columbus, OH', 'Columbus, GA'], 'asks which Columbus')
  r = await go({ gender: 'W', near: 'Nowhere, OH' })
  assert.ok(/could not find/.test(r.note))
}


// speed: program look-ups take a college name; the model reads a trimmed copy
{
  let r = await run('program_majors', { school: 'Wisconson', search: 'engineering' })
  assert.equal(r.program.school_id, 'wis-w', 'name instead of school_id, typo and all')
  assert.equal(r.matched, 1)
  r = await run('program_coaches', { school: 'Siena Heights' })
  assert.equal(r.matches.length, 0)
  r = await run('program_results', { school: 'University', gender: 'W' })
  assert.ok(r.matches.length > 1 && /Several programs/.test(r.note), 'several matches: asks for a school_id')
  r = await run('program_results', {})
  assert.ok(r.error)
  const big = { matched: 226, programs: Array.from({ length: 40 }, (_, i) => ({ school_id: 's' + i, school: 'S' + i, coaches: null, games: 40 - i, card: { value: 1, label: 'x' } })) }
  const v = T.modelView({ output: big }).value
  assert.equal(v.programs.length, 15)
  assert.equal(v.matched, 226)
  assert.ok(/first 15 of 226/.test(v.showing))
  assert.equal(v.programs[0].card, undefined, 'card data is for the app only')
  assert.ok(!('coaches' in v.programs[0]), 'empty fields dropped')
  assert.equal(big.programs.length, 40, 'the full output is untouched for the cards')
}

console.log('ask.test.mjs: all assertions passed')
