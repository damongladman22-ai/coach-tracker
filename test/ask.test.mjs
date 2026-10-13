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
  assert.equal(T.confMatcher('Big 10')('Big Ten Conference'), true)
  assert.equal(T.confMatcher('ACC')('Atlantic Coast Conference'), true)
  assert.equal(T.confMatcher('ACC')('Southeastern Conference'), false)
}

console.log('ask.test.mjs: all assertions passed')
