/* global process */
import { createClient } from '@supabase/supabase-js'
import { generateText, streamText, tool, stepCountIs, gateway } from 'ai'
import { z } from 'zod'
import { POSITIONS, DIVISIONS, rankPrograms, reasons, stateAbbr } from '../src/lib/findPrograms.js'
import { expandTerms, scoreSchool, setAliasIndex } from '../src/lib/schoolMatch.js'
import { buildCatalog, searchMajors, offeringsBySchool, offeringFor, majorReason, choiceLabel } from '../src/lib/majorFilter.js'
import { lineage, defaultTeamId, summarizeAttendance } from '../src/lib/attendanceSignal.js'

/**
 * POST /api/ask  { question, model }      -> answer + every look-up it used
 * GET  /api/ask?models=1                  -> models the AI Gateway offers, with prices
 *
 * Backlog F2, prototype (2026-10-13). OWNER ONLY: the caller's Supabase JWT
 * must belong to a super_admin in allowed_admins.
 *
 * How it answers (approach A in claude/F2_AI_Assistant_Options_20261013.md):
 * the model never sees the database. It may only call the fixed, read-only
 * look-ups below; our code runs each one with the PUBLIC (anon) key, so it can
 * read nothing a visitor to the site could not, and can write nothing. The
 * model then explains the rows it got back. Every look-up and its rows are
 * returned to the page, so each number in an answer can be checked.
 *
 * The model is reached through Vercel AI Gateway (Damon, 2026-10-13), so the
 * vendor is a string ("openai/...", "anthropic/...", "google/...") and the
 * bake-off can compare them on the same questions. Authentication is the
 * project's Vercel OIDC token when deployed, or AI_GATEWAY_API_KEY if set.
 */

export const config = { maxDuration: 60 }

// Default and fallback chosen from the bake-off (Damon, 2026-10-13): Claude Haiku
// 5.5 (20/20, cheapest reliable, fastest); if it fails or its provider is down,
// the gateway retries the same request on GPT-5.6 Luna (also 20/20).
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5'
const FALLBACK_MODEL = 'openai/gpt-5.6-luna'
const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.\-:]+$/i
const MAX_ROWS = 40
const PAGE = 1000

// ── auth: owner only ────────────────────────────────────────────────────────
async function checkOwner(req) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return { ok: false, status: 500, reason: 'env-missing' }
  const auth = req.headers.authorization || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : null
  if (!token) return { ok: false, status: 401, reason: 'no-token' }
  const admin = createClient(url, key)
  const { data, error } = await admin.auth.getUser(token)
  if (error || !data?.user?.email) return { ok: false, status: 401, reason: 'jwt-invalid' }
  const email = data.user.email.toLowerCase()
  const { data: row } = await admin.from('allowed_admins').select('role').eq('email', email).maybeSingle()
  if (row?.role !== 'super_admin') return { ok: false, status: 403, reason: 'not-owner' }
  return { ok: true, email }
}

// Look-ups read with the public key: the same rows any site visitor can read.
function readClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY,
    { auth: { persistSession: false } })
}

async function allRows(build) {
  let from = 0, out = []
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out = out.concat(data || [])
    if (!data || data.length < PAGE) return out
    from += PAGE
  }
}

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const round = (x, d = 1) => (x == null || isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d)

// ── reference data, cached per server instance (15 minutes) ─────────────────
// Every active program, the alias table (nicknames, short names), and each
// program's College Scorecard facts. Loaded once and reused, so fuzzy name
// matching and academic filters cost no extra queries per question.
let REF = null
async function refData(db) {
  if (REF && Date.now() - REF.at < 15 * 60 * 1000) return REF
  const [schools, aliases, links] = await Promise.all([
    allRows(() => db.from('schools').select('id,school,program_gender,division,conference,city,state').neq('is_active', false).order('id')),
    allRows(() => db.from('school_aliases').select('id,school_id,alias_norm,kind').order('id')),
    allRows(() => db.from('school_federal_college')
      .select('school_id,unitid,college_facts(undergrad_enrollment,avg_net_price,admission_rate,sat_average,graduation_rate,locale,control)')
      .order('school_id')),
  ])
  const index = new Map(), common = new Map(), names = new Map()
  const add = (m, k, id) => { let x = m.get(k); if (!x) m.set(k, (x = new Set())); x.add(id) }
  const byId = new Map(schools.map(s => [s.id, s]))
  for (const s of schools) names.set(s.id, s.school)
  for (const r of aliases) {
    if (!r.alias_norm || !r.school_id) continue
    add(index, r.alias_norm, r.school_id)
    if (r.kind === 'common_name') add(common, r.alias_norm, r.school_id)
  }
  setAliasIndex(index, { common, names })
  const facts = new Map(), unitOf = new Map()
  for (const l of links) {
    unitOf.set(l.school_id, l.unitid)
    if (l.college_facts) facts.set(l.school_id, l.college_facts)
  }
  REF = { at: Date.now(), schools, byId, facts, unitOf, links: links.map(l => ({ school_id: l.school_id, unitid: l.unitid })) }
  return REF
}

let CATALOG = null
async function majorCatalog(db) {
  if (CATALOG) return CATALOG
  const { data, error } = await db.from('college_major_catalog')
    .select('cip_code,title,family_code,family_title,colleges_bachelors,colleges_associate').limit(PAGE)
  if (error) throw new Error(error.message)
  CATALOG = buildCatalog(data || [])
  return CATALOG
}

const LOCALE = {
  11: 'Large city', 12: 'Midsize city', 13: 'Small city', 21: 'Large suburb', 22: 'Midsize suburb', 23: 'Small suburb',
  31: 'Town near a city', 32: 'Town', 33: 'Remote town', 41: 'Rural, near a city', 42: 'Rural', 43: 'Remote rural',
}
const settingWord = l => ({ 1: 'city', 2: 'suburb', 3: 'town', 4: 'rural' }[Math.floor(Number(l) / 10)] || null)
const controlWord = c => (Number(c) === 1 ? 'public' : Number(c) === 2 || Number(c) === 3 ? 'private' : null)
const controlLabel = c => ({ 1: 'Public', 2: 'Private nonprofit', 3: 'Private for-profit' }[Number(c)] || null)

// Conference short names people use -> words in the stored conference name.
const CONF_ALIASES = {
  sec: 'southeastern', acc: 'atlantic coast', b1g: 'big ten', 'big 10': 'big ten', 'big 12': 'big 12', aac: 'american athletic',
  'a 10': 'atlantic 10', a10: 'atlantic 10', caa: 'coastal athletic', mac: 'mid american', wcc: 'west coast', mvc: 'missouri valley',
  asun: 'atlantic sun', maac: 'metro atlantic', socon: 'southern', ovc: 'ohio valley', nescac: 'new england small college',
  uaa: 'university athletic association', psac: 'pennsylvania state athletic', ne10: 'northeast 10', 'ne 10': 'northeast 10',
  sac: 'south atlantic', gac: 'great american', rmac: 'rocky mountain', ccaa: 'california collegiate', glvc: 'great lakes valley',
  gliac: 'great lakes intercollegiate', miac: 'minnesota intercollegiate', oac: 'ohio athletic', ncac: 'north coast',
  cciw: 'college conference of illinois', liberty: 'liberty league', mascac: 'massachusetts state', nac: 'north atlantic',
  'pac 12': 'pac 12', 'pac-12': 'pac 12', mwc: 'mountain west', cusa: 'conference usa', 'c usa': 'conference usa',
}
function confMatcher(q) {
  const raw = norm(q)
  const words = CONF_ALIASES[raw] || CONF_ALIASES[raw.replace(/ /g, '')] || null
  return conf => {
    const c = norm(conf)
    if (!c) return false
    if (c.includes(raw)) return true
    if (words && c.includes(words)) return true
    return c.split(' ').map(w => w[0]).join('') === raw.replace(/ /g, '')
  }
}

// The number a program card shows, chosen from what the list was sorted by.
function cardMetric(sort, row, openings) {
  const pct = x => (x == null ? null : Math.round(x * 100) + '%')
  if (openings) return { value: row.est_freshman_openings ?? row.est_total_openings, label: 'for freshmen' }
  if (sort === 'sat') return { value: row.sat_average, label: 'avg SAT' }
  if (sort === 'net_price') return { value: row.avg_net_price == null ? null : '$' + Math.round(row.avg_net_price / 1000) + 'k', label: 'avg net price' }
  if (sort === 'graduation_rate') return { value: pct(row.graduation_rate), label: 'graduate' }
  if (sort === 'size') return { value: row.undergrads == null ? null : row.undergrads.toLocaleString('en-US'), label: 'undergrads' }
  return { value: pct(row.admission_rate), label: 'admitted' }
}

// ── the look-ups ────────────────────────────────────────────────────────────
function buildTools(db, log, ctx = {}) {
  const run = (name, fn) => async (input) => {
    const t0 = Date.now()
    try {
      const out = await fn(input)
      log.push({ tool: name, input, output: out, ms: Date.now() - t0 })
      return out
    } catch (e) {
      const out = { error: String(e.message || e) }
      log.push({ tool: name, input, output: out, ms: Date.now() - t0 })
      return out
    }
  }

  return {
    find_school: tool({
      description: 'Find college soccer programs by name, nickname, short name or abbreviation, tolerating typos ' +
        '(e.g. "Ohio State", "Pitt", "UConn", "Wisconson", "the Tar Heels"). Returns program ids for the other look-ups. ' +
        'Each college has a separate men\'s and women\'s program. Programs that have closed or stopped fielding soccer are not listed.',
      inputSchema: z.object({
        name: z.string().describe('College name, short name, nickname or abbreviation, as the person wrote it'),
        gender: z.enum(['M', 'W']).optional().describe('M = men\'s program, W = women\'s program'),
      }),
      execute: run('find_school', async ({ name, gender }) => {
        const ref = await refData(db)
        // Words people add that are not part of any name: "the Buckeyes",
        // "Penn State women's soccer team".
        const cleaned = String(name || '').replace(/\b(the|team|teams|soccer|program|programs|women'?s|men'?s|womens|mens|girls|boys)\b/gi, ' ')
          .replace(/\s+/g, ' ').trim() || String(name || '')
        const terms = expandTerms(cleaned)
        if (!terms.length) return { matches: [], note: 'No name given.' }
        const scored = []
        for (const s of ref.schools) {
          if (gender && s.program_gender !== gender) continue
          const score = scoreSchool(s, terms, { query: cleaned, fields: ['name', 'city', 'state'] })
          if (score > 0) scored.push({ s, score })
        }
        scored.sort((a, b) => b.score - a.score || String(a.s.school).localeCompare(String(b.s.school)))
        const top = scored.length ? scored[0].score : 0
        const keep = scored.filter(x => x.score >= top * 0.6).slice(0, 10)
        if (!keep.length) return { matches: [], note: 'No program matched that name, even allowing for typos. It may have closed, or PitchSide may not track it.' }
        return {
          matches: keep.map(({ s }) => ({ school_id: s.id, school: s.school, gender: s.program_gender,
            division: s.division, conference: s.conference, city: s.city, state: s.state })),
          note: keep.length > 1 ? 'Several programs match; pick the one the person means, or ask if it is unclear.' : undefined,
        }
      }),
    }),

    find_programs: tool({
      description: 'Search and rank college soccer programs. Use it for "which programs…" questions. Every filter is optional except gender. ' +
        'With position + hs_class it estimates roster OPENINGS for that recruit (the Find programs page); results are ranked by estimated freshman openings. ' +
        'Academic and campus filters come from the U.S. College Scorecard: admission rate, average SAT, graduation rate, average net price per year, ' +
        'undergraduate size, public or private, setting. "major" keeps colleges that awarded that major or field in the last two years. ' +
        'GPA is NOT available; use admission rate and average SAT as the measure of academic selectivity.',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']),
        position: z.enum(['GK', 'D', 'M', 'F']).optional().describe('GK goalkeeper, D defender, M midfielder, F forward'),
        hs_class: z.number().int().optional().describe('High-school graduating class, e.g. 2027 (enters college that fall)'),
        divisions: z.array(z.enum(DIVISIONS)).optional(),
        states: z.array(z.string()).optional().describe('Two-letter state codes, e.g. ["OH","PA"]'),
        conference: z.string().optional().describe('Conference name or short name, e.g. "Big Ten", "SEC", "NESCAC"'),
        major: z.string().optional().describe('A major or field, e.g. "nursing", "engineering", "kinesiology"'),
        sat_min: z.number().int().optional().describe('Minimum average SAT of admitted students (400-1600)'),
        sat_max: z.number().int().optional(),
        admission_rate_max: z.number().optional().describe('0-1, e.g. 0.3 for colleges admitting 30% or fewer'),
        admission_rate_min: z.number().optional().describe('0-1, e.g. 0.5 for less selective colleges'),
        graduation_rate_min: z.number().optional().describe('0-1'),
        net_price_max: z.number().int().optional().describe('Average net price per year in US dollars'),
        undergrads_min: z.number().int().optional(),
        undergrads_max: z.number().int().optional(),
        type: z.enum(['public', 'private']).optional(),
        setting: z.enum(['city', 'suburb', 'town', 'rural']).optional(),
        sort: z.enum(['openings', 'selectivity', 'sat', 'net_price', 'graduation_rate', 'size', 'name']).optional()
          .describe('Default: openings when position and hs_class are given, otherwise selectivity'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional(),
      }),
      execute: run('find_programs', async (a) => {
        const ref = await refData(db)
        const openings = !!(a.position && a.hs_class)
        let latest = null
        let base
        if (openings) {
          const { data: lat } = await db.from('program_openings_outlook').select('current_season')
            .order('current_season', { ascending: false }).limit(1)
          latest = lat?.[0]?.current_season ?? null
          const rows = await allRows(() => db.from('program_openings_outlook')
            .select('school_id,entry_season,position,current_season,graduating,continuing,early_rate,transitions,' +
              'fresh_share,est_spots,est_freshman,schools!inner(school,program_gender,division,conference,city,state)')
            .eq('entry_season', a.hs_class).eq('position', a.position).eq('schools.program_gender', a.gender)
            .order('school_id', { ascending: true }))
          if (!rows.length) return { programs: [], note: `No openings estimates for the class of ${a.hs_class}. Latest roster season is ${latest}; classes ${latest + 1} to ${latest + 4} are covered.` }
          base = rankPrograms(rows, { minSeason: latest != null ? latest - 1 : null })
        } else {
          base = ref.schools.filter(s => s.program_gender === a.gender)
            .map(s => ({ school_id: s.id, schools: { school: s.school, division: s.division, conference: s.conference, city: s.city, state: s.state } }))
        }

        let majorChoice = null, offerings = null
        if (a.major) {
          const cat = await majorCatalog(db)
          majorChoice = searchMajors(cat, a.major, 1)[0] || null
          if (!majorChoice) return { programs: [], note: `PitchSide's majors list has nothing matching "${a.major}". Try a broader field name.` }
          const rows = await allRows(() => db.from('college_majors')
            .select('unitid,cip_code,title,credential_level,graduates_2yr')
            .eq(majorChoice.kind === 'area' ? 'family_code' : 'cip_code', majorChoice.code)
            .in('credential_level', [2, 3]).order('unitid').order('cip_code').order('credential_level'))
          offerings = offeringsBySchool(ref.links, rows)
        }

        const conf = a.conference ? confMatcher(a.conference) : null
        const divs = a.divisions?.length ? new Set(a.divisions) : null
        const sts = a.states?.length ? new Set(a.states.map(s => s.toUpperCase())) : null
        const out = []
        for (const r of base) {
          const s = r.schools || {}
          if (divs && !divs.has(s.division)) continue
          if (sts && !sts.has(stateAbbr(s.state))) continue
          if (conf && !conf(s.conference)) continue
          const f = ref.facts.get(r.school_id) || null
          const need = [a.sat_min, a.sat_max, a.admission_rate_max, a.admission_rate_min, a.graduation_rate_min,
            a.net_price_max, a.undergrads_min, a.undergrads_max, a.type, a.setting].some(v => v != null)
          if (need && !f) continue
          if (a.sat_min != null && !(f.sat_average >= a.sat_min)) continue
          if (a.sat_max != null && !(f.sat_average != null && f.sat_average <= a.sat_max)) continue
          if (a.admission_rate_max != null && !(f.admission_rate != null && f.admission_rate <= a.admission_rate_max)) continue
          if (a.admission_rate_min != null && !(f.admission_rate == null || f.admission_rate >= a.admission_rate_min)) continue
          if (a.graduation_rate_min != null && !(f.graduation_rate >= a.graduation_rate_min)) continue
          if (a.net_price_max != null && !(f.avg_net_price != null && f.avg_net_price <= a.net_price_max)) continue
          if (a.undergrads_min != null && !(f.undergrad_enrollment >= a.undergrads_min)) continue
          if (a.undergrads_max != null && !(f.undergrad_enrollment != null && f.undergrad_enrollment <= a.undergrads_max)) continue
          if (a.type && controlWord(f.control) !== a.type) continue
          if (a.setting && settingWord(f.locale) !== a.setting) continue
          let majorNote = null
          if (offerings) {
            const o = offeringFor(offerings, r.school_id, s.division)
            if (!o) continue
            majorNote = majorReason(o, majorChoice)
          }
          out.push({ r, s, f, majorNote })
        }

        const sort = a.sort || (openings ? 'openings' : 'selectivity')
        const num = (x, dflt) => (x == null ? dflt : Number(x))
        const cmp = {
          openings: () => 0,
          selectivity: (x, y) => num(x.f?.admission_rate, 2) - num(y.f?.admission_rate, 2),
          sat: (x, y) => num(y.f?.sat_average, -1) - num(x.f?.sat_average, -1),
          net_price: (x, y) => num(x.f?.avg_net_price, 1e9) - num(y.f?.avg_net_price, 1e9),
          graduation_rate: (x, y) => num(y.f?.graduation_rate, -1) - num(x.f?.graduation_rate, -1),
          size: (x, y) => num(y.f?.undergrad_enrollment, -1) - num(x.f?.undergrad_enrollment, -1),
          name: (x, y) => String(x.s.school).localeCompare(String(y.s.school)),
        }[sort]
        if (sort !== 'openings') out.sort(cmp)

        const n = Math.min(a.limit || 12, MAX_ROWS)
        return {
          matched: out.length,
          ranked_by: sort === 'openings'
            ? 'estimated openings for incoming freshmen (est_freshman_openings), then total; the same order as the Find programs page'
            : sort,
          major: majorChoice ? choiceLabel(majorChoice) : undefined,
          latest_roster_season: latest ?? undefined,
          academics_note: 'Admission rate, average SAT, graduation rate and net price are from the U.S. College Scorecard (2026 release). GPA is not available.',
          programs: out.slice(0, n).map(({ r, s, f, majorNote }) => {
            const row = {
              school_id: r.school_id, school: s.school, division: s.division, conference: s.conference, state: stateAbbr(s.state),
              admission_rate: f?.admission_rate ?? null, sat_average: f?.sat_average ?? null,
              graduation_rate: f?.graduation_rate ?? null, avg_net_price: f?.avg_net_price ?? null,
              undergrads: f?.undergrad_enrollment ?? null, type: f ? controlLabel(f.control) : null, setting: f ? LOCALE[f.locale] || null : null,
            }
            if (majorNote) row.major = majorNote
            if (openings) {
              Object.assign(row, {
                est_freshman_openings: round(r.est_freshman), est_total_openings: round(r.est_spots),
                graduating_before_entry: r.graduating, roster_season: r.current_season,
                reasons: reasons(r, a.position, a.hs_class),
              })
            }
            row.card = cardMetric(sort, row, openings)
            return row
          }),
        }
      }),
    }),

    program_majors: tool({
      description: 'Majors one college awarded in the last two years (U.S. College Scorecard), optionally searched, e.g. "does Denison offer nursing", "what engineering majors does Purdue have".',
      inputSchema: z.object({
        school_id: z.string(),
        search: z.string().optional().describe('Words to look for in the major titles, e.g. "nursing", "business"'),
      }),
      execute: run('program_majors', async ({ school_id, search }) => {
        const ref = await refData(db)
        const unitid = ref.unitOf.get(school_id)
        if (!unitid) return { majors: [], note: 'PitchSide has no federal college record linked to this program.' }
        const { data, error } = await db.from('college_majors')
          .select('title, family_title, credential_level, graduates_2yr').eq('unitid', unitid).in('credential_level', [2, 3]).limit(1000)
        if (error) throw new Error(error.message)
        let rows = data || []
        if (search) {
          const q = norm(search).split(' ').filter(Boolean)
          rows = rows.filter(m => { const w = norm(`${m.title} ${m.family_title}`).split(' '); return q.every(x => w.some(y => y.startsWith(x))) })
        }
        rows.sort((x, y) => (y.graduates_2yr || 0) - (x.graduates_2yr || 0))
        return {
          total_majors_awarded: (data || []).length,
          matched: rows.length,
          majors: rows.slice(0, 40).map(m => ({ major: m.title, field: m.family_title,
            level: m.credential_level === 3 ? "bachelor's" : 'associate', graduates_last_2_years: m.graduates_2yr })),
        }
      }),
    }),

    program_results: tool({
      description: 'Season-by-season record for one program: wins, losses, ties, conference record and RPI rank (D-I) where known.',
      inputSchema: z.object({ school_id: z.string() }),
      execute: run('program_results', async ({ school_id }) => {
        const { data, error } = await db.from('program_results')
          .select('season, division, conference, wins, losses, ties, win_pct, conf_wins, conf_losses, conf_ties, rpi_rank')
          .eq('school_id', school_id).order('season', { ascending: false }).limit(10)
        if (error) throw new Error(error.message)
        return { seasons: data || [] }
      }),
    }),

    rank_by_results: tool({
      description: 'Rank programs by RPI rank (NCAA D-I only) or by win percentage for one season, with optional division, conference and state filters.',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']),
        season: z.number().int().describe('Season year, e.g. 2026 (in progress) or 2025'),
        sort: z.enum(['rpi', 'win_pct']),
        division: z.enum(DIVISIONS).optional(),
        conference: z.string().optional(),
        states: z.array(z.string()).optional().describe('Two-letter state codes'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional(),
      }),
      execute: run('rank_by_results', async ({ gender, season, sort, division, conference, states, limit }) => {
        const rows = await allRows(() => {
          let q = db.from('program_results')
            .select('school_id, season, conference, wins, losses, ties, win_pct, rpi_rank, schools!inner(school, program_gender, state, is_active, division)')
            .eq('season', season).eq('schools.program_gender', gender)
          // schools.division holds 'NCAA D1' etc.; program_results.division uses
          // its own labels, so filtering on it matched nothing (bake-off, 2026-10-13).
          if (division) q = q.eq('schools.division', division)
          if (sort === 'rpi') q = q.not('rpi_rank', 'is', null)
          return q.order('school_id', { ascending: true })
        })
        const conf = conference ? confMatcher(conference) : null
        const st = states?.length ? new Set(states.map(s => s.toUpperCase())) : null
        const kept = rows.filter(r => r.schools?.is_active !== false
          && (!conf || conf(r.conference))
          && (!st || st.has(stateAbbr(r.schools?.state))))
          .filter(r => sort === 'rpi' || (r.wins + r.losses + r.ties) >= 5)
        kept.sort(sort === 'rpi' ? (a, b) => a.rpi_rank - b.rpi_rank : (a, b) => (b.win_pct - a.win_pct) || (b.wins - a.wins))
        const n = Math.min(limit || 10, MAX_ROWS)
        return {
          matched: kept.length,
          note: sort === 'win_pct' ? 'Programs with fewer than 5 games are left out.' : undefined,
          programs: kept.slice(0, n).map(r => ({ school_id: r.school_id, school: r.schools.school, division: r.schools.division,
            conference: r.conference, state: stateAbbr(r.schools.state), record: `${r.wins}-${r.losses}-${r.ties}`,
            win_pct: round(r.win_pct, 3), rpi_rank: r.rpi_rank })),
        }
      }),
    }),

    program_transfers: tool({
      description: 'Transfers into and out of one program by roster season: how many players arrived from (in) or left for (out) ' +
        'other college programs, by the other program\'s division and whether the move was up, down or lateral.',
      inputSchema: z.object({ school_id: z.string() }),
      execute: run('program_transfers', async ({ school_id }) => {
        const { data, error } = await db.from('program_transfer_summary')
          .select('roster_season, direction, counterpart_division, move, n').eq('school_id', school_id)
        if (error) throw new Error(error.message)
        const by = {}
        for (const r of data || []) {
          const k = `${r.roster_season}|${r.direction}`
          by[k] = by[k] || { roster_season: r.roster_season, direction: r.direction, total: 0, by_division: {} }
          by[k].total += r.n
          by[k].by_division[r.counterpart_division || 'unknown'] = (by[k].by_division[r.counterpart_division || 'unknown'] || 0) + r.n
        }
        return { note: 'Counts only transfers PitchSide could trace between two college rosters.',
          seasons: Object.values(by).sort((a, b) => b.roster_season - a.roster_season || a.direction.localeCompare(b.direction)) }
      }),
    }),

    program_coaches: tool({
      description: 'The current coaching staff of one program, with titles and published email addresses.',
      inputSchema: z.object({ school_id: z.string() }),
      execute: run('program_coaches', async ({ school_id }) => {
        const { data, error } = await db.from('coaches').select('first_name, last_name, title, email')
          .eq('school_id', school_id).eq('is_active', true)
        if (error) throw new Error(error.message)
        return { coaches: (data || []).map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), title: c.title, email: c.email })) }
      }),
    }),

    program_profile: tool({
      description: 'Profile facts for one program: location and division, recruiting style (freshmen vs transfers, in-state reach, ' +
        'international share, roster stability, each read against similar programs), expected early-departure rate, ' +
        'and campus facts from the U.S. College Scorecard (undergraduates, average net price, admission rate, graduation rate).',
      inputSchema: z.object({ school_id: z.string() }),
      execute: run('program_profile', async ({ school_id }) => {
        const [s, style, dep, link] = await Promise.all([
          db.from('schools').select('school, program_gender, division, conference, city, state').eq('id', school_id).maybeSingle(),
          db.from('program_recruiting_style').select('build_band, reach_band, abroad_band, stability_band').eq('school_id', school_id).maybeSingle(),
          db.from('program_departure_outlook').select('outlook_rate, transitions, basis').eq('school_id', school_id).maybeSingle(),
          db.from('school_federal_college').select('unitid, college_facts(federal_name, undergrad_enrollment, avg_net_price, cost_of_attendance, admission_rate, graduation_rate, locale, control)')
            .eq('school_id', school_id).maybeSingle(),
        ])
        if (!s.data) return { error: 'No program with that id.' }
        return {
          program: s.data,
          recruiting_style: style.data ? {
            builds_with: { low: 'mostly freshmen', typical: 'a typical mix', high: 'more transfers than peers' }[style.data.build_band] || null,
            in_state_reach: style.data.reach_band, international_share: style.data.abroad_band, roster_stability: style.data.stability_band,
            note: 'Bands are low / typical / high against similar programs.',
          } : null,
          expected_early_departure_rate: dep.data ? { rate: round(dep.data.outlook_rate, 3), seasons_tracked: dep.data.transitions, basis: dep.data.basis } : null,
          college_facts: link.data?.college_facts || null,
        }
      }),
    }),

    programs_watching_team: tool({
      description: 'Which college programs\' coaches have attended a club team\'s games, logged in PitchSide (the family\'s own club data). ' +
        'With no team given it uses the team the person has starred in PitchSide, including that team\'s earlier seasons.',
      inputSchema: z.object({
        team: z.string().optional().describe('Club team name as the person wrote it, e.g. "2009 Girls ECNL"; leave out for their starred team'),
      }),
      execute: run('programs_watching_team', async ({ team }) => {
        const [teams, seasonsRes, att] = await Promise.all([
          allRows(() => db.from('teams').select('id,name,gender,season_id,program_id,active,age_groups(name)').order('id')),
          db.from('seasons').select('id,name,start_date,is_active'),
          allRows(() => db.from('attendance')
            .select('id,coach_id,game_id,coaches!inner(school_id),games!inner(team_id,game_date)').order('id')),
        ])
        const seasons = seasonsRes.data || []
        const active = seasons.find(s => s.is_active) || null
        const current = teams.filter(t => active && String(t.season_id) === String(active.id))
        const lineIds = t => lineage(t, teams, seasons).map(l => String(l.team.id))
        // Every current team that has college coaches logged at its games (this season or its earlier seasons).
        const gamesOf = ids => new Set(att.filter(r => ids.includes(String(r.games?.team_id))).map(r => r.game_id)).size
        const visited = current.map(t => ({ team: t.name, games: gamesOf(lineIds(t)) }))
          .filter(x => x.games > 0).sort((a, b) => b.games - a.games)
          .map(x => `${x.team} (${x.games} ${x.games === 1 ? 'game' : 'games'} with college coaches logged)`)
        const allNames = current.map(t => t.name).slice(0, 40)

        let chosen = null
        if (team) {
          // Keep only the words that appear in some team name, so club names and
          // filler ("Ohio Premier", "team", "play") do not block a match.
          const tok = x => norm(x).replace(/\bu\s+(\d{1,2})\b/g, 'u$1').split(' ').filter(Boolean)
            .map(w => ({ girl: 'girls', women: 'girls', womens: 'girls', boy: 'boys', men: 'boys', mens: 'boys' }[w] || w))
          const vocab = new Set(teams.flatMap(t => tok(t.name)))
          const words = tok(team).filter(w => vocab.has(w))
          const pool = current.length ? current : teams
          const cand = words.length ? pool.filter(t => { const n = tok(t.name); return words.every(w => n.includes(w)) }) : []
          const exact = cand.filter(t => tok(t.name).length === words.length)
          chosen = cand.length === 1 ? cand[0] : exact.length === 1 ? exact[0] : null
          if (!chosen) {
            return {
              programs: [],
              note: cand.length > 1
                ? `Several club teams match "${team}". Ask which one, offering these options.`
                : `No club team matched "${team}". Team names in PitchSide are age group + gender + league (e.g. "U16 Girls ECNL"), not the club name.`,
              matching_teams: cand.map(t => t.name).slice(0, 12),
              teams_with_coach_visits: visited,
              all_teams: cand.length ? undefined : allNames,
            }
          }
        } else {
          const fav = new Set((ctx.favoriteTeamIds || []).map(String))
          const id = defaultTeamId(current, [...fav], teams, seasons)
          chosen = teams.find(t => String(t.id) === String(id)) || teams.find(t => fav.has(String(t.id))) || null
          if (!chosen) {
            return {
              programs: [],
              note: 'No starred team. Ask which club team they mean, offering the teams_with_coach_visits as options. They can also star their team on its page in PitchSide.',
              teams_with_coach_visits: visited,
              all_teams: allNames,
            }
          }
        }
        const line = lineIds(chosen)
        const sig = summarizeAttendance(att.filter(r => line.includes(String(r.games?.team_id))))
        const ref = await refData(db)
        const list = [...sig.entries()].map(([sid, v]) => ({ sid, v, s: ref.byId.get(sid) }))
          .filter(x => x.s)
          .sort((x, y) => y.v.games - x.v.games || String(y.v.latest || '').localeCompare(String(x.v.latest || '')))
        return {
          team: chosen.name,
          seasons_included: line.length,
          matched: list.length,
          note: list.length ? undefined : 'No college coaches logged at this team\'s games yet. Mention the teams_with_coach_visits if any.',
          teams_with_coach_visits: list.length ? undefined : visited,
          programs: list.slice(0, MAX_ROWS).map(({ sid, v, s }) => ({
            school_id: sid, school: s.school, gender: s.program_gender, division: s.division, conference: s.conference, state: stateAbbr(s.state),
            coaches: v.coaches, games: v.games, latest: v.latest,
            card: { value: v.games, label: v.games === 1 ? 'game watched' : 'games watched' },
          })),
        }
      }),
    }),
  }
}

// ── the instructions every model gets ───────────────────────────────────────
function instructions() {
  const today = new Date().toISOString().slice(0, 10)
  return [
    `You are Ask PitchSide, the college soccer assistant inside PitchSide's College Soccer Intelligence. Today is ${today}.`,
    'The people asking are families of club players looking at college soccer. Be warm, clear and direct.',
    '',
    'FACTS',
    '- Answer ONLY from the results of the look-up tools. Never use outside knowledge for numbers, names, records, rankings or coaches.',
    '- If the look-ups do not hold what was asked, say plainly that PitchSide does not have it, and suggest what it can answer instead. Do not guess.',
    '- Always resolve a college name with find_school first, then pass its school_id to the other tools. If both a men\'s and a women\'s program match and the question does not say which, answer for the one the conversation is about, or ask.',
    '- Openings are ESTIMATES (graduations, expected early departures, usual freshman intake); incoming commits are not known. Say "estimated".',
    '- Do not give advice on NCAA recruiting rules or contact dates, and do not discuss or rank individual players.',
    '- People write in every way: typos, slang ("keeper", "D1", "class of \'28", "the Buckeyes"), half sentences. Work out what they mean and use the look-ups; find_school tolerates typos and nicknames.',
    '- Openings questions need gender, position and graduating class. If any is missing and the conversation does not already say it, ask for the missing pieces in ONE short question with the likely options, and stop. Searches that do not need them (majors, academics, results) run without them.',
    '- Academic fit: use find_programs filters (admission rate, average SAT, graduation rate, net price, size, public/private, setting, major) and program_majors. PitchSide has no GPA data; say so if asked, and use admission rate and average SAT instead. A program whose average SAT is near the student\'s score is a typical academic match.',
    '- Judgment questions ("is X a good fit", "D2 or D3", "should she…"): do not decide for them. Lay out the relevant facts side by side (results and RPI, openings, roster stability, academics, cost) and name the trade-offs to weigh.',
    '- Questions about the family\'s own club team ("who has watched us", "which coaches came to our games") use programs_watching_team. If it cannot tell which team, ask which one and offer the teams it lists with coach visits logged; never say a team is missing when it is in the list returned.',
    `- Positions: ${POSITIONS.map(p => `${p.code}=${p.one}`).join(', ')}. Divisions: ${DIVISIONS.join(', ')}.`,
    '',
    'FORMAT (Markdown; it is rendered for the reader)',
    '- Start with a one- or two-sentence direct answer. No preamble, no restating the question.',
    '- Then structure: short bullet lists for a few facts; a Markdown table when comparing programs or seasons (3 to 10 rows, clear column headers); **bold** for the key number or name.',
    '- Link every program you name to its profile: [Ohio State](/school/<school_id>), using the school_id from the look-ups. Never invent a link.',
    '- When find_programs or rank_by_results returns a list, the app shows those programs as cards under your answer. Summarise the top 3 to 5 in prose or a compact table; do not repeat the whole list.',
    '- find_programs lists are already ranked by estimated freshman openings (what a recruit in that class competes for). Keep that order and lead with the freshman figure; the total can go in a second column.',
    '- Use a short ### heading only when an answer has two or more distinct parts.',
    '- End with one short line saying what the numbers are based on (for example "Based on 2026 rosters; openings are estimates.").',
    '- Write in American English ("program", not "programme"), with no em dashes. Keep the whole answer under about 200 words unless a table needs more.',
    '- After the answer, on its own line, write: STATUS: answered | partial | unavailable | clarify, followed by " - " and the missing topic in a few words when not fully answered (for example "STATUS: unavailable - ID camps"). The app hides this line and logs it so PitchSide can fill data gaps.',
    '- Then, on the very last line, write exactly: FOLLOW-UPS: question one | question two | question three',
    '  These are three short follow-up questions the reader might ask next that the look-ups can answer. The app turns them into buttons and hides this line.',
  ].join('\n')
}

function gatewayOptions(model, email) {
  return { gateway: {
    disallowPromptTraining: true, caching: 'auto', tags: ['pitchside-ask'], user: email,
    ...(model === DEFAULT_MODEL ? { models: [FALLBACK_MODEL] } : {}),
  } }
}

// Conversation turns from the page: [{ role: 'user'|'assistant', content }].
// Only text is kept; the last 20 turns; each capped in length.
function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-20)
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? 1000 : 4000) }))
}

// ── the question log (out_sql/24_ask_log.sql in the pipeline repo) ─────────
function adminClient() {
  return createClient(process.env.VITE_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } })
}

// The model ends every answer with "STATUS: answered|partial|unavailable|clarify - topic".
function readStatus(text) {
  const m = /^\s*\**STATUS:?\**:?\s*(answered|partial|unavailable|clarify)\b\s*(?:[-–—:|]\s*(.+))?$/im.exec(text || '')
  return m ? { status: m[1].toLowerCase(), gap: m[2] ? m[2].trim().slice(0, 200) : null } : { status: null, gap: null }
}
// What the page shows: everything before the STATUS / FOLLOW-UPS lines.
function visibleAnswer(text) {
  const m = /\n?[ \t]*\**(STATUS|FOLLOW-?UPS):?/i.exec(text || '')
  return (m ? text.slice(0, m.index) : text || '').trim()
}
function lookupSummary(log) {
  return log.map(l => {
    const o = l.output || {}
    const rows = ['programs', 'seasons', 'coaches', 'matches', 'majors'].map(k => (Array.isArray(o[k]) ? o[k].length : null)).find(x => x != null)
    return { tool: l.tool, input: l.input, rows: rows ?? null, matched: o.matched ?? null, error: o.error || null }
  })
}
// Best effort: a logging failure must never break an answer.
async function logAsk(row) {
  try {
    const { data, error } = await adminClient().from('ask_log').insert(row).select('id').single()
    return error ? null : data?.id || null
  } catch { return null }
}

// ── handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const who = await checkOwner(req)
  if (!who.ok) return res.status(who.status).json({ error: 'Not allowed: ' + who.reason })

  if (req.method === 'GET' && req.query?.log) {
    let q = adminClient().from('ask_log')
      .select('id,created_at,user_email,surface,question,turn,model,status,gap,lookups,answer,ms,input_tokens,output_tokens,error,rating')
      .order('created_at', { ascending: false }).limit(300)
    if (req.query.status) q = q.eq('status', String(req.query.status))
    const { data, error } = await q
    if (error) return res.status(500).json({ error: error.message })
    return res.status(200).json({ rows: data || [] })
  }

  if (req.method === 'GET') {
    try {
      const { models } = await gateway.getAvailableModels()
      const list = (models || [])
        .filter(m => (m.modelType || 'language') === 'language' && m.pricing)
        .map(m => ({ id: m.id, name: m.name, input_per_m: Number(m.pricing.input) * 1e6, output_per_m: Number(m.pricing.output) * 1e6 }))
        .sort((a, b) => a.id.localeCompare(b.id))
      let credits = null
      try { credits = await gateway.getCredits() } catch { /* not available with every auth method */ }
      const def = list.some(m => m.id === DEFAULT_MODEL) ? DEFAULT_MODEL : (list[0]?.id || DEFAULT_MODEL)
      return res.status(200).json({ default_model: def, models: list, credits })
    } catch (e) {
      return res.status(502).json({ error: 'AI Gateway: ' + (e.message || String(e)) })
    }
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'POST or GET only' })
  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})

  // Thumbs up / down on an earlier answer.
  if (body.feedback) {
    const id = String(body.feedback.log_id || '')
    const rating = Number(body.feedback.rating)
    if (!/^[0-9a-f-]{36}$/i.test(id) || ![1, -1, 0].includes(rating)) return res.status(400).json({ error: 'bad feedback' })
    const { error } = await adminClient().from('ask_log')
      .update({ rating: rating || null, rated_at: new Date().toISOString() }).eq('id', id).eq('user_email', who.email)
    return error ? res.status(500).json({ error: error.message }) : res.status(200).json({ ok: true })
  }

  const model = String(body.model || DEFAULT_MODEL)
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'bad model id' })
  const messages = cleanMessages(body.messages)
  const question = String(body.question || '').trim().slice(0, 1000)
  if (!messages.length && !question) return res.status(400).json({ error: 'question required' })
  if (messages.length && messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be the question' })
  const prompt = messages.length ? { messages } : { prompt: question }
  const asked = messages.length ? messages[messages.length - 1].content : question
  const turn = messages.length ? messages.filter(m => m.role === 'user').length : 1
  const ctx = {
    favoriteTeamIds: (Array.isArray(body.context?.favoriteTeamIds) ? body.context.favoriteTeamIds : [])
      .map(Number).filter(Number.isFinite).slice(0, 20),
  }

  const log = []
  const t0 = Date.now()
  const common = {
    model,
    instructions: instructions(),
    ...prompt,
    tools: buildTools(readClient(), log, ctx),
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1800,
    providerOptions: gatewayOptions(model, who.email),
  }
  const record = (text, usage, err) => {
    const { status, gap } = readStatus(text)
    return logAsk({
      user_email: who.email, surface: body.stream ? 'chat' : 'bench', question: asked, turn, model,
      status: err ? 'error' : (status || (text ? 'answered' : 'error')), gap,
      lookups: lookupSummary(log), answer: visibleAnswer(text).slice(0, 8000) || null, ms: Date.now() - t0,
      input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, error: err || null,
    })
  }

  // Streaming (the consumer page): newline-delimited JSON events.
  //   {t:'text', d}                  a piece of the answer
  //   {t:'lookup', tool, input}      a look-up started
  //   {t:'data', tool, input, output} a look-up finished, with its rows
  //   {t:'done', model, ms, usage, log_id}  finished (log_id: for thumbs up/down)
  //   {t:'error', error}             failed
  if (body.stream) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    const send = obj => res.write(JSON.stringify(obj) + '\n')
    let text = ''
    let err = null
    let usage = {}
    try {
      const result = streamText(common)
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') { text += part.text; send({ t: 'text', d: part.text }) }
        else if (part.type === 'tool-call') send({ t: 'lookup', tool: part.toolName, input: part.input })
        else if (part.type === 'tool-result') send({ t: 'data', tool: part.toolName, input: part.input, output: part.output })
        else if (part.type === 'error') { err = String(part.error?.message || part.error); send({ t: 'error', error: err }) }
      }
      usage = (await result.totalUsage) || {}
    } catch (e) {
      err = e.message || String(e)
      send({ t: 'error', error: err })
    }
    const logId = await record(text, usage, err)
    send({ t: 'done', model, ms: Date.now() - t0, log_id: logId,
      usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null } })
    return res.end()
  }

  // One-shot JSON (the owner test bench).
  try {
    const result = await generateText(common)
    const usage = result.totalUsage || result.usage || {}
    const gw = result.providerMetadata?.gateway || null
    const logId = await record(result.text, usage, null)
    return res.status(200).json({
      model,
      answer: result.text,
      lookups: log,
      log_id: logId,
      steps: result.steps?.length ?? null,
      usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null,
        cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? null },
      gateway_cost: gw?.cost ?? null,
      ms: Date.now() - t0,
    })
  } catch (e) {
    await record('', null, e.message || String(e))
    return res.status(502).json({ model, error: e.message || String(e), lookups: log, ms: Date.now() - t0 })
  }
}

// For test/ask.test.mjs only (no network): the pieces that can be checked offline.
export const _internals = { buildTools, readStatus, visibleAnswer, confMatcher, cardMetric, resetCache: () => { REF = null; CATALOG = null } }
