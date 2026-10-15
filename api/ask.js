/* global process */
import { createClient } from '@supabase/supabase-js'
import { generateText, streamText, tool, stepCountIs, gateway } from 'ai'
import { z } from 'zod'
import { POSITIONS, DIVISIONS, rankPrograms, reasons, stateAbbr } from '../src/lib/findPrograms.js'
import { expandTerms, scoreSchool, setAliasIndex } from '../src/lib/schoolMatch.js'
import { buildCatalog, searchMajors, offeringsBySchool, offeringFor, majorReason, choiceLabel } from '../src/lib/majorFilter.js'
import { lineage, defaultTeamId, summarizeAttendance, teamAge, teamProgramGender } from '../src/lib/attendanceSignal.js'
import { milesBetween } from '../src/lib/geo.js'
import { strengthIndex, fitFor, tierCounts } from '../src/lib/fitTier.js'
import { styleReason } from '../src/lib/styleFilter.js'
import { eventKey, isShowcase, pickEvent, gameLine, inviteList } from '../src/lib/eventInvites.js'
import { recruitingYear } from '../src/lib/recruitingYear.js'
import { similarPrograms } from '../src/lib/similarPrograms.js'
import { soccerFacts } from '../src/lib/soccerFacts.js'
import { AWARDS_SCOPE, AWARDS_NOTE, TYPE_LABEL, awardsByUnit, collegeAwards, shortLine, cardValue, upcomingDeadlines } from '../src/lib/actionAwards.js'
import { locatePlace, programPoints } from '../src/lib/geoSearch.js'
import { PILOT_HEADER, PILOT_BUDGET_USD, findPilot, pilotUsage, limitMessage, listPilots, pilotAdmin } from '../server/ask/pilots.js'
import { summarizeUsage } from '../server/ask/usage.js'

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
// How long the model thinks before answering. Timed live on 2026-10-13: with
// the provider default, about 500 of ~800 output tokens were hidden thinking,
// 2 to 3.5 s before the first word. The bench can pass another level to compare.
// Bake-off of the 19 test questions, same day: 'none' 19/19 right look-ups,
// 3.7 s average; 'low' 19/19, 4.3 s; honesty answers unchanged. So: none.
const REASONING_LEVELS = ['provider-default', 'none', 'minimal', 'low', 'medium']
const DEFAULT_REASONING = 'none'
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

// Every row of a query, PAGE rows at a time. The first page is read alone
// (most look-ups fit in one); after that, pages are read four at a time
// instead of one after another, which is what made a fresh server slow.
async function allRows(build, batch = 4) {
  const page = async from => {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    return data || []
  }
  let out = await page(0)
  if (out.length < PAGE) return out
  for (let from = PAGE; ; from += batch * PAGE) {
    const pages = await Promise.all(Array.from({ length: batch }, (_, i) => page(from + i * PAGE)))
    for (const p of pages) {
      out = out.concat(p)
      if (p.length < PAGE) return out
    }
  }
}

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()
const round = (x, d = 1) => (x == null || isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d)

// ── reference data, cached per server instance (15 minutes) ─────────────────
// Every active program, the alias table (nicknames, short names), and each
// program's College Scorecard facts. Loaded once and reused, so fuzzy name
// matching and academic filters cost no extra queries per question.
// A load already under way is shared, so two look-ups at once (or the
// warm-up started when a question arrives) never load it twice.
let REF = null, REF_LOADING = null
function refData(db) {
  if (REF && Date.now() - REF.at < 15 * 60 * 1000) return Promise.resolve(REF)
  if (!REF_LOADING) {
    REF_LOADING = loadRefData(db).then(r => { REF = r; return r }).finally(() => { REF_LOADING = null })
  }
  return REF_LOADING
}
async function loadRefData(db) {
  const [schools, aliases, links] = await Promise.all([
    allRows(() => db.from('schools').select('id,school,program_gender,division,conference,city,state').neq('is_active', false).order('id')),
    allRows(() => db.from('school_aliases').select('id,school_id,alias_norm,kind').order('id')),
    allRows(() => db.from('school_federal_college')
      .select('school_id,unitid,college_facts(undergrad_enrollment,avg_net_price,admission_rate,sat_average,graduation_rate,locale,control,latitude,longitude,median_earnings_10yr,median_debt)')
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
  return { at: Date.now(), schools, byId, facts, unitOf, links: links.map(l => ({ school_id: l.school_id, unitid: l.unitid })) }
}

let CATALOG = null
function majorCatalog(db) {
  if (!CATALOG) {
    CATALOG = loadMajorCatalog(db)
    CATALOG.catch(() => { CATALOG = null })
  }
  return CATALOG
}
async function loadMajorCatalog(db) {
  const { data, error } = await db.from('college_major_catalog')
    .select('cip_code,title,family_code,family_title,colleges_bachelors,colleges_associate').limit(PAGE)
  if (error) throw new Error(error.message)
  return buildCatalog(data || [])
}

// ── distance search ─────────────────────────────────────────────────────────
// Where each program is: the College Scorecard point of its college, else its
// own city found in geo_points (U.S. Census towns). Cached with REF.
function programPointsFor(db, ref) {
  if (!ref.points) {
    ref.points = programPoints(db, ref.schools, ref.facts)
    ref.points.catch(() => { ref.points = null })
  }
  return ref.points
}

// Each program's strength within its division and gender (src/lib/fitTier.js),
// from program_results for the latest two seasons; cached like REF, and a load
// under way is shared.
let STRENGTH = null, STRENGTH_LOADING = null
function strengthData(db) {
  if (STRENGTH && Date.now() - STRENGTH.at < 15 * 60 * 1000) return Promise.resolve(STRENGTH.map)
  if (!STRENGTH_LOADING) {
    STRENGTH_LOADING = (async () => {
      const [ref, top] = await Promise.all([
        refData(db),
        db.from('program_results').select('season').order('season', { ascending: false }).limit(1),
      ])
      const latest = top.data?.[0]?.season
      const rows = latest == null ? [] : await allRows(() => db.from('program_results')
        .select('school_id,season,wins,losses,ties,rpi_rank').gte('season', latest - 1)
        .order('school_id').order('season'))
      const programOf = new Map(ref.schools.map(x => [x.id, { division: x.division, gender: x.program_gender }]))
      const map = strengthIndex(rows, programOf)
      STRENGTH = { at: Date.now(), map }
      return map
    })().finally(() => { STRENGTH_LOADING = null })
  }
  return STRENGTH_LOADING
}

// Visit and action awards (src/lib/actionAwards.js) from college_action_awards,
// a small curated table; cached like REF, and a load under way is shared. A
// missing or unreadable table means no awards listed, never an error.
let AWARDS = null, AWARDS_LOADING = null
function awardsData(db) {
  if (AWARDS && Date.now() - AWARDS.at < 15 * 60 * 1000) return Promise.resolve(AWARDS.map)
  if (!AWARDS_LOADING) {
    AWARDS_LOADING = (async () => {
      let rows = []
      try {
        rows = await allRows(() => db.from('college_action_awards')
          .select('id,unitid,award_type,name,amount,per_year,amount_total,amount_text,condition_text,deadline,deadline_text,entry_year,url,checked,confidence')
          .order('id'))
      } catch { rows = [] }
      const map = awardsByUnit(rows)
      AWARDS = { at: Date.now(), map }
      return map
    })().finally(() => { AWARDS_LOADING = null })
  }
  return AWARDS_LOADING
}
const DEADLINE_WORDS = { passed: 'passed', soon: 'coming up within 30 days', open: 'open', none: 'no deadline stated' }
// One college's awards as the model reads them (program_profile, call_prep_facts).
function awardsView(map, unitid) {
  const today = new Date().toISOString().slice(0, 10)
  const list = map?.get(Number(unitid))
  const c = collegeAwards(list, today)
  if (!c.checked) return { checked: false, note: `PitchSide has not checked this college's visit and action awards yet (checked so far: ${AWARDS_SCOPE}).` }
  return {
    checked_on: c.checked_on,
    nothing_published: c.nothing_published || undefined,
    page_checked: c.nothing_published ? (list.find(a => a.type === 'none_found')?.url || undefined) : undefined,
    awards: c.awards.map(awardOut),
    note: AWARDS_NOTE,
  }
}
const awardOut = a => ({
  type: a.label, name: a.name, amount: a.amount_text, what_to_do: a.condition,
  deadline: a.deadline_text, deadline_status: DEADLINE_WORDS[a.status], entry_year: a.entry_year, official_page: a.url,
})

// Loads every question's search may need, started as soon as a question
// arrives so they run while the model is still planning its first step.
// Best effort: a failure here is retried by the look-up that needs it.
function warmUp(db) {
  refData(db).then(ref => programPointsFor(db, ref)).catch(() => {})
  majorCatalog(db).catch(() => {})
  strengthData(db).catch(() => {})
  awardsData(db).catch(() => {})
}
// A promise whose failure is reported only where it is awaited.
const quiet = p => { p.catch(() => {}); return p }
const locate = (db, near) => locatePlace(db, near)

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
  if (sort === 'distance') return { value: row.distance_miles == null ? null : row.distance_miles + ' mi', label: 'away' }
  if (sort === 'sat') return { value: row.sat_average, label: 'avg SAT' }
  if (sort === 'net_price') return { value: row.avg_net_price == null ? null : '$' + Math.round(row.avg_net_price / 1000) + 'k', label: 'avg net price' }
  if (sort === 'graduation_rate') return { value: pct(row.graduation_rate), label: 'graduate' }
  if (sort === 'earnings') return { value: row.median_earnings_10yr == null ? null : '$' + Math.round(row.median_earnings_10yr / 1000) + 'k', label: 'median earnings' }
  if (sort === 'size') return { value: row.undergrads == null ? null : row.undergrads.toLocaleString('en-US'), label: 'undergrads' }
  return { value: pct(row.admission_rate), label: 'admitted' }
}

// ── list highlights, worked out here so the model never compares rows itself ─
// Live check 2026-10-14: asked for observations, the model called Wilmington
// one of the cheapest of 19 programs (it was among the dearest). Every
// "closest / cheapest / most selective" claim now comes from these lines.
function highlightsFor(rows, { center, openings } = {}) {
  if (!rows || rows.length < 2) return undefined
  const best = (val, lower) => {
    let b = null
    for (const x of rows) {
      const v = val(x)
      if (v == null || Number.isNaN(Number(v))) continue
      if (!b || (lower ? v < b.v : v > b.v)) b = { x, v: Number(v) }
    }
    return b
  }
  const name = x => x.s.school
  const pct = v => Math.round(v * 100) + '%'
  const out = []
  let b
  if (center && (b = best(x => x.dist, true))) out.push(`Closest: ${name(b.x)} (${Math.round(b.v)} mi)`)
  if (openings && (b = best(x => x.r.est_freshman ?? x.r.est_spots, false))) out.push(`Most estimated freshman openings: ${name(b.x)} (about ${round(b.v)})`)
  if ((b = best(x => x.f?.avg_net_price, true))) out.push(`Lowest average net price: ${name(b.x)} ($${Math.round(b.v).toLocaleString('en-US')} a year)`)
  if ((b = best(x => x.f?.avg_net_price, false))) out.push(`Highest average net price: ${name(b.x)} ($${Math.round(b.v).toLocaleString('en-US')} a year)`)
  if ((b = best(x => x.f?.admission_rate, true))) out.push(`Most selective: ${name(b.x)} (${pct(b.v)} admitted)`)
  if ((b = best(x => x.f?.sat_average, false))) out.push(`Highest average SAT: ${name(b.x)} (${b.v})`)
  if ((b = best(x => x.f?.graduation_rate, false))) out.push(`Highest graduation rate: ${name(b.x)} (${pct(b.v)})`)
  if ((b = best(x => x.f?.median_earnings_10yr, false))) out.push(`Highest median earnings 10 years after starting: ${name(b.x)} ($${Math.round(b.v).toLocaleString('en-US')})`)
  if ((b = best(x => x.f?.median_debt, true))) out.push(`Lowest median debt at graduation: ${name(b.x)} ($${Math.round(b.v).toLocaleString('en-US')})`)
  if ((b = best(x => x.f?.undergrad_enrollment, true))) out.push(`Smallest: ${name(b.x)} (${b.v.toLocaleString('en-US')} undergraduates)`)
  if ((b = best(x => x.f?.undergrad_enrollment, false))) out.push(`Largest: ${name(b.x)} (${b.v.toLocaleString('en-US')} undergraduates)`)
  return out.length ? out : undefined
}

// ── matching a college name (find_school, and the program look-ups) ─────────
function matchSchools(ref, name, gender) {
  // Words people add that are not part of any name: "the Buckeyes",
  // "Penn State women's soccer team".
  const cleaned = String(name || '').replace(/\b(the|team|teams|soccer|program|programs|women'?s|men'?s|womens|mens|girls|boys)\b/gi, ' ')
    .replace(/\s+/g, ' ').trim() || String(name || '')
  const terms = expandTerms(cleaned)
  if (!terms.length) return []
  const scored = []
  for (const s of ref.schools) {
    if (gender && s.program_gender !== gender) continue
    const score = scoreSchool(s, terms, { query: cleaned, fields: ['name', 'city', 'state'] })
    if (score > 0) scored.push({ s, score })
  }
  scored.sort((a, b) => b.score - a.score || String(a.s.school).localeCompare(String(b.s.school)))
  // A name typed exactly as the college is called wins outright: "University
  // of Michigan" must not come back as several Michigan colleges (pilot,
  // 2026-10-14). Only the program(s) with that exact name are returned.
  const exact = scored.filter(x => norm(x.s.school) === norm(cleaned))
  if (exact.length) return exact.map(x => x.s)
  const top = scored.length ? scored[0].score : 0
  return scored.filter(x => x.score >= top * 0.6).slice(0, 10).map(x => x.s)
}
const matchRow = s => ({ school_id: s.id, school: s.school, gender: s.program_gender,
  division: s.division, conference: s.conference, city: s.city, state: s.state })

// The model may name the college instead of passing a school_id, which saves a
// find_school round trip. Returns { s } or { result } (no match / several).
async function pickSchool(db, { school_id, school, gender }) {
  const ref = await refData(db)
  if (school_id && ref.byId.has(school_id)) return { s: ref.byId.get(school_id) }
  if (!school) return { result: { error: 'Give school (the college name) or a school_id from find_school.' } }
  const found = matchSchools(ref, school, gender)
  if (found.length === 1) return { s: found[0] }
  if (!found.length) return { result: { matches: [], note: `No program matched "${school}", even allowing for typos. It may have closed, or PitchSide may not track it.` } }
  return { result: { matches: found.map(matchRow), note: 'Several programs match. Call again with the school_id of the one the person means (or ask, if it is unclear, e.g. men\'s or women\'s).' } }
}
const GK_TITLE = /goal ?keep|keeper|\bgk\b/i
// Outreach emails (backlog F4): who to write to on a staff.
const HEAD_TITLE = t => /\bhead\b/i.test(t || '') && /coach/i.test(t || '') && !/assistant|associate|volunteer|graduate/i.test(t || '')
const RECRUIT_TITLE = /recruit/i
const lastName = n => String(n || '').trim().split(/\s+/).pop() || ''
/**
 * From a staff list [{ name, title, email }] -> who a first email goes to.
 * Every coach with a published email address (recruiting guidance: write to
 * the whole staff; To the head coach, Cc the others), head coach first, then the position coach
 * (goalkeepers only; other positions are rarely in a title), the recruiting
 * coordinator, then the other coaches; at most 8. Non-coaching staff (operations,
 * trainers) only when no coach has an address.
 *   greeting: "Coach Lead, Coach Keep, and Coach Cruit" (full names where two
 *   coaches share a last name).
 */
function outreachAddresses(coaches, position) {
  const withEmail = (coaches || []).filter(c => c && /@/.test(c.email || ''))
  const coachLike = withEmail.filter(c => /coach/i.test(c.title || ''))
  const pool = coachLike.length ? coachLike : withEmail
  const rank = c => {
    const t = c.title || ''
    if (HEAD_TITLE(t)) return 0
    if (position === 'GK' && GK_TITLE.test(t)) return 1
    if (RECRUIT_TITLE.test(t)) return 2
    if (/associate/i.test(t)) return 3
    if (/assistant/i.test(t)) return 4
    return 5
  }
  const seen = new Set()
  const to = pool.map((c, i) => ({ c, i, r: rank(c) }))
    .sort((x, y) => x.r - y.r || x.i - y.i)
    .map(x => x.c)
    .filter(c => { const k = c.email.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true })
    .slice(0, 8)
  const lasts = to.map(c => lastName(c.name))
  const names = to.map((c, i) => `Coach ${lasts.filter(l => l === lasts[i]).length > 1 ? String(c.name).trim() : lasts[i]}`)
  const greeting = !names.length ? 'Coach'
    : names.length === 1 ? names[0]
    : names.length === 2 ? `${names[0]} and ${names[1]}`
    : `${names.slice(0, -1).join(', ')}, and ${names[names.length - 1]}`
  const pick = c => ({ name: c.name, title: c.title || null, email: c.email })
  // To: the head coach (or co-heads); Cc: everyone else. No head coach with an
  // address: the first coach in the order above goes in To.
  const heads = to.filter(c => HEAD_TITLE(c.title))
  const main = heads.length ? heads : to.slice(0, 1)
  return { to: main.map(pick), cc: to.filter(c => !main.includes(c)).map(pick), greeting }
}
const programHead = s => ({ school_id: s.id, school: s.school, gender: s.program_gender, division: s.division, conference: s.conference })
const SCHOOL_INPUT = {
  school: z.string().optional().describe('College name as the person wrote it (typos fine); use this OR school_id'),
  gender: z.enum(['M', 'W']).optional().describe('M = men\'s program, W = women\'s program'),
  school_id: z.string().optional().describe('From find_school or an earlier look-up'),
}

// What the model reads from a look-up: no empty fields, no UI-only card data,
// and at most 15 programs (the cards under the answer show every row). Less to
// read means a faster answer; the browser still gets the full output.
const MODEL_ROWS = 15
function lean(v) {
  if (Array.isArray(v)) return v.map(lean)
  if (v && typeof v === 'object') {
    const o = {}
    for (const [k, x] of Object.entries(v)) { if (x == null || x === '' || k === 'card') continue; o[k] = lean(x) }
    return o
  }
  return v
}
function modelView({ output }) {
  let o = output
  for (const key of ['programs', 'majors']) {
    if (o && Array.isArray(o[key]) && o[key].length > MODEL_ROWS) {
      const total = o.matched ?? o[key].length
      o = { ...o, [key]: o[key].slice(0, MODEL_ROWS), showing: `top ${MODEL_ROWS} rows sent to you, in order; the total is ${total}. Quote ${total} as the count; never mention ${MODEL_ROWS} or how many rows you received.` }
    }
  }
  return { type: 'json', value: lean(o) }
}

// ── the look-ups ────────────────────────────────────────────────────────────
function buildTools(db, log, ctx = {}) {
  const tools = buildToolSet(db, log, ctx)
  for (const t of Object.values(tools)) t.toModelOutput = modelView
  return tools
}
function buildToolSet(db, log, ctx) {
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
        if (!String(name || '').trim()) return { matches: [], note: 'No name given.' }
        const keep = matchSchools(ref, name, gender)
        if (!keep.length) return { matches: [], note: 'No program matched that name, even allowing for typos. It may have closed, or PitchSide may not track it.' }
        return {
          matches: keep.map(matchRow),
          note: keep.length > 1 ? 'Several programs match; pick the one the person means, or ask if it is unclear.' : undefined,
        }
      }),
    }),

    find_programs: tool({
      description: 'Search and rank college soccer programs. Use it for "which programs…" questions. Every filter is optional except gender. ' +
        'With position + hs_class it estimates roster OPENINGS for that recruit (the Find programs page); results are ranked by estimated freshman openings. ' +
        'Academic and campus filters come from the U.S. College Scorecard: admission rate, average SAT, graduation rate, average net price per year, ' +
        'undergraduate size, public or private, setting. "major" keeps colleges that awarded that major or field in the last two years. ' +
        'GPA is NOT available; use admission rate and average SAT as the measure of academic selectivity. ' +
        '"near" + "radius_miles" keeps programs within that many miles (straight line) of a town or ZIP code and adds distance_miles.',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']),
        position: z.enum(['GK', 'D', 'M', 'F']).optional().describe('GK goalkeeper, D defender, M midfielder, F forward'),
        hs_class: z.number().int().optional().describe('High-school graduating class, e.g. 2027 (enters college that fall)'),
        divisions: z.array(z.enum(DIVISIONS)).optional().describe('Levels to search; also the levels the player is aiming for, used for the Reach / Good fit / Safety labels'),
        student_sat: z.number().int().min(400).max(1600).optional()
          .describe('The player\'s SAT total (convert an ACT first). With divisions or alone, each program gets a Reach / Good fit / Safety label (fit)'),
        states: z.array(z.string()).optional().describe('Two-letter state codes to keep, e.g. ["OH","PA"]'),
        exclude_states: z.array(z.string()).optional().describe('Two-letter state codes to leave out, e.g. ["OH"] for "out of state" from Ohio'),
        schools: z.array(z.string()).optional().describe('College names (or school_ids) to find IN this same search: each comes back with its rank in the full list, its distance and its figures, or, if the filters left it out, the reason. Use for "why is X not on the list", "where does X rank".'),
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
        near: z.string().optional().describe('A town with its state ("Dublin, OH") or a 5-digit ZIP code'),
        radius_miles: z.number().min(1).max(1500).optional().describe('Straight-line miles from "near"; default 100'),
        sort: z.enum(['openings', 'distance', 'selectivity', 'sat', 'net_price', 'graduation_rate', 'earnings', 'size', 'name']).optional()
          .describe('Default: openings when position and hs_class are given, else distance when near is given, else selectivity'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional(),
      }),
      execute: run('find_programs', async (a) => {
        // Start every read this search needs at once; each is awaited where used.
        const openings = !!(a.position && a.hs_class)
        const refP = quiet(refData(db))
        const wantFit = a.student_sat != null || !!a.divisions?.length
        const strengthP = wantFit ? quiet(strengthData(db)) : null
        const awardsP = awardsData(db).catch(() => new Map())
        const locP = a.near ? quiet(locate(db, a.near)) : null
        const latestP = openings ? quiet((async () => {
          const { data: lat } = await db.from('program_openings_outlook').select('current_season')
            .order('current_season', { ascending: false }).limit(1)
          return lat?.[0]?.current_season ?? null
        })()) : null
        const outlookP = openings ? quiet(allRows(() => db.from('program_openings_outlook')
          .select('school_id,entry_season,position,current_season,graduating,continuing,early_rate,transitions,' +
            'fresh_share,est_spots,est_freshman,schools!inner(school,program_gender,division,conference,city,state)')
          .eq('entry_season', a.hs_class).eq('position', a.position).eq('schools.program_gender', a.gender)
          .order('school_id', { ascending: true }))) : null
        const majorP = a.major ? quiet((async () => {
          const choice = searchMajors(await majorCatalog(db), a.major, 1)[0] || null
          if (!choice) return { choice: null, rows: [] }
          const rows = await allRows(() => db.from('college_majors')
            .select('unitid,cip_code,title,credential_level,graduates_2yr')
            .eq(choice.kind === 'area' ? 'family_code' : 'cip_code', choice.code)
            .in('credential_level', [2, 3]).order('unitid').order('cip_code').order('credential_level'))
          return { choice, rows }
        })()) : null

        const ref = await refP
        let center = null, radius = null, points = null, noLocation = 0
        if (a.near) {
          const loc = await locP
          if (loc.error) return { programs: [], note: loc.error }
          if (loc.ambiguous) return { programs: [], note: `Several places are called "${a.near}". Ask which one (or for a ZIP code).`, places: loc.ambiguous }
          center = loc.point
          radius = a.radius_miles || 100
          points = await programPointsFor(db, ref)
        }
        let latest = null
        let base
        if (openings) {
          latest = await latestP
          const rows = await outlookP
          if (!rows.length) return { programs: [], note: `No openings estimates for the class of ${a.hs_class}. Latest roster season is ${latest}; classes ${latest + 1} to ${latest + 4} are covered.` }
          base = rankPrograms(rows, { minSeason: latest != null ? latest - 1 : null })
        } else {
          base = ref.schools.filter(s => s.program_gender === a.gender)
            .map(s => ({ school_id: s.id, schools: { school: s.school, division: s.division, conference: s.conference, city: s.city, state: s.state } }))
        }

        let majorChoice = null, offerings = null
        if (a.major) {
          const m = await majorP
          majorChoice = m.choice
          if (!majorChoice) return { programs: [], note: `PitchSide's majors list has nothing matching "${a.major}". Try a broader field name.` }
          offerings = offeringsBySchool(ref.links, m.rows)
        }

        const conf = a.conference ? confMatcher(a.conference) : null
        const divs = a.divisions?.length ? new Set(a.divisions) : null
        const sts = a.states?.length ? new Set(a.states.map(s => s.toUpperCase())) : null
        const notSts = a.exclude_states?.length ? new Set(a.exclude_states.map(s => s.toUpperCase())) : null
        const need = [a.sat_min, a.sat_max, a.admission_rate_max, a.admission_rate_min, a.graduation_rate_min,
          a.net_price_max, a.undergrads_min, a.undergrads_max, a.type, a.setting].some(v => v != null)
        const distanceOf = id => {
          if (!center) return null
          const pt = points.get(id)
          return pt ? milesBetween(center, pt) : null
        }
        // The first filter a program fails, in words, or null when it passes.
        // Shared by the search and by the "schools" check ("why is X not here").
        const failReason = (r, s, f, dist) => {
          if (divs && !divs.has(s.division)) return `division is ${s.division || 'unknown'}`
          if (sts && !sts.has(stateAbbr(s.state))) return `state is ${stateAbbr(s.state) || 'unknown'}`
          if (notSts && notSts.has(stateAbbr(s.state))) return `in ${stateAbbr(s.state)}, which was left out`
          if (conf && !conf(s.conference)) return `conference is ${s.conference || 'unknown'}`
          if (need && !f) return 'no College Scorecard figures for this college'
          if (a.sat_min != null && !(f.sat_average >= a.sat_min)) return `average SAT ${f.sat_average ?? 'not published'} is below ${a.sat_min}`
          if (a.sat_max != null && !(f.sat_average != null && f.sat_average <= a.sat_max)) return `average SAT ${f.sat_average ?? 'not published'} is above ${a.sat_max}`
          if (a.admission_rate_max != null && !(f.admission_rate != null && f.admission_rate <= a.admission_rate_max)) return `admission rate ${f.admission_rate ?? 'not published'} is above ${a.admission_rate_max}`
          if (a.admission_rate_min != null && !(f.admission_rate == null || f.admission_rate >= a.admission_rate_min)) return `admission rate ${f.admission_rate} is below ${a.admission_rate_min}`
          if (a.graduation_rate_min != null && !(f.graduation_rate >= a.graduation_rate_min)) return `graduation rate ${f.graduation_rate ?? 'not published'} is below ${a.graduation_rate_min}`
          if (a.net_price_max != null && !(f.avg_net_price != null && f.avg_net_price <= a.net_price_max)) return `net price ${f.avg_net_price ?? 'not published'} is above ${a.net_price_max}`
          if (a.undergrads_min != null && !(f.undergrad_enrollment >= a.undergrads_min)) return `${f.undergrad_enrollment ?? 'unknown'} undergraduates is below ${a.undergrads_min}`
          if (a.undergrads_max != null && !(f.undergrad_enrollment != null && f.undergrad_enrollment <= a.undergrads_max)) return `${f.undergrad_enrollment ?? 'unknown'} undergraduates is above ${a.undergrads_max}`
          if (a.type && controlWord(f.control) !== a.type) return `it is ${controlWord(f.control) || 'of unknown type'}, not ${a.type}`
          if (a.setting && settingWord(f.locale) !== a.setting) return `setting is ${settingWord(f.locale) || 'unknown'}, not ${a.setting}`
          if (center && dist == null) return 'its location is not known'
          if (center && dist > radius) return `${Math.round(dist)} miles away, beyond ${radius}`
          if (offerings && !offeringFor(offerings, r.school_id, s.division)) return 'it has not awarded that major in the last two years'
          return null
        }
        // Reach / Good fit / Safety (src/lib/fitTier.js): with the player's SAT
        // and/or the levels aimed for. Without results data, academics alone.
        const strength = strengthP ? await strengthP.catch(() => null) : null
        const player = { sat: a.student_sat ?? null, targets: a.divisions?.length ? a.divisions : null }
        const fitOf = (id, s, f, r) => (wantFit ? fitFor({
          division: s.division, gender: a.gender, sat_average: f?.sat_average, admission_rate: f?.admission_rate,
          est_freshman: openings && r ? r.est_freshman : null,
        }, strength?.get(id) || null, player) : null)
        const out = []
        for (const r of base) {
          const s = r.schools || {}
          const f = ref.facts.get(r.school_id) || null
          const dist = distanceOf(r.school_id)
          const why = failReason(r, s, f, dist)
          if (why) { if (why === 'its location is not known') noLocation++; continue }
          const majorNote = offerings ? majorReason(offeringFor(offerings, r.school_id, s.division), majorChoice) : null
          out.push({ r, s, f, majorNote, dist, fit: fitOf(r.school_id, s, f, r) })
        }
        let fitSummary
        if (wantFit) {
          const c = tierCounts(out.map(x => x.fit))
          const first = tier => out.filter(x => x.fit?.tier === tier).slice(0, 4).map(x => x.s.school)
          fitSummary = {
            reach: c.reach, good_fit: c.good, safety: c.safety,
            first_reach: first('reach'), first_good_fit: first('good'), first_safety: first('safety'),
            basis: 'Labels are estimates. Academic: the player\'s SAT against the college\'s average SAT and admission rate (College Scorecard). ' +
              'Athletic: the level the player is aiming for (divisions) and the program\'s place in its division by RPI or record over the latest two seasons, ' +
              'with very few estimated freshman openings counting toward reach. ' + (strength ? '' : 'Results were not available, so athletic labels use the level alone.'),
          }
        }

        const sort = (a.sort === 'distance' && !center) ? 'selectivity' : a.sort || (openings ? 'openings' : center ? 'distance' : 'selectivity')
        const num = (x, dflt) => (x == null ? dflt : Number(x))
        const cmp = {
          openings: () => 0,
          distance: (x, y) => x.dist - y.dist,
          selectivity: (x, y) => num(x.f?.admission_rate, 2) - num(y.f?.admission_rate, 2),
          sat: (x, y) => num(y.f?.sat_average, -1) - num(x.f?.sat_average, -1),
          net_price: (x, y) => num(x.f?.avg_net_price, 1e9) - num(y.f?.avg_net_price, 1e9),
          graduation_rate: (x, y) => num(y.f?.graduation_rate, -1) - num(x.f?.graduation_rate, -1),
          earnings: (x, y) => num(y.f?.median_earnings_10yr, -1) - num(x.f?.median_earnings_10yr, -1),
          size: (x, y) => num(y.f?.undergrad_enrollment, -1) - num(x.f?.undergrad_enrollment, -1),
          name: (x, y) => String(x.s.school).localeCompare(String(y.s.school)),
        }[sort]
        if (sort !== 'openings') out.sort(cmp)

        const n = Math.min(a.limit || MAX_ROWS, MAX_ROWS)
        const awards = await awardsP
        const today = new Date().toISOString().slice(0, 10)
        const toRow = ({ r, s, f, majorNote, dist, fit }) => {
          const row = {
            school_id: r.school_id, school: s.school, division: s.division, conference: s.conference, state: stateAbbr(s.state),
            admission_rate: f?.admission_rate ?? null, sat_average: f?.sat_average ?? null,
            graduation_rate: f?.graduation_rate ?? null, avg_net_price: f?.avg_net_price ?? null,
            undergrads: f?.undergrad_enrollment ?? null, type: f ? controlLabel(f.control) : null, setting: f ? LOCALE[f.locale] || null : null,
            median_earnings_10yr: f?.median_earnings_10yr ?? null, median_debt: f?.median_debt ?? null,
          }
          if (dist != null) row.distance_miles = Math.round(dist)
          if (majorNote) row.major = majorNote
          if (fit) row.fit = { tier: fit.tier, label: fit.label, why: fit.why }
          const aw = collegeAwards(awards.get(ref.unitOf.get(r.school_id)), today)
          if (aw.checked && !aw.nothing_published) row.action_awards = aw.awards.map(x => shortLine(x, today))
          if (openings) {
            Object.assign(row, {
              est_freshman_openings: round(r.est_freshman), est_total_openings: round(r.est_spots),
              graduating_before_entry: r.graduating, roster_season: r.current_season,
              reasons: reasons(r, a.position, a.hs_class),
            })
          }
          row.card = cardMetric(sort, row, openings)
          return row
        }

        // "schools": where named programs stand in THIS search (rank, figures),
        // or the first filter that left each one out.
        let asked
        if (a.schools?.length) {
          asked = []
          const rankOf = new Map(out.map((x, i) => [x.r.school_id, i + 1]))
          const baseOf = new Map(base.map(r => [r.school_id, r]))
          // A short name ("Michigan") matches several colleges. Prefer the one
          // called "University of <name>"; otherwise report every match (up to
          // four), so the answer never stalls on "which one?" (pilot, 2026-10-14).
          const targets = []
          for (const name of a.schools.slice(0, 6)) {
            let hit = ref.byId.has(name) ? [ref.byId.get(name)] : matchSchools(ref, name, a.gender)
            if (hit.length > 1) {
              const flagship = hit.filter(h => norm(h.school) === `university of ${norm(name)}`)
              if (flagship.length === 1) hit = flagship
            }
            if (!hit.length) { asked.push({ asked_for: name, note: 'no program matched' }); continue }
            for (const h of hit.slice(0, 4)) targets.push({ name, sch: h, several: hit.length > 1 })
          }
          for (const { name, sch, several } of targets) {
            const also = several ? { asked_for: name, note: 'one of several programs matching this name' } : {}
            const rank = rankOf.get(sch.id)
            if (rank) { const row = toRow(out[rank - 1]); delete row.card; asked.push({ ...row, rank_in_search: rank, of: out.length, ...also }); continue }
            const dist = distanceOf(sch.id)
            const f = ref.facts.get(sch.id) || null
            const r = baseOf.get(sch.id)
            const s2 = { school: sch.school, division: sch.division, conference: sch.conference, city: sch.city, state: sch.state }
            const why = r ? failReason(r, s2, f, dist)
              : openings ? `no openings estimate for a ${a.position} in the class of ${a.hs_class} (its rosters do not cover it)` : 'not in this search'
            asked.push({
              school_id: sch.id, school: sch.school, division: sch.division, state: stateAbbr(sch.state),
              in_results: false, left_out_because: why || 'not in this search',
              distance_miles: dist != null ? Math.round(dist) : undefined,
              admission_rate: f?.admission_rate ?? undefined, sat_average: f?.sat_average ?? undefined,
              avg_net_price: f?.avg_net_price ?? undefined, undergrads: f?.undergrad_enrollment ?? undefined,
              est_freshman_openings: r && openings ? round(r.est_freshman) : undefined,
              fit: (() => { const x = fitOf(sch.id, s2, f, r); return x ? { tier: x.tier, label: x.label, why: x.why } : undefined })(),
              ...also,
            })
          }
        }

        const rows = out.slice(0, n).map(toRow)
        return {
          matched: out.length,
          highlights: highlightsFor(out, { center, openings }),
          fit_summary: fitSummary,
          showing: out.length > n ? `the first ${n} of ${out.length} in this order (the cards show these ${n})` : undefined,
          ranked_by: sort === 'openings'
            ? 'estimated openings for incoming freshmen (est_freshman_openings), then total; the same order as the Find programs page'
            : sort,
          major: majorChoice ? choiceLabel(majorChoice) : undefined,
          latest_roster_season: latest ?? undefined,
          near: center ? center.name : undefined,
          radius_miles: center ? radius : undefined,
          distance_note: center ? 'Straight-line miles from the place named, to the college campus (driving distance is longer).' : undefined,
          without_location: center && noLocation ? noLocation : undefined,
          academics_note: 'Admission rate, average SAT, graduation rate, net price, median earnings 10 years after starting (former students who received federal aid) and median debt at graduation (federal loans of completers) are from the U.S. College Scorecard (2026 release). GPA is not available.',
          asked_about: asked,
          awards_note: rows.some(x => x.action_awards) ? `action_awards: ${AWARDS_NOTE} Checked so far: ${AWARDS_SCOPE}.` : undefined,
          programs: rows,
        }
      }),
    }),

    program_majors: tool({
      description: 'Majors one college awarded in the last two years (U.S. College Scorecard), optionally searched, e.g. "does Denison offer nursing", "what engineering majors does Purdue have".',
      inputSchema: z.object({
        ...SCHOOL_INPUT,
        search: z.string().optional().describe('Words to look for in the major titles, e.g. "nursing", "business"'),
      }),
      execute: run('program_majors', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id, search = a.search
        const ref = await refData(db)
        const unitid = ref.unitOf.get(school_id)
        if (!unitid) return { program: programHead(p.s), majors: [], note: 'PitchSide has no federal college record linked to this program.' }
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
          program: programHead(p.s),
          total_majors_awarded: (data || []).length,
          matched: rows.length,
          majors: rows.slice(0, 40).map(m => ({ major: m.title, field: m.family_title,
            level: m.credential_level === 3 ? "bachelor's" : 'associate', graduates_last_2_years: m.graduates_2yr })),
        }
      }),
    }),

    program_results: tool({
      description: 'Season-by-season record for one program: wins, losses, ties, conference record and RPI rank (D-I) where known.',
      inputSchema: z.object(SCHOOL_INPUT),
      execute: run('program_results', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id
        const { data, error } = await db.from('program_results')
          .select('season, division, conference, wins, losses, ties, win_pct, conf_wins, conf_losses, conf_ties, rpi_rank')
          .eq('school_id', school_id).order('season', { ascending: false }).limit(10)
        if (error) throw new Error(error.message)
        return { program: programHead(p.s), seasons: data || [] }
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
      inputSchema: z.object(SCHOOL_INPUT),
      execute: run('program_transfers', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id
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
        return { program: programHead(p.s), note: 'Counts only transfers PitchSide could trace between two college rosters.',
          seasons: Object.values(by).sort((a, b) => b.roster_season - a.roster_season || a.direction.localeCompare(b.direction)) }
      }),
    }),

    program_coaches: tool({
      description: 'The current coaching staff of one program, with titles and published email addresses.',
      inputSchema: z.object(SCHOOL_INPUT),
      execute: run('program_coaches', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id
        const { data, error } = await db.from('coaches').select('first_name, last_name, title, email')
          .eq('school_id', school_id).eq('is_active', true)
        if (error) throw new Error(error.message)
        const coaches = (data || []).map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), title: c.title, email: c.email }))
        const gk = coaches.filter(c => GK_TITLE.test(c.title || ''))
        return {
          program: programHead(p.s), coaches,
          goalkeeper_coach: gk.length ? gk.map(c => c.name) : 'none listed',
          goalkeeper_note: gk.length ? undefined : 'No title on this staff names goalkeepers; another coach may still work with them.',
        }
      }),
    }),

    outreach_facts: tool({
      description: 'Everything needed to draft a first outreach email from a recruit to ONE program\'s coaches: the program (division, conference, city, state), ' +
        'who to address (every coach on the staff with a published email address: to = the head coach, cc = the other coaches), ' +
        'the greeting naming each of them, the current roster at the player\'s position by class year, and the last two seasons\' records. ' +
        'Use it whenever asked to draft, write or prepare an email or message to a program or its coaches.',
      inputSchema: z.object({ ...SCHOOL_INPUT, position: z.enum(['GK', 'D', 'M', 'F']).optional().describe('The player\'s position, when known') }),
      execute: run('outreach_facts', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const s = p.s
        const [co, ros, res] = await Promise.all([
          db.from('coaches').select('first_name, last_name, title, email').eq('school_id', s.id).eq('is_active', true),
          a.position
            ? db.from('college_rosters').select('roster_season, class_year').eq('school_id', s.id).eq('position', a.position)
              .eq('is_active', true).order('roster_season', { ascending: false }).limit(60)
            : Promise.resolve({ data: null, error: null }),
          db.from('program_results').select('season, wins, losses, ties, conf_wins, conf_losses, conf_ties, rpi_rank')
            .eq('school_id', s.id).order('season', { ascending: false }).limit(2),
        ])
        if (co.error) throw new Error(co.error.message)
        const staff = (co.data || []).map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), title: c.title, email: c.email || null }))
        const addr = outreachAddresses(staff, a.position)
        let roster = null
        if (ros.data?.length) {
          const latest = ros.data[0].roster_season
          const now = ros.data.filter(r => r.roster_season === latest)
          const byClass = {}
          for (const r of now) byClass[r.class_year || 'unknown'] = (byClass[r.class_year || 'unknown'] || 0) + 1
          roster = { roster_season: latest, position: a.position, players: now.length, by_class_year: byClass }
        }
        return {
          program: { ...programHead(s), city: s.city, state: s.state },
          to: addr.to, cc: addr.cc, greeting: addr.greeting,
          email_note: addr.to.length ? undefined : 'No published email address for this staff in PitchSide. Write the draft without a To line and say so.',
          staff_listed: staff.length,
          position_roster: roster,
          recent_seasons: res.data || [],
        }
      }),
    }),

    call_prep_facts: tool({
      description: 'Everything PitchSide knows to prepare a player for a phone call or visit with ONE program\'s coaches, for the player\'s position and class: ' +
        'the coaching staff (head coach, goalkeeper coach if any), the current roster at the position by class year and how many finish before the player arrives, ' +
        'the estimated freshman openings for that class, how players at the position have stayed or moved on and how newcomers arrived, ' +
        'the recruiting style, the last two seasons\' results, and campus facts (graduation rate, average SAT, admission rate, net price, size). ' +
        'Use it for "prepare me for a call with X", "what should I ask the X coach", the Prepare for a call button.',
      inputSchema: z.object({
        ...SCHOOL_INPUT,
        position: z.enum(['GK', 'D', 'M', 'F']).describe('The player\'s position'),
        hs_class: z.number().int().optional().describe('High-school graduating class, e.g. 2028'),
      }),
      execute: run('call_prep_facts', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const s = p.s
        const ref = await refData(db)
        const f = ref.facts.get(s.id) || null
        const [co, ros, hist, outlook, style, res, awardsMap] = await Promise.all([
          db.from('coaches').select('first_name, last_name, title').eq('school_id', s.id).eq('is_active', true),
          db.from('college_rosters').select('roster_season, class_year').eq('school_id', s.id).eq('position', a.position)
            .eq('is_active', true).order('roster_season', { ascending: false }).limit(60),
          db.from('program_position_retention').select('*').eq('school_id', s.id).eq('position', a.position).maybeSingle(),
          a.hs_class
            ? db.from('program_openings_outlook').select('school_id,entry_season,position,current_season,graduating,continuing,early_rate,transitions,fresh_share,est_spots,est_freshman')
              .eq('school_id', s.id).eq('position', a.position).eq('entry_season', a.hs_class).maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          db.from('program_recruiting_style').select('*').eq('school_id', s.id).maybeSingle(),
          db.from('program_results').select('season, wins, losses, ties, conf_wins, conf_losses, conf_ties, rpi_rank')
            .eq('school_id', s.id).order('season', { ascending: false }).limit(2),
          awardsData(db).catch(() => null),
        ])
        if (co.error) throw new Error(co.error.message)
        const staff = (co.data || []).map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), title: c.title }))
        let roster = null
        if (ros.data?.length) {
          const latest = ros.data[0].roster_season
          const now = ros.data.filter(r => r.roster_season === latest)
          const byClass = {}
          for (const r of now) byClass[r.class_year || 'unknown'] = (byClass[r.class_year || 'unknown'] || 0) + 1
          roster = { roster_season: latest, players: now.length, by_class_year: byClass }
          // Who is still there in the player's freshman fall (fall of hs_class):
          // a freshman in fall S plays through fall S+3, a sophomore S+2, a junior
          // S+1, a senior S. Before early departures and redshirt years.
          if (a.hs_class) {
            const lastFall = { FR: 3, SO: 2, JR: 1, SR: 0 }
            const nextYear = { FR: 'sophomore', SO: 'junior', JR: 'senior' }
            const words = { FR: 'freshman', SO: 'sophomore', JR: 'junior', SR: 'senior', GR: 'graduate student' }
            const gap = a.hs_class - latest
            const stay = []
            let gone = 0
            for (const [cls, n] of Object.entries(byClass)) {
              const left = lastFall[cls]
              if (left == null) { gone += cls === 'GR' ? n : 0; continue }
              if (left >= gap) {
                const yearsOn = gap
                const asWhat = yearsOn === 0 ? words[cls] : (yearsOn === 1 ? nextYear[cls] : yearsOn === 2 ? (cls === 'FR' ? 'junior' : 'senior') : 'senior')
                stay.push(`${n} now ${n === 1 ? 'a ' + words[cls] : words[cls] + 's'} (would be ${n === 1 ? 'a ' + asWhat : asWhat + 's'})`)
              } else gone += n
            }
            roster.when_you_arrive = {
              fall: a.hs_class,
              still_there: stay.length ? stay.join('; ') : 'none of the current players at this position',
              finished_before_you_arrive: gone,
              note: 'From class years alone: before early departures, transfers in or redshirt years.',
            }
          }
        }
        const h = hist.data
        const o = outlook.data
        return {
          program: { ...programHead(s), city: s.city, state: s.state },
          position: a.position, hs_class: a.hs_class ?? null,
          staff,
          goalkeeper_coach: a.position === 'GK' ? (staff.filter(c => GK_TITLE.test(c.title || '')).map(c => c.name)[0] || 'none listed') : undefined,
          position_roster: roster,
          openings_for_class: o ? {
            est_freshman_openings: round(o.est_freshman), est_total_openings: round(o.est_spots),
            finishing_before_entry: o.graduating, roster_season: o.current_season,
            in_words: reasons(o, a.position, a.hs_class),
          } : (a.hs_class ? 'no openings estimate for this class' : 'no class given'),
          position_history: h ? {
            seasons: `${h.first_season} to ${h.last_season}`, players_followed: h.on_roster, returned: h.returned,
            transferred_to_another_college: h.transferred_out, left_after_final_year: h.left_after_final_year, left_otherwise: h.left_otherwise,
            newcomers: { freshmen: h.arrived_as_freshmen, transfers_in: h.arrived_by_transfer, other: h.arrived_other },
            newcomers_in_words: `Of ${h.arrived_as_freshmen + h.arrived_by_transfer + h.arrived_other} newcomers at this position, ${h.arrived_as_freshmen} arrived as ${h.arrived_as_freshmen === 1 ? 'a freshman' : 'freshmen'}, ${h.arrived_by_transfer} by transfer` + (h.arrived_other ? ` and ${h.arrived_other} otherwise` : ''),
          } : null,
          recruiting_style: styleReason(style.data, s.division) || null,
          recent_seasons: res.data || [],
          campus: f ? {
            graduation_rate: f.graduation_rate ?? null, sat_average: f.sat_average ?? null, admission_rate: f.admission_rate ?? null,
            avg_net_price: f.avg_net_price ?? null, undergrads: f.undergrad_enrollment ?? null, type: controlLabel(f.control),
            median_earnings_10yr: f.median_earnings_10yr ?? null, median_debt: f.median_debt ?? null,
            action_awards: awardsView(awardsMap, ref.unitOf.get(s.id)),
          } : null,
          note: 'Openings are estimates; incoming commits are not known. Position counts are pooled across seasons, never individual players; traced transfers are minimums.',
        }
      }),
    }),

    program_position_history: tool({
      description: 'How one program\'s players at a POSITION (default GK, goalkeepers) have stayed or moved on, pooled over its last few ' +
        'roster seasons: how many returned the next season, transferred to another college (traced), left after their final year, or left otherwise, ' +
        'and how newcomers at that position arrived (freshmen, transfers, other). Also the current roster at that position by class year. ' +
        'Use for "do goalkeepers stay or transfer at X", "how many keepers does X carry", "does X recruit freshman goalkeepers".',
      inputSchema: z.object({ ...SCHOOL_INPUT, position: z.enum(['GK', 'D', 'M', 'F']).optional().describe('Default GK') }),
      execute: run('program_position_history', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id
        const position = a.position || 'GK'
        const [hist, cur] = await Promise.all([
          db.from('program_position_retention').select('*').eq('school_id', school_id).eq('position', position).maybeSingle(),
          db.from('college_rosters').select('roster_season, class_year').eq('school_id', school_id).eq('position', position)
            .eq('is_active', true).order('roster_season', { ascending: false }).limit(60),
        ])
        if (hist.error) throw new Error(hist.error.message)
        const latest = cur.data?.[0]?.roster_season ?? null
        const now = (cur.data || []).filter(r => r.roster_season === latest)
        const byClass = {}
        for (const r of now) byClass[r.class_year || 'unknown'] = (byClass[r.class_year || 'unknown'] || 0) + 1
        const h = hist.data
        return {
          program: programHead(p.s), position,
          current_roster: latest == null ? null : { roster_season: latest, players: now.length, by_class_year: byClass },
          history: h ? {
            seasons: `${h.first_season} to ${h.last_season}`, season_pairs: h.season_pairs,
            players_followed: h.on_roster, returned: h.returned, transferred_to_another_college: h.transferred_out,
            left_after_final_year: h.left_after_final_year, left_otherwise: h.left_otherwise,
            newcomers: { freshmen: h.arrived_as_freshmen, transfers_in: h.arrived_by_transfer, other: h.arrived_other },
          } : null,
          note: 'Counts pooled across seasons, never individual players. Transfers count only moves PitchSide could trace between two college rosters, so they are minimums; "left otherwise" includes players who stopped playing or moved somewhere PitchSide does not track.',
        }
      }),
    }),

    program_profile: tool({
      description: 'Profile facts for one program: location and division, recruiting style (freshmen vs transfers, in-state reach, ' +
        'international share, roster stability, each read against similar programs), expected early-departure rate, ' +
        'and campus facts from the U.S. College Scorecard (undergraduates, average net price, admission rate, average SAT, graduation rate), ' +
        'plus any campus visit or other action award the college publishes (action_awards). ' +
        'Pass "near" (the family\'s town and state, or ZIP) to get distance_miles from home.',
      inputSchema: z.object({ ...SCHOOL_INPUT, near: z.string().optional().describe('A town with its state or a ZIP code; adds distance_miles') }),
      execute: run('program_profile', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const school_id = p.s.id
        let distance = null
        if (a.near) {
          const loc = await locate(db, a.near)
          if (loc.point) {
            const pt = (await programPointsFor(db, await refData(db))).get(school_id)
            if (pt) distance = { distance_miles: Math.round(milesBetween(loc.point, pt)), from: loc.point.name, note: 'Straight-line miles; driving distance is longer.' }
          }
        }
        const [s, style, dep, link, awardsMap] = await Promise.all([
          db.from('schools').select('school, program_gender, division, conference, city, state').eq('id', school_id).maybeSingle(),
          db.from('program_recruiting_style').select('build_band, reach_band, abroad_band, stability_band').eq('school_id', school_id).maybeSingle(),
          db.from('program_departure_outlook').select('outlook_rate, transitions, basis').eq('school_id', school_id).maybeSingle(),
          db.from('school_federal_college').select('unitid, college_facts(federal_name, undergrad_enrollment, avg_net_price, cost_of_attendance, admission_rate, sat_average, graduation_rate, locale, control, median_earnings_10yr, median_debt, median_debt_monthly)')
            .eq('school_id', school_id).maybeSingle(),
          awardsData(db).catch(() => null),
        ])
        if (!s.data) return { error: 'No program with that id.' }
        return {
          program: { school_id, ...s.data },
          recruiting_style: style.data ? {
            builds_with: { low: 'mostly freshmen', typical: 'a typical mix', high: 'more transfers than peers' }[style.data.build_band] || null,
            in_state_reach: style.data.reach_band, international_share: style.data.abroad_band, roster_stability: style.data.stability_band,
            note: 'Bands are low / typical / high against similar programs.',
          } : null,
          expected_early_departure_rate: dep.data ? { rate: round(dep.data.outlook_rate, 3), seasons_tracked: dep.data.transitions, basis: dep.data.basis } : null,
          college_facts: link.data?.college_facts || null,
          action_awards: link.data?.unitid != null ? awardsView(awardsMap, link.data.unitid) : undefined,
          distance: distance || undefined,
        }
      }),
    }),

    similar_programs: tool({
      description: 'Programs like one the family already likes ("more like this", "schools like Dayton", "other schools in the same conference"): ' +
        'the same division and men\'s / women\'s program, scored on the same conference, similar average SAT and admission rate, size, net price, ' +
        'public or private, setting and distance from that campus. Each comes with its reasons.',
      inputSchema: z.object(SCHOOL_INPUT),
      execute: run('similar_programs', async (a) => {
        const p = await pickSchool(db, a)
        if (p.result) return p.result
        const ref = await refData(db)
        const list = similarPrograms(p.s, ref.facts.get(p.s.id) || null, ref.schools, ref.facts, MAX_ROWS)
        return {
          like: { ...programHead(p.s), state: stateAbbr(p.s.state) },
          matched: list.length,
          note: list.length ? 'Ranked by how many ways each program is like it; reasons in "why".' : 'No similar programs found in the same division.',
          programs: list.map(x => ({ ...x, state: stateAbbr(x.state), card: { value: x.distance_miles != null ? `${x.distance_miles} mi` : '—', label: 'from it' } })),
        }
      }),
    }),

    action_awards: tool({
      description: 'Small awards colleges publish on their own websites for an ACTION a family can take: a campus visit (visit grants), filing the FAFSA, ' +
        'a referral, applying by a date, or attending an event, with the amount, what to do, the deadline (and whether it has passed) and the official page. ' +
        `Checked so far: ${AWARDS_SCOPE}; any other college comes back as not checked yet. ` +
        'Use for "which colleges pay me to visit", "visit grants", "money for visiting campus", "FAFSA grant", "award deadlines", and for the programs on the family\'s list.',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']).optional().describe('M = men\'s program, W = women\'s program'),
        schools: z.array(z.string()).optional().describe('College names or school_ids from the conversation (their list). Leave out to list every checked college with an award'),
        states: z.array(z.string()).optional().describe('Two-letter state codes to keep, e.g. ["OH"]'),
        divisions: z.array(z.enum(DIVISIONS)).optional(),
        types: z.array(z.enum(['visit', 'fafsa', 'referral', 'apply_by', 'event'])).optional().describe('Kinds of award to keep; default all'),
      }),
      execute: run('action_awards', async (a) => {
        const [ref, awards] = await Promise.all([refData(db), awardsData(db)])
        const today = new Date().toISOString().slice(0, 10)
        const types = a.types?.length ? a.types : null
        const byList = !!a.schools?.length
        let picked = []
        const unmatched = []
        if (byList) {
          for (const name of a.schools.slice(0, 12)) {
            let hit = ref.byId.has(name) ? [ref.byId.get(name)] : matchSchools(ref, name, a.gender)
            if (hit.length > 1) {
              const flagship = hit.filter(h => norm(h.school) === `university of ${norm(name)}`)
              if (flagship.length === 1) hit = flagship
            }
            if (!hit.length) { unmatched.push(name); continue }
            picked.push(...hit.slice(0, 2))
          }
        } else {
          const sts = a.states?.length ? new Set(a.states.map(x => x.toUpperCase())) : null
          const divs = a.divisions?.length ? new Set(a.divisions) : null
          picked = ref.schools.filter(s => (!a.gender || s.program_gender === a.gender) &&
            (!sts || sts.has(stateAbbr(s.state))) && (!divs || divs.has(s.division)) && awards.has(ref.unitOf.get(s.id)))
        }
        const seen = new Set(), notChecked = [], programs = []
        for (const s of picked) {
          const unit = ref.unitOf.get(s.id)
          // Without a gender, one program per college (the awards are the college's).
          const key = a.gender || byList ? s.id : `u${unit ?? s.id}`
          if (seen.has(key)) continue
          seen.add(key)
          const c = collegeAwards(awards.get(unit), today, types)
          if (!c.checked) { notChecked.push(s.school); continue }
          if (!byList && c.nothing_published) continue
          const top = c.awards[0]
          programs.push({
            school_id: s.id, school: s.school, gender: s.program_gender, division: s.division, conference: s.conference, state: stateAbbr(s.state),
            checked_on: c.checked_on,
            nothing_published: c.nothing_published || undefined,
            awards: c.awards.map(awardOut),
            card: top ? { value: cardValue(top), label: (TYPE_LABEL[top.type] || 'award').toLowerCase() } : { value: '—', label: 'none published' },
            _awards: c.awards,
            _top: top ? (top.per_year === false ? (top.amount || 0) / 4 : top.amount || 0) : -1,
          })
        }
        if (!byList) programs.sort((x, y) => y._top - x._top || String(x.school).localeCompare(String(y.school)))
        const upcoming = upcomingDeadlines(programs.map(p => ({ school: p.school, awards: p._awards })), today)
        for (const p of programs) { delete p._awards; delete p._top }
        const withAwards = programs.filter(p => !p.nothing_published).length
        const kind = types?.length === 1 ? (TYPE_LABEL[types[0]] || 'award').toLowerCase() : 'visit or action award'
        return {
          checked_so_far: AWARDS_SCOPE,
          count_line: byList
            ? `Of the ${programs.length} ${programs.length === 1 ? 'program' : 'programs'} asked about that PitchSide has checked, ${withAwards} ${withAwards === 1 ? 'publishes' : 'publish'} a ${kind}`
            : `${withAwards} ${withAwards === 1 ? 'program publishes' : 'programs publish'} a ${kind} on the college's own website`,
          matched: programs.length,
          with_awards: withAwards,
          upcoming_deadlines: upcoming.length ? upcoming.map(u => ({ school: u.school, award: u.name, amount: u.amount_text, deadline: u.deadline_text, days_left: u.days_left })) : undefined,
          not_checked_yet: notChecked.length ? notChecked : undefined,
          no_program_matched: unmatched.length ? unmatched : undefined,
          note: AWARDS_NOTE,
          programs: programs.slice(0, MAX_ROWS),
        }
      }),
    }),

    college_soccer_facts: tool({
      description: 'Dated, sourced college soccer facts PitchSide may quote: official NCAA program counts by division (2025-26), Division I scholarship and roster-limit rules from 2025-26, ' +
        'Division II scholarship limits, Division III aid, the share of athletes who get athletic aid, and the odds of playing in college. ' +
        'Use for "how many scholarships", "are there scholarship limits", "how many NCAA programs are there", "what are the odds of playing in college".',
      inputSchema: z.object({}),
      execute: run('college_soccer_facts', async () => soccerFacts()),
    }),

    division_facts: tool({
      description: 'Live counts and typical rosters from PitchSide\'s own data: how many active programs there are by division and men\'s / women\'s, ' +
        'and for the latest roster season the typical (median) roster size, goalkeepers per roster, and international and in-state shares per program. ' +
        'Use for "how many D1 women\'s programs are there", "how big are D2 rosters", "how many keepers do D3 teams carry", "how international is men\'s D1".',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']).optional(),
        division: z.enum(DIVISIONS).optional(),
      }),
      execute: run('division_facts', async ({ gender, division }) => {
        const ref = await refData(db)
        const counts = {}
        for (const x of ref.schools) {
          if (gender && x.program_gender !== gender) continue
          if (division && x.division !== division) continue
          const k = `${x.division || 'Unknown'} ${x.program_gender === 'M' ? 'men' : 'women'}`
          counts[k] = (counts[k] || 0) + 1
        }
        const top = await db.from('program_benchmarks').select('roster_season').eq('conference', 'ALL')
          .order('roster_season', { ascending: false }).limit(1)
        const season = top.data?.[0]?.roster_season ?? null
        let typical = []
        if (season != null) {
          let q = db.from('program_benchmarks').select('division,program_gender,dimension,bucket,metric,n,median,p25,p75,mean')
            .eq('conference', 'ALL').eq('roster_season', season)
          if (gender) q = q.eq('program_gender', gender)
          if (division) q = q.eq('division', division)
          const { data, error } = await q.limit(5000)
          if (error) throw new Error(error.message)
          const by = new Map()
          const want = r => (r.dimension === 'overall' && r.metric === 'roster_size') || (r.dimension === 'position' && r.bucket === 'GK' && r.metric === 'count') ||
            (r.dimension === 'origin' && ['international', 'in_state'].includes(r.bucket))
          for (const r of data || []) {
            if (!want(r)) continue
            const k = `${r.division}|${r.program_gender}`
            if (!by.has(k)) by.set(k, { division: r.division, program: r.program_gender === 'M' ? 'men' : 'women', programs_measured: null })
            const o = by.get(k)
            const pct = v => (v == null ? null : Math.round(Number(v) * 100))
            if (r.metric === 'roster_size') { o.roster_size_median = round(r.median, 0); o.roster_size_middle_half = `${round(r.p25, 0)} to ${round(r.p75, 0)}`; o.programs_measured = r.n }
            else if (r.dimension === 'position') o.goalkeepers_per_roster_median = round(r.median, 0)
            else if (r.bucket === 'international' && r.metric === 'share') { o.international_share_median_pct = pct(r.median); o.international_share_average_pct = pct(r.mean) }
            else if (r.bucket === 'international' && r.metric === 'count') o.international_players_median = round(r.median, 0)
            else if (r.bucket === 'in_state' && r.metric === 'share') o.in_state_share_median_pct = pct(r.median)
          }
          typical = [...by.values()].sort((x, y) => String(x.division).localeCompare(String(y.division)) || x.program.localeCompare(y.program))
        }
        return {
          active_programs: counts,
          roster_season: season,
          typical_rosters: typical,
          note: 'Counts are the active programs PitchSide tracks (NCAA D1 to D3, NAIA and junior colleges). Roster figures are per program for the latest roster season: the median program, the middle half, and for international share also the average across programs. Official NCAA counts and scholarship rules: college_soccer_facts.',
        }
      }),
    }),

    recruiting_year: tool({
      description: 'Where a player is in the recruiting process by graduating class (for example "junior year"), the steps for this year, what comes next, ' +
        'the key NCAA soccer dates for that class (with whether each has passed), typical commitment timing, and the source line to quote. ' +
        'Use for "what should we be doing now", "what is the recruiting timeline", "when can coaches contact her", and with the quick quiz.',
      inputSchema: z.object({
        hs_class: z.number().int().describe('High-school graduating class, e.g. 2028'),
        gender: z.enum(['M', 'W']).optional(),
      }),
      execute: run('recruiting_year', async ({ hs_class, gender }) => recruitingYear(hs_class, gender || null)),
    }),

    event_invite_facts: tool({
      description: 'For inviting college coaches to watch the family\'s club team at an upcoming event: picks the event (from the team\'s upcoming games and the club\'s upcoming events), ' +
        'lists the team\'s games there (date, kickoff, opponent), and ranks the college programs worth inviting: those whose coaches were logged at an earlier edition of the same event ' +
        'and those whose coaches have watched this team. Uses the team the person has starred unless a team is named. ' +
        'Use for "who should I invite to the Florida showcase", "which coaches should I invite", and for the schedule in an invite email.',
      inputSchema: z.object({
        event: z.string().optional().describe('Event words as the person wrote them, e.g. "Florida", "the North Carolina showcase"; leave out to use the next showcase'),
        team: z.string().optional().describe('Club team name, e.g. "U17 Girls ECNL" or a birth year "2010 girls"; leave out for their starred team'),
        school: z.string().optional().describe('Only this college (for an invite email\'s schedule)'),
      }),
      execute: run('event_invite_facts', async ({ event, team, school }) => {
        const today = new Date().toISOString().slice(0, 10)
        const [teams, seasonsRes, events] = await Promise.all([
          allRows(() => db.from('teams').select('id,name,gender,season_id,program_id,active,age_groups(name)').order('id')),
          db.from('seasons').select('id,name,start_date,is_active'),
          allRows(() => db.from('events').select('id,event_name,start_date,end_date,location,season_id').order('id')),
        ])
        const seasons = seasonsRes.data || []
        const active = seasons.find(x => x.is_active) || null
        const seasonName = new Map(seasons.map(x => [String(x.id), x.name]))
        const current = teams.filter(t => active && String(t.season_id) === String(active.id) && t.active !== false)
        // The team: named, else the starred team (or its current-season successor).
        let chosen = null
        if (team) {
          const tok = x => norm(x).replace(/\bu\s+(\d{1,2})\b/g, 'u$1').split(' ').filter(Boolean)
            .map(w => ({ girl: 'girls', women: 'girls', womens: 'girls', boy: 'boys', men: 'boys', mens: 'boys' }[w] || w))
          const vocab = new Set(current.flatMap(t => tok(t.name)))
          const words = tok(team).filter(w => vocab.has(w))
          const cand = words.length ? current.filter(t => { const n = tok(t.name); return words.every(w => n.includes(w)) }) : []
          // An exact name ("U17 Girls ECNL") wins over a longer one that contains it ("U17 Girls ECNL RL").
          const exact = cand.filter(t => tok(t.name).length === words.length)
          chosen = cand.length === 1 ? cand[0] : exact.length === 1 ? exact[0] : null
          if (!chosen) return { programs: [], note: `Ask which club team they mean.`, team_choices: (cand.length ? cand : current).map(t => t.name).slice(0, 20) }
        } else {
          const id = defaultTeamId(current, (ctx.favoriteTeamIds || []).map(String), teams, seasons)
          chosen = current.find(t => String(t.id) === String(id)) || null
          if (!chosen) return { programs: [], note: 'No starred team. Ask which club team they mean (they can also star their team on its page in PitchSide).', team_choices: current.map(t => t.name).slice(0, 20) }
        }
        const gender = teamProgramGender(chosen.gender)
        // Upcoming: the team's games from today, by event; plus the club's upcoming events with no games for it yet.
        const { data: upGames, error: ge } = await db.from('games').select('id,event_id,game_date,game_time,timezone,opponent')
          .eq('team_id', chosen.id).gte('game_date', today).order('game_date').order('game_time').limit(200)
        if (ge) throw new Error(ge.message)
        const byEvent = new Map()
        for (const g of upGames || []) { if (!byEvent.has(g.event_id)) byEvent.set(g.event_id, []); byEvent.get(g.event_id).push(g) }
        const evById = new Map(events.map(e => [e.id, e]))
        const upcoming = [...byEvent.keys()].map(id => evById.get(id)).filter(Boolean)
        for (const e of events) {
          if (e.start_date >= today && active && String(e.season_id) === String(active.id) && !byEvent.has(e.id)) upcoming.push(e)
        }
        upcoming.sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
        const pick = pickEvent(upcoming.map(e => ({ ...e, team_games: (byEvent.get(e.id) || []).length })), event)
        const describe = e => ({ event: e.event_name, dates: `${e.start_date} to ${e.end_date}`, location: e.location || undefined,
          team_games_scheduled: (byEvent.get(e.id) || []).length })
        if (!pick.event) {
          return {
            team: chosen.name, programs: [],
            note: pick.choices.length ? 'Ask which event they mean, offering these.' : 'No upcoming events or games are in PitchSide for this team yet.',
            event_choices: pick.choices.slice(0, 10).map(describe),
          }
        }
        const ev = pick.event
        const mineAll = byEvent.get(ev.id) || []
        const games = (isShowcase(ev) ? mineAll : mineAll.slice(0, 3)).map(g => gameLine(g))
        // Earlier editions of the event, and their games for teams of the same gender.
        const key = eventKey(ev.event_name)
        const since = `${Number(today.slice(0, 4)) - 3}${today.slice(4)}`
        const past = events.filter(e => e.id !== ev.id && e.start_date < today && e.start_date >= since && eventKey(e.event_name) === key)
        const teamGender = new Map(teams.map(t => [t.id, teamProgramGender(t.gender)]))
        let pastRows = []
        if (past.length) {
          const pg = await allRows(() => db.from('games').select('id,team_id,event_id').in('event_id', past.map(e => e.id)).order('id'))
          const keepGames = pg.filter(g => teamGender.get(g.team_id) === gender)
          const seasonOfGame = new Map(keepGames.map(g => [g.id, seasonName.get(String(evById.get(g.event_id)?.season_id)) || null]))
          const ids = keepGames.map(g => g.id)
          for (let i = 0; i < ids.length; i += 200) {
            const chunk = ids.slice(i, i + 200)
            const rows = await allRows(() => db.from('attendance')
              .select('id,coach_id,game_id,coaches!inner(school_id,first_name,last_name,title,is_active)').in('game_id', chunk).order('id'))
            pastRows = pastRows.concat(rows.map(r => ({ ...r, season: seasonOfGame.get(r.game_id) })))
          }
        }
        const line = lineage(chosen, teams, seasons).map(l => l.team.id)
        const teamRows = await allRows(() => db.from('attendance')
          .select('id,coach_id,game_id,coaches!inner(school_id,first_name,last_name,title,is_active),games!inner(team_id)')
          .in('games.team_id', line).order('id'))
        const ref = await refData(db)
        let list = inviteList(pastRows, teamRows, ref.byId, gender)
        if (school) {
          const only = new Set(matchSchools(ref, school, gender).map(x => x.id))
          list = list.filter(x => only.has(x.school_id))
        }
        return {
          team: chosen.name,
          event: { name: ev.event_name, dates: `${ev.start_date} to ${ev.end_date}`, location: ev.location || null,
            earlier_editions_logged: [...new Set(past.map(e => seasonName.get(String(e.season_id)) || e.start_date))] },
          games: games.length ? games : undefined,
          games_note: games.length ? (isShowcase(ev) ? undefined : 'A season-long league: the next three games.') : 'The team\'s games at this event are not in PitchSide yet.',
          other_upcoming_events: upcoming.filter(e => e.id !== ev.id).slice(0, 5).map(describe),
          matched: list.length,
          note: list.length ? undefined : 'No college coaches are logged at earlier editions of this event or at this team\'s games yet.',
          programs: list.slice(0, MAX_ROWS).map(x => ({
            ...x, state: stateAbbr(x.state), event_name: ev.event_name,
            thank_line: x.watched_your_team ? `Thank ${x.watched_your_team.coaches[0]} for coming to watch the team before.` : undefined,
            card: x.watched_your_team ? { value: x.watched_your_team.games, label: x.watched_your_team.games === 1 ? 'game of yours' : 'games of yours' }
              : { value: x.at_event_before.coaches.length, label: x.at_event_before.coaches.length === 1 ? 'coach at event' : 'coaches at event' },
          })),
        }
      }),
    }),

    programs_watching_team: tool({
      description: 'Which college programs\' coaches have attended a club team\'s games, logged in PitchSide (the family\'s own club data), ' +
        'and WHICH coaches: each program lists coaches_seen with each coach\'s name, title, games attended and latest game. ' +
        'With no team given it uses the team the person has starred in PitchSide, including that team\'s earlier seasons. ' +
        'Give "school" to see only one college\'s coaches (e.g. "which Iowa coaches came").',
      inputSchema: z.object({
        team: z.string().optional().describe('Club team name as the person wrote it, e.g. "2009 Girls ECNL"; leave out for their starred team'),
        school: z.string().optional().describe('Only this college (name as written, typos fine)'),
      }),
      execute: run('programs_watching_team', async ({ team, school }) => {
        const [teams, seasonsRes, att] = await Promise.all([
          allRows(() => db.from('teams').select('id,name,gender,season_id,program_id,active,age_groups(name)').order('id')),
          db.from('seasons').select('id,name,start_date,is_active'),
          allRows(() => db.from('attendance')
            .select('id,coach_id,game_id,coaches!inner(school_id,first_name,last_name,title,is_active),games!inner(team_id,game_date)').order('id')),
        ])
        const seasons = seasonsRes.data || []
        const active = seasons.find(s => s.is_active) || null
        const current = teams.filter(t => active && String(t.season_id) === String(active.id))
        const lineIds = t => lineage(t, teams, seasons).map(l => String(l.team.id))
        // Teams move up an age group every season; the birth year stays with the players.
        // Season starting in Y (e.g. Aug 2026) ends in Y+1, and U17 that season = born (Y+1)-17.
        const seasonById = new Map(seasons.map(x => [String(x.id), x]))
        const birthYear = t => {
          const y = Number(String(seasonById.get(String(t.season_id))?.start_date || '').slice(0, 4)), age = teamAge(t)
          return y && age ? y + 1 - age : null
        }
        const label = t => (birthYear(t) ? `${t.name} (${birthYear(t)}s)` : t.name)
        // Every current team that has college coaches logged at its games (this season or its earlier seasons).
        const gamesOf = ids => new Set(att.filter(r => ids.includes(String(r.games?.team_id))).map(r => r.game_id)).size
        const plural = n => `${n} ${n === 1 ? 'game' : 'games'}`
        const visited = current.map(t => ({ t, games: gamesOf(lineIds(t)) }))
          .filter(x => x.games > 0).sort((a, b) => b.games - a.games)
          .map(x => {
            const parts = lineage(x.t, teams, seasons)
              .map(l => ({ n: gamesOf([String(l.team.id)]), season: l.season?.name, team: l.team.name }))
              .filter(p => p.n > 0).map(p => `${plural(p.n)} in ${p.season} as ${p.team}`)
            return `${label(x.t)}: ${plural(x.games)} with college coaches logged (${parts.join('; ')})`
          })
        const allNames = current.map(label).slice(0, 40)

        let chosen = null
        if (team) {
          // Keep only the words that appear in some team name, so club names and
          // filler ("Ohio Premier", "team", "play") do not block a match.
          const tok = x => norm(x).replace(/\bu\s+(\d{1,2})\b/g, 'u$1').split(' ').filter(Boolean)
            .map(w => ({ girl: 'girls', women: 'girls', womens: 'girls', boy: 'boys', men: 'boys', mens: 'boys' }[w] || w))
          const vocab = new Set(teams.flatMap(t => tok(t.name)))
          const words = tok(team).filter(w => vocab.has(w))
          // A birth year ("2010s", "2010 girls", "the '10s") picks the current team those players are on.
          const ym = String(team).match(/\b(20[0-2]\d)s?\b/) || String(team).match(/['’](\d\d)s?\b/)
          const by = ym ? (ym[1].length === 2 ? 2000 + Number(ym[1]) : Number(ym[1])) : null
          let pool = current.length ? current : teams
          if (by) pool = pool.filter(t => birthYear(t) === by)
          const nameWords = t => tok(t.name).filter(w => !(by && /^u\d+$/.test(w)))
          const cand = (words.length || by) ? pool.filter(t => { const n = tok(t.name); return words.every(w => n.includes(w)) }) : []
          const exact = cand.filter(t => nameWords(t).length === words.filter(w => !(by && /^u\d+$/.test(w))).length)
          chosen = cand.length === 1 ? cand[0] : exact.length === 1 ? exact[0] : null
          if (!chosen) {
            return {
              programs: [],
              note: cand.length > 1
                ? `Several club teams match "${team}". Ask which one, offering these options.`
                : `No club team matched "${team}". Team names in PitchSide are age group + gender + league (e.g. "U16 Girls ECNL"), not the club name.`,
              matching_teams: cand.map(label).slice(0, 12),
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
        const chain = lineage(chosen, teams, seasons)
        const line = chain.map(l => String(l.team.id))
        const mine = att.filter(r => line.includes(String(r.games?.team_id)))
        const sig = summarizeAttendance(mine)
        // Who came: per program, each coach with the games they attended.
        const who = new Map()
        for (const r of mine) {
          const sid = r.coaches?.school_id
          if (!sid || r.coach_id == null) continue
          let m = who.get(sid); if (!m) who.set(sid, (m = new Map()))
          // One person can have two coach records at a school (an old inactive
          // row and a current one); merge them by name so they show once.
          const name = `${r.coaches.first_name || ''} ${r.coaches.last_name || ''}`.trim() || null
          const key = name ? norm(name) : 'id:' + r.coach_id
          const onStaff = r.coaches.is_active !== false
          let c = m.get(key)
          if (!c) m.set(key, (c = { name, title: r.coaches.title || null, still_on_staff: onStaff, games: new Set(), latest: null }))
          else if (onStaff && !c.still_on_staff) { c.still_on_staff = true; c.title = r.coaches.title || c.title }
          if (r.game_id != null) c.games.add(r.game_id)
          const d = r.games?.game_date || null
          if (d && (!c.latest || d > c.latest)) c.latest = d
        }
        const coachesSeen = sid => [...(who.get(sid)?.values() || [])]
          .map(c => ({ name: c.name, title: c.title, games: c.games.size, latest: c.latest, still_on_staff: c.still_on_staff ? undefined : false }))
          .sort((a, b) => b.games - a.games || String(a.name).localeCompare(String(b.name)))
        const bySeason = chain.map(l => ({ season: l.season?.name || null, team: l.team.name, games_with_coaches: gamesOf([String(l.team.id)]) }))
        const ref = await refData(db)
        let only = null
        if (school) {
          only = new Set(matchSchools(ref, school, teamProgramGender(chosen.gender)).map(x => x.id))
          if (!only.size) return { team: chosen.name, birth_year: birthYear(chosen) ?? undefined, programs: [], note: `No program matched "${school}".` }
        }
        const list = [...sig.entries()].map(([sid, v]) => ({ sid, v, s: ref.byId.get(sid) }))
          .filter(x => x.s && (!only || only.has(x.sid)))
          .sort((x, y) => y.v.games - x.v.games || String(y.v.latest || '').localeCompare(String(x.v.latest || '')))
        return {
          team: chosen.name,
          current_season: active?.name ?? undefined,
          birth_year: birthYear(chosen) ?? undefined,
          seasons: bySeason,
          seasons_note: 'Teams move up an age group each season. The visits include the same players\' earlier seasons, listed in "seasons" with the team name they had then.',
          matched: list.length,
          showing: list.length > MAX_ROWS ? `the ${MAX_ROWS} programs with the most games watched, of ${list.length} in all` : undefined,
          note: list.length ? undefined : only ? `No coaches from "${school}" are logged at this team's games.`
            : 'No college coaches logged at this team\'s games yet. Mention the teams_with_coach_visits if any.',
          teams_with_coach_visits: list.length || only ? undefined : visited,
          programs: list.slice(0, MAX_ROWS).map(({ sid, v, s }) => ({
            school_id: sid, school: s.school, gender: s.program_gender, division: s.division, conference: s.conference, state: stateAbbr(s.state),
            coaches: v.coaches, games: v.games, latest: v.latest, coaches_seen: coachesSeen(sid),
            card: { value: v.games, label: v.games === 1 ? 'game watched' : 'games watched' },
          })),
        }
      }),
    }),
  }
}

// ── the instructions every model gets ───────────────────────────────────────
// ACT composite to SAT total, from the 2018 ACT/SAT concordance tables.
const ACT_TO_SAT = '36=1590, 35=1540, 34=1500, 33=1460, 32=1430, 31=1400, 30=1370, 29=1340, 28=1310, 27=1280, 26=1240, 25=1210, ' +
  '24=1180, 23=1140, 22=1110, 21=1080, 20=1040, 19=1010, 18=970, 17=930, 16=890, 15=850, 14=800, 13=760, 12=710'

function instructions() {
  const today = new Date().toISOString().slice(0, 10)
  return [
    `You are Ask PitchSide, the college soccer assistant inside PitchSide's College Soccer Intelligence. Today is ${today}.`,
    'The people asking are families of club players looking at college soccer. Be warm, clear and direct.',
    '',
    'FACTS',
    '- Answer ONLY from the results of the look-up tools. Never use outside knowledge for numbers, names, records, rankings or coaches.',
    '- If the look-ups do not hold what was asked, say plainly that PitchSide does not have it, and suggest what it can answer instead. Do not guess.',
    '- The program look-ups (program_results, program_coaches, program_profile, program_transfers, program_majors) take the college name directly (school, plus gender when known); call them straight away, several at once when the question needs several. Use find_school only to search for a college, or when a look-up returns several matches. If both a men\'s and a women\'s program match and the question does not say which, answer for the one the conversation is about, or ask.',
    '- Openings are ESTIMATES (graduations, expected early departures, usual freshman intake); incoming commits are not known. Say "estimated".',
    '- Value for money ("return on investment", "earnings after college", "how much debt"): use median_earnings_10yr and median_debt from find_programs (sort earnings for the highest earnings) or program_profile; say earnings are for former students who received federal aid, 10 years after starting, and debt is federal loans of students who completed. Earnings depend heavily on the major; say so when comparing colleges.',
    '- NCAA recruiting rules: state only the key dates that recruiting_year returns, each with its source line (rules as of 2025-26; confirm in the NCAA recruiting guide for the division or with the college\'s compliance office). For any other rules question, say PitchSide does not advise on recruiting rules and point to the NCAA recruiting guide for their division and the college\'s compliance office. Do not discuss or rank individual players.',
    '- People write in every way: typos, slang ("keeper", "D1", "class of \'28", "the Buckeyes"), half sentences. Work out what they mean and use the look-ups; find_school tolerates typos and nicknames.',
    '- Openings questions need gender, position and graduating class. If any is missing and the conversation does not already say it, ask for the missing pieces in ONE short question with the likely options, and stop. Searches that do not need them (majors, academics, results) run without them.',
    '- Academic fit: use find_programs filters (admission rate, average SAT, graduation rate, net price, size, public/private, setting, major) and program_majors. PitchSide has no GPA data; say so if asked, and use admission rate and average SAT instead. A program whose average SAT is near the student\'s score is a typical academic match.',
    '- Never estimate, approximate or work out a figure yourself: not a distance, admission rate, SAT, price or openings number. If a figure you need is not in a look-up result, run the look-up now (for one program\'s distance from home: program_profile with near, or find_programs with schools). Never answer that something is "not in this conversation".',
    '- An earlier answer of yours may end with a note "[Filters used for this answer: find_programs {...}]". It is the exact search behind that answer; the reader does not see it. Never mention it.',
    '- "Why is X not on the list" or "where does X rank": run find_programs again with EXACTLY the filters in that note (same distance, SAT range, size and so on), adding only schools: [X], and explain from asked_about (rank_in_search of the total, or left_out_because). Change a filter only when the person asks for the change.',
    '- "Out of state", "not in Ohio", "away from home": pass exclude_states with the home state, and leave home-state programs out of recommendations unless they ask for them.',
    '- A message that starts "Quick quiz answers:" comes from the quick quiz and holds the whole profile. Do not ask clarifying questions: search at once with find_programs (gender, position and hs_class; near = home with radius_miles = the miles given, or no radius for "anywhere"; exclude_states with the home state for "out of state only", or states for "home state only"; divisions for the level; undergrads_min / undergrads_max for size (small under 5,000, mid-size 5,000 to 15,000, large over 15,000); type; net_price_max; the SAT range from the test score as below; major unless undecided). Pass student_sat (the SAT, or the ACT converted as below) so every program gets a Reach / Good fit / Safety label. Recommend a balanced shortlist of up to five programs: when fit_summary has them, at least one Reach, two or three Good fit and at least one Safety; give each program its label and the reason from its fit in a few words, and name the trade-offs. Also call recruiting_year with the class (and gender) at the same time as find_programs, and end the answer with a short "This year (<now>)" list of the three most useful steps from this_year, plus the next key date that has not passed, if any. "Playing early" favors programs with more estimated freshman openings and lower divisions; "highest level" favors the highest division in the list. If fewer than three programs match, relax ONE filter (the distance first, then the size), say which, and search again.',
    '- Before the FIRST list of recommendations ("which schools would be a good fit", "recommend", "best options for me"): if the conversation does not yet say how far from home they will go (or a region) AND at least one of school size, cost, or a test score, ask first: one short message with up to three questions and likely options (for example "How far from home: 2 hours, 4 hours, anywhere?"), then stop (STATUS: clarify). If they already answered, or say "just show me", search.',
    '- Academics: PitchSide has no GPA data. When academics matter and they gave only a GPA, ask for an SAT or ACT score (or a target range) in the same clarifying message. Convert an ACT composite to SAT with this table: ' + ACT_TO_SAT + '. For a typical academic match use find_programs with sat_min about 100 below and sat_max about 150 above the student\'s SAT; colleges whose average SAT is well above it are a reach, and say so.',
    '- Goalkeepers (or any position): whether players at a position stay or transfer, how many a program carries, and how newcomers arrive come from program_position_history (default GK). Whether a staff has a goalkeeper coach comes from program_coaches (goalkeeper_coach). PitchSide has no playing-time or minutes data; say so if asked.',
    '- General advice ("what should we decide first", "what matters most in choosing"): answer briefly from what PitchSide can search (distance, size, setting, public or private, cost, academics, major, openings, results, roster stability, coaches), without inventing facts, and offer to run the search (STATUS: answered).',
    '- Judgment questions ("is X a good fit", "D2 or D3", "should she…"): do not decide for them. Lay out the relevant facts side by side (results and RPI, openings, roster stability, academics, cost) and name the trade-offs to weigh.',
    '- Distance ("within 100 miles of Columbus", "near 43017", "a few hours from Pittsburgh"): find_programs with near (town and state, or ZIP) and radius_miles (default 100; about 60 miles per hour of driving). Distances are straight-line; say so. If the place may be in several states, call find_programs with it anyway: it returns the matching places, and you ask which one from that list. Never name places or states from your own knowledge. If they say "close to home" without a place, ask for their town or ZIP code.',
    '- Club teams move up an age group each season (this season\'s U17 were last season\'s U16), so families often name a team by birth year ("the 2010s"); pass that as the team. When describing a team, give its age group and birth year, and say which seasons the coach visits came from (the seasons list).',
    '- Questions about the family\'s own club team ("who has watched us", "which coaches came to our games") use programs_watching_team. PitchSide logs WHICH coaches attended: name them from coaches_seen (name, title, games attended, latest game). For each program you show, list EVERY coach in its coaches_seen, in the order given, with their games; add "(no longer on staff)" exactly when still_on_staff is false, and never otherwise. Show at most 5 programs and offer more. For one college, pass school. Never say names are not logged. If it cannot tell which team, ask which one and offer the teams it lists with coach visits logged; never say a team is missing when it is in the list returned.',
    '- Reach / Good fit / Safety: whenever the conversation gives the player\'s test score or the levels they are aiming for, pass student_sat (convert an ACT) and divisions to find_programs. Each program then has fit (label, and why: the athletic and academic reasons) and the result has fit_summary. Use only those labels and reasons; never label a program yourself. Say the labels are estimates. A balanced list has some of each (more good fits than reaches or safeties). For "is X a reach for me", run find_programs with schools: [X], student_sat and divisions, and answer from asked_about (fit).',
    `- Positions: ${POSITIONS.map(p => `${p.code}=${p.one}`).join(', ')}. Divisions: ${DIVISIONS.join(', ')}.`,
    '',
    'OUTREACH EMAILS ("draft an email to Dayton", "write to the Toledo coaches", the Draft an email button)',
    '- A first email needs four things: the player\'s name, graduating class, position, and club team (club and team or league). Look for them anywhere in the conversation, including quick quiz answers and earlier drafts, and reuse everything already given; never ask again for something already given.',
    '- If any of the four is missing, ask for the missing ones in ONE short message, and in the same message invite the optional details as a short bulleted list: hometown; high school; GPA; SAT or ACT score; height; two to four strengths as a player; upcoming events (event, dates, and field, time and jersey color and number if known) or a schedule link; highlight video link; a full-game video link with jersey color and number; high school season stats or honors; school activities or honor societies; recruiting profile link; club coach and high school coach name and email or phone, for coaches to contact; the player\'s phone number. Say any of them can be skipped. Call no look-ups, and stop (STATUS: clarify). When they reply, draft the email for the program they asked about.',
    '- With the four known: call outreach_facts (school, gender, position) and, at the same time, programs_watching_team with school. If an intended major was given, also call program_majors with search to check the college offers it.',
    '- Write the email in the PLAYER\'s voice (first person; the player sends it from their own email), plain text with no Markdown inside it, clear and concise (coaches get hundreds of emails), at most about 300 words. Sincere and specific, no flattery. Use these parts in this order, leaving out any part whose details were not given:',
    '  1. "Dear " + the greeting from outreach_facts + ",".',
    '  2. Who I am (name, position, hometown if given) and why this program, with one or two true specifics from the look-ups (conference, location, the major if program_majors shows it, a winning season or RPI rank from recent_seasons, or the roster at the position, for example a senior goalkeeper graduating, only when position_roster shows it). End this paragraph by asking whether they are looking for a <position word> in the <class> recruiting class.',
    '  3. Club team, and the strengths given.',
    '  4. Upcoming events where they can see me play (event, dates, field, time, jersey color and number), or the schedule link.',
    '  5. The highlight video link; the full-game link with jersey color and number.',
    '  6. School: high school, activities, GPA, test score, height, season stats and honors.',
    '  7. The recruiting profile link, only if given (never say anything is "available on request"); then a request to talk and learn more about the program.',
    '  8. If coach contacts were given: "If you would like to contact my coaches:" then one line per coach (role - name | email | phone).',
    '  9. Thanks, then the sign-off on separate lines: name, "<class> <position>", club team, phone number if given.',
    '- If programs_watching_team shows this program\'s coaches at the family\'s games, add one line in part 3 thanking that coach by name for coming to watch. If it finds no visit, no team, or asks which team, leave it out and do not mention it anywhere.',
    '- Never mention PitchSide, estimates, openings, transfers or other players in the email. Never mention a losing record. Never invent a statistic, date, event, link, phone number or email address. Leave out anything not given; never write blanks or [brackets].',
    '- Before the draft write exactly one sentence: "Here is a first email to <program>, addressed to <the coaches named in the greeting>." Nothing else before the draft: never mention look-ups, coach visits, a goalkeeper coach, or anything left out.',
    '- Format the draft EXACTLY like this:',
    '  ---EMAIL---',
    '  To: the email addresses in outreach_facts "to", separated by commas',
    '  Cc: the email addresses in outreach_facts "cc" (leave this line out when there are none)',
    '  Subject: <player name> | <class> <position word> | <club team>, plus " | " and one standout detail when given (GPA, test score or height), for example "Jane Smith | 2028 Goalkeeper | Ohio Premier 2010 ECNL | 3.9 GPA"',
    '  (a blank line, then the email body)',
    '  ---END EMAIL---',
    '- If outreach_facts has no email address, leave out the To and Cc lines and say PitchSide has no published email for this staff; suggest the program\'s athletics site.',
    '- After the draft, one short line: read it over and make it your own before sending. The 120-word limit below does not count the email. STATUS: answered. FOLLOW-UPS: offer drafts for other programs from the conversation ("Draft an email to Ball State").',
    '',
    'NUMBERS AND SIMILAR PROGRAMS',
    '- "How many D1 women\'s programs are there", roster sizes, goalkeepers per roster, international or in-state share by division: call division_facts and quote its figures (median and middle half as given; say "per program" for shares). For official NCAA program counts, scholarships, roster limits, athletic aid shares and the odds of playing in college, call college_soccer_facts and quote each fact with its source and date; when PitchSide\'s own count differs from the NCAA\'s, give both and say PitchSide counts the programs it tracks. Anything not in college_soccer_facts (including NAIA and junior college limits): say so and point to the NCAA, NAIA or NJCAA, or the college\'s compliance office.',
    '- "More like this", "schools like X", "other schools in the same conference": call similar_programs. The cards show the list; name the top three with their reasons in one sentence each, and offer the other tools (a shortlist with Reach / Good fit / Safety, an email, a call sheet).',
    '',
    'RECRUITING YEAR ("what should we be doing now", "what is the timeline", "when can coaches contact her")',
    '- Needs the graduating class; take it from the conversation, else ask in one short question and stop. Call recruiting_year (hs_class, gender). Answer with where they are (now), the steps for this year as a short list (this_year, in your words but adding nothing), the key dates (say which have passed), the commitment timing if given, and one line with the source. If the conversation already names programs on their list, also call action_awards with them at the same time and add each open award deadline (from upcoming_deadlines) to the key dates. Offer follow-ups PitchSide can run (a shortlist, an outreach email, an event invite list).',
    '',
    'VISIT AND ACTION AWARDS ("which colleges pay me to visit", "visit grants", "money for visiting", "FAFSA grant", "award deadlines")',
    '- Call action_awards only (not find_programs): schools = the programs named in the conversation (their shortlist) when there are any, else states, divisions and gender from the conversation; types = ["visit"] for visit questions.',
    '- Give the count exactly as count_line says it; never count programs yourself. Then list EVERY entry in upcoming_deadlines, in the order given and skipping none (the first is the most urgent; say how many days are left when under 30): the college, the amount, and the deadline in its own words; link the official page as [college page](official_page). Then the other programs with awards in one short list: amount and deadline_text (say plainly when it has passed). Then one line: these come from each college\'s own website, checked on checked_on (never say "today"); amounts and deadlines change every year, so confirm with the admissions office.',
    '- nothing_published: the college publishes no such award on its website (as of checked_on). not_checked_yet: PitchSide has not checked that college yet (so far it has checked checked_so_far); suggest asking its admissions office whether it gives a visit grant. Never say a college has no award when it was not checked.',
    '- An athletic official visit counts only when what_to_do says so; otherwise suggest asking admissions whether a visit with the coaches counts.',
    '- Grants for also considering a rival or conference school, or matching another college\'s offer: none of the colleges PitchSide has checked publishes one. Say so, and suggest asking each admissions office whether it will review offers from other colleges.',
    '- When find_programs rows carry action_awards, mention them in a few words for the programs you recommend (for example "pays $2,000 a year for a campus visit by Dec 5, 2026"). In the quick quiz, add the nearest open award deadline of a shortlisted program to the "This year" list.',
    '',
    'EVENT INVITES ("who should I invite to the Florida showcase", "which coaches should I invite to watch me", "invite coaches to my event")',
    '- Call event_invite_facts (event words, and team if they name one). If it returns event_choices or team_choices, ask which one in one short message listing them, and stop (STATUS: clarify).',
    '- Answer: one sentence with the event, its dates and the team\'s games there (the games lines exactly as given, or that the schedule is not posted yet). Then name the top three programs and each one\'s reason (why) in one sentence each; the cards show the full list, each with a Draft an invite button. Add one line of advice: invite coaches a week or two ahead with your schedule, and follow up after the event with highlights. If no programs are returned, say so and suggest inviting programs from their shortlist.',
    '- An invite email ("draft an invite to the Dayton coaches", the Draft an invite button) needs the same four details as an outreach email (name, class, position, club team); ask once for any that are missing, inviting the optional details (jersey color and number, field numbers, highlight video link, phone), and stop. With them: call outreach_facts (school, gender, position) and event_invite_facts (event, and school) at the same time.',
    '- Write the invite in the player\'s voice, plain text, at most about 180 words, in the same ---EMAIL--- format as an outreach email (To and Cc from outreach_facts). Subject: <player name> | <class> <position word> | <club team> | <event name> schedule. Body: the greeting from outreach_facts; one or two sentences on who I am and one true specific about the program; if event_invite_facts gives this program a thank_line, one sentence doing exactly that (it is required); "I will be playing at <event> (<location only if event.location is given>, <dates>)" and each game line exactly as given, adding field and jersey only if given (if the schedule is not posted, say I will send it when it is); an invitation to come watch; the highlight video link if given; thanks; sign-off (name, class and position, club team, phone if given). Never mention PitchSide, attendance logs, or that their staff was at the event before, in the email or in your note after it.',
    '',
    'CALL PREP ("prepare me for a call with Dayton", "what should I ask the Toledo coach", the Prepare for a call button)',
    '- Needs the player\'s position and graduating class; take them from anywhere in the conversation (quiz answers, earlier messages). If either is missing, ask for it in one short question and stop (STATUS: clarify).',
    '- Call call_prep_facts (school, gender, position, hs_class). Then write a call sheet, at most about 350 words, in two parts:',
    '  ### What PitchSide already knows: four to seven short bullets from the look-up only, quoting its counts and words (never work out a percentage or a class year yourself): the roster at the position by class year and, from when_you_arrive, who is still there in the player\'s freshman fall; the estimated freshman openings for the class (say estimated); how players at the position have stayed or moved on and how newcomers arrived; the recruiting style; the latest results; graduation rate and academics; the head coach, and for goalkeepers whether a goalkeeper coach is listed; any campus visit or other award in campus.action_awards with its deadline (say if it has passed). Leave out anything the look-up does not have.',
    '  ### Questions to ask: eight to twelve questions in short groups (Your position and class; Team and coaching; Academics and support; Recruiting process and next steps). Make two or three of them follow from the facts above, using when_you_arrive for who will still be there (for example, with one goalkeeper who would be a senior: "How do you see the goalkeeper group in my freshman year?"; with mostly transfer newcomers: "How many freshmen do you plan to bring in for my class?"). Never describe current players as still ahead of the player unless when_you_arrive says they will still be there. For goalkeepers include: what they look for in a goalkeeper, how many goalkeepers they are recruiting in the class, and when they expect to make offers at the position. Always include asking where the player stands in their recruiting and what the next steps are, what a typical in-season and off-season week looks like, how academics and travel are handled, and, only if the conversation names an intended major, how athletes do in that major. For NCAA D3 programs ask about merit and need-based aid instead of athletic scholarships.',
    '- End with one line: the call is a two-way interview, so take notes and ask what matters to you. No disclaimers about NCAA rules. STATUS: answered. FOLLOW-UPS: offer an email draft to the same program, a call sheet for another program, or a related look-up.',
    '',
    'FORMAT (Markdown; it is rendered for the reader)',
    '- Write nothing before or between look-ups ("I will search…"): call the look-ups first, then write only the answer.',
    '- Start with a one- or two-sentence direct answer. No preamble, no restating the question.',
    '- Then structure: short bullet lists for a few facts; **bold** for the key number or name.',
    '- LISTS of programs (find_programs, rank_by_results, programs_watching_team): the app shows them as program cards under your answer (logo, division, the key number, a link). Do NOT write a table or a numbered or bulleted list of those programs. Instead, after the direct answer, give one or two observations the cards do not show. Comparisons across the list (closest, cheapest, most selective, highest SAT or graduation rate, largest, most openings) must come word for word from the look-up\'s highlights; never work out a comparison yourself, and never call a program "among the cheapest" or similar unless a highlight says it. Exception: for programs_watching_team, the coach names are not on the cards, so list each program shown with its coaches.',
    '- TABLES only for a side-by-side comparison of 2 to 4 named programs on several measures, or one program across seasons (rows = seasons). Clear column headers, at most 6 rows.',
    '- Link every program you name to its profile: [Ohio State](/school/<school_id>), using the school_id from the look-ups. Never invent a link.',
    '- "matched" is the total. When a look-up has "showing", only part of the list came back: state the total (matched), never the number of rows shown, as the count. The cards under the answer show at most 40 programs; never say the cards hold all of a longer list, and do not comment on how many programs the cards or the list show.',
    '- find_programs lists are already ranked by estimated freshman openings (what a recruit in that class competes for); when you name the leaders, keep that order and quote the freshman figure.',
    '- Use a short ### heading only when an answer has two or more distinct parts.',
    '- End with one short line saying what the numbers are based on (for example "Based on 2026 rosters; openings are estimates.").',
    '- Write in American English ("program", not "programme"), with no em dashes. Keep the whole answer under about 120 words (an outreach email draft or a call sheet does not count).',
    '- After the answer, on its own line, write: STATUS: answered | partial | unavailable | clarify, followed by " - " and the missing topic in a few words when not fully answered (for example "STATUS: unavailable - ID camps"). The app hides this line and logs it so PitchSide can fill data gaps. Use "answered" when you answered what was asked, even if you showed only the top of a long list (showing 5 of 226 programs is "answered", not "partial"); "partial" only when the DATA could not answer part of the question (for example "STATUS: partial - incoming commits").',
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
// A "partial" whose gap is only the rest of a long list is not a data gap:
// the answer showed the top of the list and offered more.
const LIST_REMAINDER = /\b(remaining|rest of|beyond the (first|top)|more (programs|schools|colleges|teams|coaches)|next \d+|other \d+|full list|additional (programs|schools)|all \d+)\b/i
function readStatus(text) {
  const m = /^\s*\**STATUS:?\**:?\s*(answered|partial|unavailable|clarify)\b\s*(?:[-–—:|]\s*(.+))?$/im.exec(text || '')
  if (!m) return { status: null, gap: null }
  const status = m[1].toLowerCase(), gap = m[2] ? m[2].trim().slice(0, 200) : null
  if (status === 'partial' && gap && LIST_REMAINDER.test(gap)) return { status: 'answered', gap: null }
  return { status, gap }
}
// What the page shows: everything before the STATUS / FOLLOW-UPS lines.
function visibleAnswer(text) {
  const t = text || ''
  const f = /\n?[ \t]*\**FOLLOW-?UPS\b/i.exec(t)
  return (f ? t.slice(0, f.index) : t).replace(/^[ \t]*\**STATUS\b[^\n]*(\n|$)/gim, '').trim()
}
function lookupSummary(log) {
  return log.map(l => {
    const o = l.output || {}
    const rows = ['programs', 'seasons', 'coaches', 'matches', 'majors'].map(k => (Array.isArray(o[k]) ? o[k].length : null)).find(x => x != null)
    return { tool: l.tool, input: l.input, rows: rows ?? null, matched: o.matched ?? null, error: o.error || null }
  })
}
// Best effort: a logging failure must never break an answer.
// Actual AI Gateway cost of a question: every model call in it (one per step), summed.
function costOfSteps(steps) {
  let usd = 0, any = false
  for (const st of steps || []) {
    const c = Number(st?.providerMetadata?.gateway?.cost)
    if (Number.isFinite(c)) { usd += c; any = true }
  }
  return any ? Math.round(usd * 1e8) / 1e8 : null
}

async function logAsk(row) {
  try {
    const { data, error } = await adminClient().from('ask_log').insert(row).select('id').single()
    return error ? null : data?.id || null
  } catch { return null }
}

// ── handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  // Who is asking: the owner (signed in, super_admin) or a pilot (a code from
  // a pilot link, in the X-Ask-Pilot header; server/ask/pilots.js).
  const owner = await checkOwner(req)
  let who = owner.ok ? { kind: 'owner', email: owner.email } : null
  if (!who && req.headers[PILOT_HEADER]) {
    const pilot = await findPilot(adminClient(), req.headers[PILOT_HEADER]).catch(() => null)
    if (pilot) who = { kind: 'pilot', pilot, email: null }
  }
  if (!who) return res.status(owner.status === 500 ? 500 : 403).json({ error: 'Not allowed: ' + (req.headers[PILOT_HEADER] ? 'pilot link not active' : owner.reason) })
  const isOwner = who.kind === 'owner'

  // Is this browser allowed to use Ask? (The page asks once per load.)
  if (req.method === 'GET' && req.query?.pilot_check) {
    if (isOwner) return res.status(200).json({ ok: true, kind: 'owner' })
    const usage = await pilotUsage(adminClient(), who.pilot.id).catch(() => ({ day: 0 }))
    return res.status(200).json({ ok: true, kind: 'pilot', name: who.pilot.name, daily_limit: who.pilot.daily_limit,
      left_today: Math.max(0, who.pilot.daily_limit - (usage.day || 0)) })
  }

  // Everything below except asking and rating is for the owner only.
  const body = req.method === 'POST' ? (typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {})) : {}
  if (!isOwner && (req.method !== 'POST' || body.pilot_admin)) return res.status(403).json({ error: 'Not allowed: owner only' })

  // Pilot usage: trends and real-world use (server/ask/usage.js).
  if (req.method === 'GET' && req.query?.usage) {
    try {
      const admin = adminClient()
      const includeOwner = req.query.usage === 'all'
      const rows = []
      for (let from = 0; ; from += 1000) {
        let q = admin.from('ask_log').select('id,created_at,pilot_id,conversation_id,source,status,rating,ms,cost_usd,lookups,error,surface')
          .eq('surface', 'chat').order('id').range(from, from + 999)
        if (!includeOwner) q = q.not('pilot_id', 'is', null)
        const { data, error } = await q
        if (error) throw new Error(error.message)
        rows.push(...(data || []))
        if (!data || data.length < 1000) break
      }
      const { data: pilots } = await admin.from('ask_pilots').select('id,name')
      return res.status(200).json(summarizeUsage(rows, pilots || [], { days: 30, budget: PILOT_BUDGET_USD }))
    } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  if (req.method === 'GET' && req.query?.pilots) {
    try { return res.status(200).json(await listPilots(adminClient())) } catch (e) { return res.status(500).json({ error: e.message }) }
  }

  if (req.method === 'GET' && req.query?.log) {
    let q = adminClient().from('ask_log')
      .select('id,created_at,user_email,pilot_id,surface,question,turn,model,status,gap,lookups,answer,ms,input_tokens,output_tokens,error,rating')
      .order('created_at', { ascending: false }).limit(300)
    if (req.query.status) q = q.eq('status', String(req.query.status))
    if (req.query.pilot) q = q.eq('pilot_id', String(req.query.pilot))
    const [{ data, error }, pilots] = await Promise.all([q, adminClient().from('ask_pilots').select('id,name')])
    if (error) return res.status(500).json({ error: error.message })
    const names = new Map((pilots.data || []).map(p => [p.id, p.name]))
    return res.status(200).json({ rows: (data || []).map(r => ({ ...r, pilot_name: r.pilot_id ? names.get(r.pilot_id) || 'pilot' : null })) })
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

  if (body.pilot_admin) {
    const r = await pilotAdmin(adminClient(), body.pilot_admin, who.email)
    return res.status(r.status).json(r.body)
  }

  // Thumbs up / down on an earlier answer.
  if (body.feedback) {
    const id = String(body.feedback.log_id || '')
    const rating = Number(body.feedback.rating)
    if (!/^[0-9a-f-]{36}$/i.test(id) || ![1, -1, 0].includes(rating)) return res.status(400).json({ error: 'bad feedback' })
    let q = adminClient().from('ask_log').update({ rating: rating || null, rated_at: new Date().toISOString() }).eq('id', id)
    q = isOwner ? q.eq('user_email', who.email) : q.eq('pilot_id', who.pilot.id)
    const { error } = await q
    return error ? res.status(500).json({ error: error.message }) : res.status(200).json({ ok: true })
  }

  // Pilots: the default model and settings only, within their limits.
  if (!isOwner) {
    const usage = await pilotUsage(adminClient(), who.pilot.id).catch(() => null)
    const msg = usage ? limitMessage(usage, who.pilot) : null
    if (msg) return res.status(429).json({ error: msg, limit: true })
    adminClient().from('ask_pilots').update({ last_used_at: new Date().toISOString() }).eq('id', who.pilot.id).then(() => {}, () => {})
  }
  const model = isOwner ? String(body.model || DEFAULT_MODEL) : DEFAULT_MODEL
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'bad model id' })
  const messages = cleanMessages(body.messages)
  const question = String(body.question || '').trim().slice(0, 1000)
  if (!messages.length && !question) return res.status(400).json({ error: 'question required' })
  if (messages.length && messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be the question' })
  const asked = messages.length ? messages[messages.length - 1].content : question
  const turn = messages.length ? messages.filter(m => m.role === 'user').length : 1
  warmUp(readClient())
  const ctx = {
    favoriteTeamIds: (Array.isArray(body.context?.favoriteTeamIds) ? body.context.favoriteTeamIds : [])
      .map(Number).filter(Number.isFinite).slice(0, 20),
  }
  // Opened from a College Profile ("Ask about this program"): say which program
  // "this program" means. Put on the FIRST user message so it is the same on
  // every turn and the conversation stays in the prompt cache.
  const programId = String(body.context?.programId || '')
  let programNote = null
  if (/^[0-9a-f-]{36}$/i.test(programId)) {
    const s = (await refData(readClient())).byId.get(programId)
    if (s) programNote = `[Asked from the College Profile of ${s.school} (${s.program_gender === 'M' ? 'men' : 'women'}'s soccer, ${s.division}), school_id ${s.id}. "This program", "they", "them" and "here" mean this program unless the question names another.]`
  }
  if (programNote && messages.length) {
    const i = messages.findIndex(m => m.role === 'user')
    if (i >= 0) messages[i] = { ...messages[i], content: `${programNote}\n\n${messages[i].content}` }
  }
  const prompt = messages.length ? { messages } : { prompt: programNote ? `${programNote}\n\n${question}` : question }

  const reasoning = isOwner && REASONING_LEVELS.includes(body.reasoning) ? body.reasoning : DEFAULT_REASONING
  const log = []
  const t0 = Date.now()
  const common = {
    model,
    instructions: instructions(),
    ...prompt,
    tools: buildTools(readClient(), log, ctx),
    stopWhen: stepCountIs(8),
    maxOutputTokens: 1800,
    reasoning,
    providerOptions: gatewayOptions(model, isOwner ? who.email : `pilot:${who.pilot.id}`),
  }
  // For usage tracking: the saved chat this question belongs to, and how it started.
  const conversationId = /^[A-Za-z0-9_-]{1,64}$/.test(String(body.context?.conversationId || '')) ? body.context.conversationId : null
  const source = ['typed', 'suggestion', 'followup', 'quiz', 'email', 'callprep', 'invite', 'similar'].includes(body.context?.source) ? body.context.source : null
  const record = (text, usage, err, costUsd = null) => {
    const { status, gap } = readStatus(text)
    return logAsk({
      user_email: who.email, pilot_id: isOwner ? null : who.pilot.id, surface: body.stream ? 'chat' : 'bench', question: asked, turn, model,
      cost_usd: costUsd, conversation_id: conversationId, source,
      status: err ? 'error' : (status || (text ? 'answered' : 'error')), gap,
      lookups: lookupSummary(log), answer: visibleAnswer(text).slice(0, 8000) || null, ms: Date.now() - t0,
      input_tokens: usage?.inputTokens ?? null, output_tokens: usage?.outputTokens ?? null, error: err || null,
    })
  }

  // Streaming (the consumer page): newline-delimited JSON events.
  //   {t:'text', d}                  a piece of the answer
  //   {t:'reset', keep}              drop text written before a look-up: keep the first `keep` characters
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
    let costUsd = null
    try {
      const result = streamText(common)
      let stepText = ''
      for await (const part of result.fullStream) {
        // Text the model writes before calling look-ups ("I'll search for…") is
        // not the answer: when a step that wrote text then calls a look-up, the
        // page is told to drop that text (reset to the length kept).
        if (part.type === 'start-step') stepText = ''
        else if (part.type === 'text-delta') { text += part.text; stepText += part.text; send({ t: 'text', d: part.text }) }
        else if (part.type === 'tool-call') {
          if (stepText) { text = text.slice(0, text.length - stepText.length); stepText = ''; send({ t: 'reset', keep: text.length }) }
          send({ t: 'lookup', tool: part.toolName, input: part.input })
        }
        else if (part.type === 'tool-result') send({ t: 'data', tool: part.toolName, input: part.input, output: part.output })
        else if (part.type === 'error') { err = String(part.error?.message || part.error); send({ t: 'error', error: err }) }
      }
      usage = (await result.totalUsage) || {}
      costUsd = costOfSteps(await result.steps)
    } catch (e) {
      err = e.message || String(e)
      send({ t: 'error', error: err })
    }
    const logId = await record(text, usage, err, costUsd)
    send({ t: 'done', model, reasoning, ms: Date.now() - t0, log_id: logId,
      usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null,
        reasoning_tokens: usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? null } })
    return res.end()
  }

  // One-shot JSON (the owner test bench).
  try {
    const result = await generateText(common)
    const usage = result.totalUsage || result.usage || {}
    const costUsd = costOfSteps(result.steps)
    const logId = await record(result.text, usage, null, costUsd)
    return res.status(200).json({
      model,
      answer: result.text,
      lookups: log,
      log_id: logId,
      steps: result.steps?.length ?? null,
      reasoning,
      usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null,
        reasoning_tokens: usage.outputTokenDetails?.reasoningTokens ?? usage.reasoningTokens ?? null,
        cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? null },
      gateway_cost: costUsd,
      ms: Date.now() - t0,
    })
  } catch (e) {
    await record('', null, e.message || String(e))
    return res.status(502).json({ model, error: e.message || String(e), lookups: log, ms: Date.now() - t0 })
  }
}

// For test/ask.test.mjs only (no network): the pieces that can be checked offline.
export const _internals = { outreachAddresses, modelView, buildTools, readStatus, visibleAnswer, confMatcher, cardMetric, resetCache: () => { REF = null; REF_LOADING = null; CATALOG = null; STRENGTH = null; STRENGTH_LOADING = null; AWARDS = null; AWARDS_LOADING = null } }
