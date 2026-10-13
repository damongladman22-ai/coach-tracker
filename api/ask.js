/* global process */
import { createClient } from '@supabase/supabase-js'
import { generateText, streamText, tool, stepCountIs, gateway } from 'ai'
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

// Default and fallback chosen from the bake-off (Damon, 2026-10-13): Claude Haiku
// 5.5 (20/20, cheapest reliable, fastest); if it fails or its provider is down,
// the gateway retries the same request on GPT-5.6 Luna (also 20/20).
const DEFAULT_MODEL = 'anthropic/claude-haiku-5.5'
const FALLBACK_MODEL = 'openai/gpt-5.6-luna'
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
      description: 'Find college soccer programs by name, nickname or short name (e.g. "Ohio State", "Pitt", "UConn"). ' +
        'Returns program ids for the other look-ups. Each college has a separate men\'s and women\'s program.',
      inputSchema: z.object({
        name: z.string().describe('College name, short name or nickname'),
        gender: z.enum(['M', 'W']).optional().describe('M = men\'s program, W = women\'s program'),
      }),
      execute: run('find_school', async ({ name, gender }) => {
        const q = norm(name)
        const ids = new Set()
        const { data: al } = await db.from('school_aliases').select('school_id').eq('alias_norm', q).limit(20)
        for (const r of al || []) ids.add(r.school_id)
        let byName = db.from('schools').select('id').ilike('school', `%${name.trim()}%`).neq('is_active', false).limit(20)
        const { data: nm } = await byName
        for (const r of nm || []) ids.add(r.id)
        if (!ids.size) return { matches: [], note: 'No program matched that name.' }
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
      description: 'Rank programs by ESTIMATED roster openings for one position and one high-school graduating class ' +
        '(the same numbers as the Find programs page). Optional filters: divisions, states, conference. ' +
        'Openings are an estimate from graduations plus expected early departures and how many freshmen the program usually signs; ' +
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
          ranked_by: 'estimated openings for incoming freshmen (est_freshman_openings), then total; the same order as the Find programs page',
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
    '- After the answer, on the very last line, write exactly: FOLLOW-UPS: question one | question two | question three',
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
// Only text is kept; the last 12 turns; each capped in length.
function cleanMessages(list) {
  return (Array.isArray(list) ? list : [])
    .filter(m => (m?.role === 'user' || m?.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .slice(-12)
    .map(m => ({ role: m.role, content: m.content.slice(0, m.role === 'user' ? 1000 : 4000) }))
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
  const model = String(body.model || DEFAULT_MODEL)
  if (!MODEL_RE.test(model)) return res.status(400).json({ error: 'bad model id' })
  const messages = cleanMessages(body.messages)
  const question = String(body.question || '').trim().slice(0, 1000)
  if (!messages.length && !question) return res.status(400).json({ error: 'question required' })
  if (messages.length && messages[messages.length - 1].role !== 'user') return res.status(400).json({ error: 'last message must be the question' })
  const prompt = messages.length ? { messages } : { prompt: question }

  const log = []
  const t0 = Date.now()
  const common = {
    model,
    instructions: instructions(),
    ...prompt,
    tools: buildTools(readClient(), log),
    stopWhen: stepCountIs(6),
    maxOutputTokens: 1500,
    providerOptions: gatewayOptions(model, who.email),
  }

  // Streaming (the consumer page): newline-delimited JSON events.
  //   {t:'text', d}                 a piece of the answer
  //   {t:'lookup', tool, input}      a look-up started
  //   {t:'data', tool, input, output} a look-up finished, with its rows
  //   {t:'done', model, ms, usage}   finished
  //   {t:'error', error}             failed
  if (body.stream) {
    res.statusCode = 200
    res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('X-Accel-Buffering', 'no')
    const send = obj => res.write(JSON.stringify(obj) + '\n')
    try {
      const result = streamText(common)
      for await (const part of result.fullStream) {
        if (part.type === 'text-delta') send({ t: 'text', d: part.text })
        else if (part.type === 'tool-call') send({ t: 'lookup', tool: part.toolName, input: part.input })
        else if (part.type === 'tool-result') send({ t: 'data', tool: part.toolName, input: part.input, output: part.output })
        else if (part.type === 'error') send({ t: 'error', error: String(part.error?.message || part.error) })
      }
      const usage = (await result.totalUsage) || {}
      send({ t: 'done', model, ms: Date.now() - t0,
        usage: { input_tokens: usage.inputTokens ?? null, output_tokens: usage.outputTokens ?? null } })
    } catch (e) {
      send({ t: 'error', error: e.message || String(e) })
    }
    return res.end()
  }

  // One-shot JSON (the owner test bench).
  try {
    const result = await generateText(common)
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
