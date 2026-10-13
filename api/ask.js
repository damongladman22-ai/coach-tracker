import { createClient } from '@supabase/supabase-js'
import { generateText, tool, stepCountIs, gateway } from 'ai'
import { z } from 'zod'
import { POSITIONS, DIVISIONS, rankPrograms, reasons, stateAbbr } from '../src/lib/findPrograms.js'

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

const DEFAULT_MODEL = 'openai/gpt-5.6-luna'
const MODEL_RE = /^[a-z0-9-]+\/[a-z0-9.\-:]+$/i
const MAX_ROWS = 25
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
const genderCode = g => (/^w/i.test(g || '') ? 'W' : /^m/i.test(g || '') ? 'M' : null)
const round = (x, d = 1) => (x == null || isNaN(Number(x)) ? null : Math.round(Number(x) * 10 ** d) / 10 ** d)

// ── the look-ups ────────────────────────────────────────────────────────────
function buildTools(db, log) {
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
      description: 'Find college soccer programmes by name, nickname or short name (e.g. "Ohio State", "Pitt", "UConn"). ' +
        'Returns programme ids for the other look-ups. Each college has a separate men\'s and women\'s programme.',
      inputSchema: z.object({
        name: z.string().describe('College name, short name or nickname'),
        gender: z.enum(['M', 'W']).optional().describe('M = men\'s programme, W = women\'s programme'),
      }),
      execute: run('find_school', async ({ name, gender }) => {
        const q = norm(name)
        const ids = new Set()
        const { data: al } = await db.from('school_aliases').select('school_id').eq('alias_norm', q).limit(20)
        for (const r of al || []) ids.add(r.school_id)
        let byName = db.from('schools').select('id').ilike('school', `%${name.trim()}%`).neq('is_active', false).limit(20)
        const { data: nm } = await byName
        for (const r of nm || []) ids.add(r.id)
        if (!ids.size) return { matches: [], note: 'No programme matched that name.' }
        let sq = db.from('schools').select('id, school, program_gender, division, conference, city, state')
          .in('id', [...ids]).neq('is_active', false)
        if (gender) sq = sq.eq('program_gender', gender)
        const { data, error } = await sq.limit(20)
        if (error) throw new Error(error.message)
        return { matches: (data || []).map(s => ({ school_id: s.id, school: s.school, gender: s.program_gender,
          division: s.division, conference: s.conference, city: s.city, state: s.state })) }
      }),
    }),

    find_programs: tool({
      description: 'Rank programmes by ESTIMATED roster openings for one position and one high-school graduating class ' +
        '(the same numbers as the Find programs page). Optional filters: divisions, states, conference. ' +
        'Openings are an estimate from graduations plus expected early departures and how many freshmen the programme usually signs; ' +
        'incoming commits are NOT known.',
      inputSchema: z.object({
        gender: z.enum(['M', 'W']),
        position: z.enum(['GK', 'D', 'M', 'F']).describe('GK goalkeeper, D defender, M midfielder, F forward'),
        hs_class: z.number().int().describe('High-school graduating class, e.g. 2027 (enters college that fall)'),
        divisions: z.array(z.enum(DIVISIONS)).optional(),
        states: z.array(z.string()).optional().describe('Two-letter state codes, e.g. ["OH","PA"]'),
        conference: z.string().optional().describe('Exact or partial conference name, e.g. "Big Ten"'),
        limit: z.number().int().min(1).max(MAX_ROWS).optional(),
      }),
      execute: run('find_programs', async ({ gender, position, hs_class, divisions, states, conference, limit }) => {
        const { data: lat } = await db.from('program_openings_outlook').select('current_season')
          .order('current_season', { ascending: false }).limit(1)
        const latest = lat?.[0]?.current_season ?? null
        const rows = await allRows(() => db.from('program_openings_outlook')
          .select('school_id,entry_season,position,current_season,graduating,continuing,early_rate,transitions,' +
            'fresh_share,est_spots,est_freshman,schools!inner(school,program_gender,division,conference,city,state)')
          .eq('entry_season', hs_class).eq('position', position).eq('schools.program_gender', gender)
          .order('school_id', { ascending: true }))
        if (!rows.length) return { programs: [], note: `No estimates for class of ${hs_class}. Latest roster season is ${latest}; classes ${latest + 1}–${latest + 4} are covered.` }
        const conf = conference ? norm(conference) : null
        const ranked = rankPrograms(rows, {
          divisions: divisions?.length ? new Set(divisions) : null,
          states: states?.length ? new Set(states.map(s => s.toUpperCase())) : null,
          minSeason: latest != null ? latest - 1 : null,
          keep: conf ? r => norm(r.schools?.conference).includes(conf) : null,
        })
        const n = Math.min(limit || 10, MAX_ROWS)
        return {
          matched: ranked.length,
          latest_roster_season: latest,
          programs: ranked.slice(0, n).map(r => ({
            school_id: r.school_id, school: r.schools.school, division: r.schools.division,
            conference: r.schools.conference, state: stateAbbr(r.schools.state),
            est_freshman_openings: round(r.est_freshman), est_total_openings: round(r.est_spots),
            graduating_before_entry: r.graduating, roster_season: r.current_season,
            reasons: reasons(r, position, hs_class),
          })),
        }
      }),
    }),

    program_results: tool({
      description: 'Season-by-season record for one programme: wins, losses, ties, conference record and RPI rank (D-I) where known.',
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
      description: 'Rank programmes by RPI rank (NCAA D-I only) or by win percentage for one season, with optional division, conference and state filters.',
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
        const conf = conference ? norm(conference) : null
        const st = states?.length ? new Set(states.map(s => s.toUpperCase())) : null
        const kept = rows.filter(r => r.schools?.is_active !== false
          && (!conf || norm(r.conference).includes(conf))
          && (!st || st.has(stateAbbr(r.schools?.state))))
          .filter(r => sort === 'rpi' || (r.wins + r.losses + r.ties) >= 5)
        kept.sort(sort === 'rpi' ? (a, b) => a.rpi_rank - b.rpi_rank : (a, b) => (b.win_pct - a.win_pct) || (b.wins - a.wins))
        const n = Math.min(limit || 10, MAX_ROWS)
        return {
          matched: kept.length,
          note: sort === 'win_pct' ? 'Programmes with fewer than 5 games are left out.' : undefined,
          programs: kept.slice(0, n).map(r => ({ school_id: r.school_id, school: r.schools.school, division: r.schools.division,
            conference: r.conference, state: stateAbbr(r.schools.state), record: `${r.wins}-${r.losses}-${r.ties}`,
            win_pct: round(r.win_pct, 3), rpi_rank: r.rpi_rank })),
        }
      }),
    }),

    program_transfers: tool({
      description: 'Transfers into and out of one programme by roster season: how many players arrived from (in) or left for (out) ' +
        'other college programmes, by the other programme\'s division and whether the move was up, down or lateral.',
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
      description: 'The current coaching staff of one programme, with titles and published email addresses.',
      inputSchema: z.object({ school_id: z.string() }),
      execute: run('program_coaches', async ({ school_id }) => {
        const { data, error } = await db.from('coaches').select('first_name, last_name, title, email')
          .eq('school_id', school_id).eq('is_active', true)
        if (error) throw new Error(error.message)
        return { coaches: (data || []).map(c => ({ name: `${c.first_name} ${c.last_name}`.trim(), title: c.title, email: c.email })) }
      }),
    }),

    program_profile: tool({
      description: 'Profile facts for one programme: location and division, recruiting style (freshmen vs transfers, in-state reach, ' +
        'international share, roster stability, each read against similar programmes), expected early-departure rate, ' +
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
        if (!s.data) return { error: 'No programme with that id.' }
        return {
          programme: s.data,
          recruiting_style: style.data ? {
            builds_with: { low: 'mostly freshmen', typical: 'a typical mix', high: 'more transfers than peers' }[style.data.build_band] || null,
            in_state_reach: style.data.reach_band, international_share: style.data.abroad_band, roster_stability: style.data.stability_band,
            note: 'Bands are low / typical / high against similar programmes.',
          } : null,
          expected_early_departure_rate: dep.data ? { rate: round(dep.data.outlook_rate, 3), seasons_tracked: dep.data.transitions, basis: dep.data.basis } : null,
          college_facts: link.data?.college_facts || null,
        }
      }),
    }),
  }
}

// ── the instructions every model gets ───────────────────────────────────────
function instructions() {
  const today = new Date().toISOString().slice(0, 10)
  return [
    `You are the PitchSide college soccer assistant. Today is ${today}.`,
    'Answer ONLY from the results of the look-up tools. Never use outside knowledge for numbers, names, records, rankings or coaches.',
    'If the look-ups do not hold what was asked, say plainly that PitchSide does not have it. Do not guess.',
    'Always resolve a college name with find_school first, then pass its school_id to the other tools. If both a men\'s and a women\'s programme match and the question does not say which, ask or answer for both.',
    'Openings are ESTIMATES (graduations, expected early departures, usual freshman intake); incoming commits are not known. Say "estimated".',
    'Give the numbers you used (seasons, records, counts) so the reader can check them. Keep answers short: a few sentences or a short list.',
    'Do not give advice on NCAA recruiting rules or contact dates, and do not discuss individual players.',
    `Positions: ${POSITIONS.map(p => `${p.code}=${p.one}`).join(', ')}. Divisions: ${DIVISIONS.join(', ')}.`,
  ].join('\n')
}

// ── handler ─────────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  const who = await checkOwner(req)
  if (!who.ok) return res.status(who.status).json({ error: 'Not allowed: ' + who.reason })

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
  const question = String(body.question || '').trim().slice(0, 1000)
  const model = String(body.model || DEFAULT_MODEL)
  if (!question) return res.status(400).json({ error: 'question required' })
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'bad model id' })

  const log = []
  const t0 = Date.now()
  try {
    const result = await generateText({
      model,
      instructions: instructions(),
      prompt: question,
      tools: buildTools(readClient(), log),
      stopWhen: stepCountIs(6),
      maxOutputTokens: 1200,
      providerOptions: { gateway: { disallowPromptTraining: true, caching: 'auto', tags: ['pitchside-ask'], user: who.email } },
    })
    const usage = result.totalUsage || result.usage || {}
    const gw = result.providerMetadata?.gateway || null
    return res.status(200).json({
      model,
      answer: result.text,
      lookups: log,
      steps: result.steps?.length ?? null,
      usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null,
        cached_input_tokens: usage.inputTokenDetails?.cacheReadTokens ?? usage.cachedInputTokens ?? null },
      gateway_cost: gw?.cost ?? null,
      ms: Date.now() - t0,
    })
  } catch (e) {
    return res.status(502).json({ model, error: e.message || String(e), lookups: log, ms: Date.now() - t0 })
  }
}
