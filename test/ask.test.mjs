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
  assert.deepEqual(T.readStatus('x\nSTATUS: partial - coaches for the remaining programs beyond the first five'), { status: 'answered', gap: null }, 'rest of a long list is not a gap')
  assert.deepEqual(T.readStatus('x\nSTATUS: partial - full list of 226 programs'), { status: 'answered', gap: null })
  assert.deepEqual(T.readStatus('x\nSTATUS: partial - incoming commits'), { status: 'partial', gap: 'incoming commits' }, 'a real gap stays')
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
  assert.ok(r.highlights.includes('Closest: Ohio State University (3 mi)'), 'closest worked out by the look-up')
  assert.ok(r.highlights.some(h => h.startsWith('Lowest average net price: Ohio State University ($20,000')))
  assert.ok(r.highlights.includes('Most selective: Denison University (17% admitted)'))
  assert.ok(r.highlights.includes('Highest average SAT: Kenyon College (1420)'))
  assert.ok(r.programs.every(p => p.distance_miles <= 60))
  r = await go({ gender: 'W', near: '43017', radius_miles: 500, divisions: ['NCAA D1'] })
  assert.deepEqual(r.programs.map(p => p.school_id), ['osu-w', 'van-w', 'wis-w'])
  r = await go({ gender: 'W', near: 'Columbus' })
  assert.deepEqual(r.places, ['Columbus, OH', 'Columbus, GA'], 'asks which Columbus')
  r = await go({ gender: 'W', near: 'Nowhere, OH' })
  assert.ok(/could not find/i.test(r.note))
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
  assert.ok(/total is 226/.test(v.showing))
  assert.equal(v.programs[0].card, undefined, 'card data is for the app only')
  assert.ok(!('coaches' in v.programs[0]), 'empty fields dropped')
  assert.equal(big.programs.length, 40, 'the full output is untouched for the cards')
}

// pilot fixes (2026-10-14): out of state, "where does X rank / why not on the list",
// exact names, distance on a profile, goalkeeper coach and goalkeeper history
{
  const LL = { 'osu-w': [40.0, -83.03], 'wis-w': [43.07, -89.4], 'den-w': [40.07, -82.52], 'ken-w': [40.37, -82.40], 'van-w': [36.14, -86.80] }
  const P = { ...tables,
    schools: [...schools, S('osm-w', 'Ohio State Marion', 'W', 'JC', null, 'Marion', 'Ohio')],
    school_federal_college: schools.map((s, i) => ({ school_id: s.id, unitid: 100 + i,
      college_facts: { ...facts[s.id], latitude: LL[s.id][0], longitude: LL[s.id][1] } })),
    geo_points: [{ kind: 'place', state: 'OH', key: 'columbus', name: 'Columbus, OH', lat: 39.98, lon: -82.98, land_sqmi: 220 }],
    coaches: [
      { school_id: 'wis-w', first_name: 'Ann', last_name: 'Lead', title: 'Head Coach', email: null, is_active: true },
      { school_id: 'wis-w', first_name: 'Gil', last_name: 'Keep', title: 'Assistant Coach / Goalkeepers', email: null, is_active: true },
      { school_id: 'van-w', first_name: 'Ed', last_name: 'Solo', title: 'Head Coach', email: null, is_active: true },
    ],
    program_position_retention: [{ school_id: 'wis-w', position: 'GK', first_season: 2022, last_season: 2026, season_pairs: 4,
      on_roster: 14, returned: 8, transferred_out: 1, left_after_final_year: 3, left_otherwise: 2,
      arrived_as_freshmen: 4, arrived_by_transfer: 1, arrived_other: 1 }],
    college_rosters: [
      { school_id: 'wis-w', roster_season: 2026, class_year: 'FR', position: 'GK', is_active: true },
      { school_id: 'wis-w', roster_season: 2026, class_year: 'SR', position: 'GK', is_active: true },
      { school_id: 'wis-w', roster_season: 2026, class_year: 'JR', position: 'GK', is_active: true },
    ],
  }
  const go = async (tool, input) => { T.resetCache(); return T.buildTools(fakeDb(P), [], {})[tool].execute(input, { toolCallId: 't', messages: [] }) }

  let r = await go('find_programs', { gender: 'W', near: 'Columbus, OH', radius_miles: 500, exclude_states: ['OH'] })
  assert.deepEqual(r.programs.map(p => p.school_id).sort(), ['van-w', 'wis-w'], 'out of state leaves Ohio out')

  r = await go('find_programs', { gender: 'W', near: 'Columbus, OH', radius_miles: 300, schools: ['Vanderbilt', 'Denison University', 'Kenyon'] })
  const by = Object.fromEntries(r.asked_about.map(x => [x.school, x]))
  assert.equal(by['Denison University'].rank_in_search, 2, 'rank in the same search')
  assert.equal(by['Denison University'].of, 3)
  assert.equal(by['Vanderbilt University'].in_results, false)
  assert.match(by['Vanderbilt University'].left_out_because, /miles away, beyond 300/, 'the filter that left it out')
  assert.ok(by['Vanderbilt University'].distance_miles > 300, 'distance from the look-up, not a guess')

  r = await go('find_programs', { gender: 'W', schools: ['Ohio State'] })
  assert.equal(r.asked_about.length, 2, 'a short name matching several programs reports each')
  assert.ok(r.asked_about.every(x => x.note === 'one of several programs matching this name'))
  r = await go('find_programs', { gender: 'W', schools: ['Wisconsin'] })
  assert.equal(r.asked_about[0].school_id, 'wis-w', '"Wisconsin" means the University of Wisconsin')
  r = await go('find_programs', { gender: 'W', schools: ['Ohio State University'] })
  assert.equal(r.asked_about[0].school_id, 'osu-w', 'an exact name wins over "Ohio State Marion"')
  r = await go('find_school', { name: 'Ohio State University' })
  assert.deepEqual(r.matches.map(m => m.school_id), ['osu-w'])

  r = await go('program_profile', { school_id: 'van-w', near: 'Columbus, OH' })
  assert.ok(r.distance.distance_miles > 300 && r.distance.distance_miles < 400, 'distance from home on a profile')

  r = await go('program_coaches', { school_id: 'wis-w' })
  assert.deepEqual(r.goalkeeper_coach, ['Gil Keep'])
  r = await go('program_coaches', { school_id: 'van-w' })
  assert.equal(r.goalkeeper_coach, 'none listed')

  r = await go('program_position_history', { school_id: 'wis-w' })
  assert.equal(r.position, 'GK', 'goalkeepers by default')
  assert.equal(r.history.returned, 8)
  assert.equal(r.history.transferred_to_another_college, 1)
  assert.deepEqual(r.current_roster, { roster_season: 2026, players: 3, by_class_year: { FR: 1, SR: 1, JR: 1 } })
  r = await go('program_position_history', { school_id: 'van-w' })
  assert.equal(r.history, null, 'no history: says so instead of inventing')

  const { historyContent } = await import('../src/ask/answerText.js')
  const h = historyContent('Five programs.\n\nSTATUS: answered\nFOLLOW-UPS: a | b | c',
    [{ tool: 'program_coaches', input: { school_id: 'x' } },
     { tool: 'find_programs', input: { gender: 'M', sat_min: 980, schools: ['X'], limit: 15 } }])
  assert.equal(h, 'Five programs.\n\n[Filters used for this answer: find_programs {"gender":"M","sat_min":980}]')
  assert.equal(historyContent('Hi.\nSTATUS: answered', []), 'Hi.')
}

// ── outreach email drafts (backlog F4) ──────────────────────────────────────
{
  const A = T.outreachAddresses
  const staff = [
    { name: 'Ann Lead', title: 'Head Coach', email: 'alead@wis.edu' },
    { name: 'Gil Keep', title: 'Assistant Coach / Goalkeepers', email: 'gkeep@wis.edu' },
    { name: 'Rae Cruit', title: 'Associate Head Coach / Recruiting Coordinator', email: 'rcruit@wis.edu' },
    { name: 'No Mail', title: 'Assistant Coach', email: null },
  ]
  let r = A(staff, 'GK')
  assert.deepEqual(r.to.map(c => c.email), ['alead@wis.edu', 'gkeep@wis.edu', 'rcruit@wis.edu'], 'every coach with an email, head coach first')
  assert.deepEqual(r.cc, [])
  assert.equal(r.greeting, 'Coach Lead, Coach Keep, and Coach Cruit')
  r = A(staff, 'F')
  assert.deepEqual(r.to.map(c => c.email), ['alead@wis.edu', 'rcruit@wis.edu', 'gkeep@wis.edu'], 'recruiter before other assistants for a forward')
  r = A([{ name: 'Gil Keep', title: 'Goalkeeper Coach', email: 'g@x.edu' }, { name: 'Ann Lead', title: 'Head Coach', email: null }], 'GK')
  assert.deepEqual(r.to.map(c => c.email), ['g@x.edu'], 'no head coach email: the coaches who have one')
  assert.equal(r.greeting, 'Coach Keep')
  r = A([{ name: 'Ann Lead', title: 'Head Coach', email: null }], 'GK')
  assert.deepEqual(r.to, [], 'no published email: nobody')
  assert.equal(r.greeting, 'Coach')
  r = A([{ name: 'Ann Smith', title: 'Head Coach', email: 'a@x.edu' }, { name: 'Bo Smith', title: 'Assistant Coach', email: 'b@x.edu' },
    { name: 'Ops Person', title: 'Director of Operations', email: 'o@x.edu' }], 'D')
  assert.equal(r.greeting, 'Coach Ann Smith and Coach Bo Smith', 'shared last names use full names')
  assert.ok(!r.to.some(c => c.email === 'o@x.edu'), 'non-coaching staff left out when coaches have addresses')

  const O = {
    ...tables,
    coaches: [
      { school_id: 'wis-w', first_name: 'Ann', last_name: 'Lead', title: 'Head Coach', email: 'alead@wis.edu', is_active: true },
      { school_id: 'wis-w', first_name: 'Gil', last_name: 'Keep', title: 'Goalkeeper Coach', email: 'gkeep@wis.edu', is_active: true },
      { school_id: 'wis-w', first_name: 'Old', last_name: 'Gone', title: 'Head Coach', email: 'old@wis.edu', is_active: false },
    ],
    college_rosters: [
      { school_id: 'wis-w', roster_season: 2026, class_year: 'SR', position: 'GK', is_active: true },
      { school_id: 'wis-w', roster_season: 2026, class_year: 'FR', position: 'GK', is_active: true },
      { school_id: 'wis-w', roster_season: 2025, class_year: 'JR', position: 'GK', is_active: true },
    ],
    program_results: [{ school_id: 'wis-w', season: 2025, wins: 12, losses: 5, ties: 2 }],
  }
  T.resetCache()
  const f = await T.buildTools(fakeDb(O), [], {}).outreach_facts.execute({ school_id: 'wis-w', position: 'GK' }, { toolCallId: 't', messages: [] })
  assert.deepEqual(f.to.map(c => c.email), ['alead@wis.edu', 'gkeep@wis.edu'], 'switched-off coaches are left out')
  assert.equal(f.greeting, 'Coach Lead and Coach Keep')
  assert.deepEqual(f.position_roster, { roster_season: 2026, position: 'GK', players: 2, by_class_year: { SR: 1, FR: 1 } }, 'latest roster season only')
  assert.equal(f.program.state, 'Wisconsin')
  assert.equal(f.recent_seasons[0].wins, 12)

  const { splitEmail, knownEmails, addressList, mailtoHref, emailText } = await import('../src/ask/answerText.js')
  const text = 'Here is a first email.\n\n---EMAIL---\nTo: alead@wis.edu, made.up@nowhere.com\nCc: gkeep@wis.edu\nSubject: 2028 Goalkeeper | Jane Smith | Ohio Premier ECNL\n\nCoach Lead,\n\nMy name is Jane.\n\nJane Smith\n---END EMAIL---\n\nRead it over before sending.'
  const e = splitEmail(text)
  assert.equal(e.before, 'Here is a first email.')
  assert.equal(e.after, 'Read it over before sending.')
  assert.equal(e.email.subject, '2028 Goalkeeper | Jane Smith | Ohio Premier ECNL')
  assert.equal(e.email.body, 'Coach Lead,\n\nMy name is Jane.\n\nJane Smith')
  assert.equal(e.email.complete, true)
  assert.equal(splitEmail('Intro\n---EMAIL---\nTo: a@b.edu\nSubject: S\n\nCoach').email.complete, false, 'still streaming')
  assert.equal(splitEmail('No draft here.').email, null)
  const known = knownEmails([{ tool: 'outreach_facts', output: f }])
  assert.deepEqual(addressList(e.email.to, known), ['alead@wis.edu'], 'a made-up address is dropped')
  assert.deepEqual(addressList('<GKeep@wis.edu>; gkeep@wis.edu', known), ['GKeep@wis.edu'], 'brackets trimmed, duplicates once')
  const href = mailtoHref({ to: ['alead@wis.edu'], cc: ['gkeep@wis.edu'], subject: 'A & B', body: 'Line 1\nLine 2' })
  assert.equal(href, 'mailto:alead@wis.edu?cc=gkeep@wis.edu&subject=A%20%26%20B&body=Line%201%0D%0ALine%202')
  assert.equal(emailText({ to: ['a@b.edu'], cc: [], subject: 'S', body: 'Hi' }), 'To: a@b.edu\nSubject: S\n\nHi')
}

console.log('ask.test.mjs: all assertions passed')
