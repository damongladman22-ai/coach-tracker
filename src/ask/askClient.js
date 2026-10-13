import { supabase } from '../lib/supabase'

/**
 * askClient — talks to /api/ask in streaming mode (backlog F2).
 *
 * The server sends newline-delimited JSON events:
 *   {t:'text', d}  {t:'lookup', tool, input}  {t:'data', tool, input, output}
 *   {t:'done', model, ms, usage}  {t:'error', error}
 * streamAsk() calls onEvent for each one, in order, as it arrives.
 */
export async function streamAsk(messages, { signal, onEvent }) {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  const r = await fetch('/api/ask', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ messages, stream: true }),
  })
  if (!r.ok || !r.body) {
    let msg = `HTTP ${r.status}`
    try { msg = (await r.json()).error || msg } catch { /* not JSON */ }
    throw new Error(msg)
  }
  const reader = r.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let nl
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim()
      buf = buf.slice(nl + 1)
      if (line) { try { onEvent(JSON.parse(line)) } catch { /* partial or bad line */ } }
    }
  }
  if (buf.trim()) { try { onEvent(JSON.parse(buf)) } catch { /* ignore */ } }
}

/** Split the model's text into the visible answer and its FOLLOW-UPS line. */
export function splitAnswer(text) {
  const m = /\n?[ \t]*\**FOLLOW-?UPS:?\**:?/i.exec(text || '')
  if (!m) return { body: text || '', followups: [] }
  const body = text.slice(0, m.index).trimEnd()
  const followups = text.slice(m.index + m[0].length).split('|')
    .map(s => s.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '').trim()).filter(s => s.length > 3).slice(0, 3)
  return { body, followups }
}

const LOOKUP_LABEL = {
  find_school: i => `Finding ${i?.name || 'the program'}`,
  find_programs: () => 'Ranking programs by estimated openings',
  program_results: () => 'Checking season records',
  rank_by_results: i => (i?.sort === 'rpi' ? 'Ranking programs by RPI' : 'Ranking programs by record'),
  program_transfers: () => 'Checking transfers in and out',
  program_coaches: () => 'Looking up the coaching staff',
  program_profile: () => 'Reading the program profile',
}
export const lookupLabel = (tool, input) => (LOOKUP_LABEL[tool] ? LOOKUP_LABEL[tool](input) : 'Looking that up')

const SOURCE_LABEL = {
  find_programs: 'Openings estimates from current rosters',
  program_results: 'Season results and RPI',
  rank_by_results: 'Season results and RPI',
  program_transfers: 'Transfers traced between college rosters',
  program_coaches: 'PitchSide coach directory',
  program_profile: 'Program profile and U.S. College Scorecard',
}
export function sourceLabels(lookups) {
  return [...new Set((lookups || []).map(l => SOURCE_LABEL[l.tool]).filter(Boolean))]
}

/** Programs to show as cards: from ranked lists, in the order returned. */
export function programCards(lookups) {
  const out = []
  const seen = new Set()
  for (const l of lookups || []) {
    const list = l.output?.programs
    if (!Array.isArray(list) || !(l.tool === 'find_programs' || l.tool === 'rank_by_results')) continue
    for (const p of list) {
      if (!p?.school_id || seen.has(p.school_id)) continue
      seen.add(p.school_id)
      out.push({ ...p, kind: l.tool })
    }
  }
  return out
}
