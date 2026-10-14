// Pilot access to Ask PitchSide (backlog F2, Damon 2026-10-14: "a way to open
// this up to a few pilot people … not requiring a login"; chose personal pilot
// links). Table: pipeline out_sql/26_ask_pilots.sql.
//
// A pilot opens …/ask?pilot=<code> once; the browser keeps the code and sends
// it in the X-Ask-Pilot header. The table holds only a SHA-256 hash of each
// code. Every pilot question is logged with pilot_id, and the limits below
// count from ask_log. Server-only (node:crypto); never imported by the page.
import { createHash, randomBytes } from 'node:crypto'

export const PILOT_HEADER = 'x-ask-pilot'
// Limits (Damon 2026-10-14: 5 to 10 pilots, $50 for the pilot; loosened so it
// feels like real use). Measured cost: about $0.0005 to $0.0015 a question.
export const DEFAULT_DAILY_LIMIT = 150       // questions per pilot in any 24 hours (editable per pilot)
export const BURST_PER_MINUTE = 10           // questions per pilot in any 60 seconds
export const PILOT_BUDGET_USD = 50           // all pilots together, actual AI cost (ask_log.cost_usd), all time

const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'   // no 0/O, 1/I/L

/** A new code: 12 characters shown as XXXX-XXXX-XXXX (about 59 bits). */
export function newPilotCode() {
  const b = randomBytes(12)
  const s = Array.from(b, x => ALPHABET[x % ALPHABET.length]).join('')
  return `${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8)}`
}
export const normCode = c => String(c || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
export const hashCode = c => createHash('sha256').update(normCode(c)).digest('hex')
export const codeHint = c => normCode(c).slice(-4)

/** The active pilot for a code, or null. */
export async function findPilot(admin, code) {
  if (normCode(code).length !== 12) return null
  const { data, error } = await admin.from('ask_pilots')
    .select('id,name,daily_limit,active').eq('code_hash', hashCode(code)).maybeSingle()
  if (error || !data || !data.active) return null
  return data
}

async function countSince(admin, sinceIso, pilotId) {
  let q = admin.from('ask_log').select('id', { count: 'exact', head: true }).gte('created_at', sinceIso)
  q = pilotId ? q.eq('pilot_id', pilotId) : q.not('pilot_id', 'is', null)
  const { count, error } = await q
  if (error) throw new Error(error.message)
  return count || 0
}

/** Actual AI cost of every pilot question so far (USD). Cached a minute per server instance. */
let SPEND = null
export async function pilotSpend(admin, { fresh = false } = {}) {
  if (!fresh && SPEND && Date.now() - SPEND.at < 60e3) return SPEND.usd
  let usd = 0
  for (let from = 0; ; from += 1000) {
    const { data, error } = await admin.from('ask_log').select('id,cost_usd')
      .not('pilot_id', 'is', null).not('cost_usd', 'is', null).order('id').range(from, from + 999)
    if (error) throw new Error(error.message)
    for (const r of data || []) usd += Number(r.cost_usd) || 0
    if (!data || data.length < 1000) break
  }
  SPEND = { at: Date.now(), usd }
  return usd
}

/** Questions this pilot asked in the last 24 hours and last minute, and all pilots' spend so far. */
export async function pilotUsage(admin, pilotId, now = new Date()) {
  const day = new Date(now.getTime() - 24 * 3600e3).toISOString()
  const minute = new Date(now.getTime() - 60e3).toISOString()
  const [d, m, spend] = await Promise.all([countSince(admin, day, pilotId), countSince(admin, minute, pilotId), pilotSpend(admin)])
  return { day: d, minute: m, spend }
}

/** A plain-words message when a limit is reached, else null. */
export function limitMessage(usage, pilot) {
  if (usage.spend >= PILOT_BUDGET_USD) return 'Ask PitchSide is paused while we review the pilot. Thank you for testing it.'
  if (usage.day >= (pilot.daily_limit || DEFAULT_DAILY_LIMIT)) return `You have reached the pilot limit of ${pilot.daily_limit || DEFAULT_DAILY_LIMIT} questions in 24 hours. Questions open up again as the day goes on.`
  if (usage.minute >= BURST_PER_MINUTE) return 'That is a lot of questions in one minute. Please wait a moment and try again.'
  return null
}

/** Owner list: every pilot with questions in the last 24 hours, in total, and when last used. */
export async function listPilots(admin) {
  const { data: pilots, error } = await admin.from('ask_pilots')
    .select('id,name,code_hint,daily_limit,active,created_at,last_used_at').order('created_at', { ascending: false })
  if (error) throw new Error(error.message)
  const since = new Date(Date.now() - 24 * 3600e3).toISOString()
  const stats = new Map((pilots || []).map(p => [p.id, { today: 0, total: 0 }]))
  for (let from = 0; ; from += 1000) {
    const { data, error: e } = await admin.from('ask_log').select('id,pilot_id,created_at')
      .not('pilot_id', 'is', null).order('id').range(from, from + 999)
    if (e) throw new Error(e.message)
    for (const r of data || []) {
      const s = stats.get(r.pilot_id)
      if (!s) continue
      s.total++
      if (r.created_at >= since) s.today++
    }
    if (!data || data.length < 1000) break
  }
  return {
    pilots: (pilots || []).map(p => ({ ...p, ...stats.get(p.id) })),
    spend_usd: await pilotSpend(admin, { fresh: true }),
    budget_usd: PILOT_BUDGET_USD,
  }
}

/** Owner actions: create (returns the code once), new link (replaces the code), update. */
export async function pilotAdmin(admin, a, ownerEmail) {
  const name = typeof a.name === 'string' ? a.name.trim().slice(0, 60) : undefined
  const limit = a.daily_limit != null ? Math.round(Number(a.daily_limit)) : undefined
  if (limit != null && !(limit >= 1 && limit <= 500)) return { status: 400, body: { error: 'Daily limit must be 1 to 500.' } }
  if (a.action === 'create') {
    if (!name) return { status: 400, body: { error: 'Give the pilot a name.' } }
    const code = newPilotCode()
    const { data, error } = await admin.from('ask_pilots').insert({
      name, code_hash: hashCode(code), code_hint: codeHint(code), daily_limit: limit || DEFAULT_DAILY_LIMIT, created_by: ownerEmail,
    }).select('id,name,code_hint,daily_limit,active,created_at').single()
    return error ? { status: 500, body: { error: error.message } } : { status: 200, body: { pilot: data, code } }
  }
  if (!/^[0-9a-f-]{36}$/i.test(String(a.id || ''))) return { status: 400, body: { error: 'bad pilot id' } }
  if (a.action === 'new_link') {
    const code = newPilotCode()
    const { error } = await admin.from('ask_pilots').update({ code_hash: hashCode(code), code_hint: codeHint(code) }).eq('id', a.id)
    return error ? { status: 500, body: { error: error.message } } : { status: 200, body: { code } }
  }
  if (a.action === 'update') {
    const patch = {}
    if (name) patch.name = name
    if (limit != null) patch.daily_limit = limit
    if (typeof a.active === 'boolean') patch.active = a.active
    if (!Object.keys(patch).length) return { status: 400, body: { error: 'nothing to change' } }
    const { error } = await admin.from('ask_pilots').update(patch).eq('id', a.id)
    return error ? { status: 500, body: { error: error.message } } : { status: 200, body: { ok: true } }
  }
  return { status: 400, body: { error: 'unknown action' } }
}
