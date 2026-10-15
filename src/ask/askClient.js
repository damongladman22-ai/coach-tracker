import { askHeaders } from './askAccess'

/**
 * askClient — talks to /api/ask in streaming mode (backlog F2).
 *
 * The server sends newline-delimited JSON events:
 *   {t:'text', d}  {t:'lookup', tool, input}  {t:'data', tool, input, output}
 *   {t:'done', model, ms, usage}  {t:'error', error}
 * streamAsk() calls onEvent for each one, in order, as it arrives.
 */
export async function streamAsk(messages, { signal, onEvent, context }) {
  const r = await fetch('/api/ask', {
    method: 'POST',
    signal,
    headers: await askHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ messages, stream: true, context }),
  })
  if (!r.ok || !r.body) {
    let msg = `HTTP ${r.status}`
    let limit = false
    try { const j = await r.json(); msg = j.error || msg; limit = !!j.limit } catch { /* not JSON */ }
    const err = new Error(msg)
    err.limit = limit   // a pilot limit: shown as a plain message, not a failure
    throw err
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

/** Split the model's text into the visible answer and its FOLLOW-UPS line.
 *  The STATUS line (answered / partial / unavailable, for the question log)
 *  and the FOLLOW-UPS line are never shown as text. */
export { stripMeta, splitAnswer, historyContent, splitEmail, knownEmails, addressList, mailtoHref, emailText } from './answerText.js'

const LOOKUP_LABEL = {
  find_school: i => `Finding ${i?.name || 'the program'}`,
  find_programs: i => (i?.position && i?.hs_class ? 'Ranking programs by estimated openings' : i?.near ? `Searching programs near ${i.near}` : 'Searching programs'),
  program_results: () => 'Checking season records',
  rank_by_results: i => (i?.sort === 'rpi' ? 'Ranking programs by RPI' : 'Ranking programs by record'),
  program_transfers: () => 'Checking transfers in and out',
  program_coaches: () => 'Looking up the coaching staff',
  outreach_facts: () => 'Looking up who to email',
  call_prep_facts: () => 'Gathering what PitchSide knows about the program',
  event_invite_facts: () => 'Finding the event and the coaches to invite',
  recruiting_year: () => 'Checking the recruiting timeline for your class',
  similar_programs: () => 'Finding programs like it',
  division_facts: () => 'Counting programs and typical rosters',
  program_profile: () => 'Reading the program profile',
  program_majors: i => (i?.search ? `Checking majors for "${i.search}"` : 'Checking majors offered'),
  programs_watching_team: () => 'Checking which college coaches watched your team',
}
export const lookupLabel = (tool, input) => (LOOKUP_LABEL[tool] ? LOOKUP_LABEL[tool](input) : 'Looking that up')

const SOURCE_LABEL = {
  find_programs: 'Openings estimates from current rosters',
  program_results: 'Season results and RPI',
  rank_by_results: 'Season results and RPI',
  program_transfers: 'Transfers traced between college rosters',
  program_coaches: 'PitchSide coach directory',
  outreach_facts: 'PitchSide coach directory and current rosters',
  call_prep_facts: 'Rosters, openings estimates, results and U.S. College Scorecard',
  event_invite_facts: 'Your club schedule and coach attendance logged at your games and events',
  recruiting_year: 'Recruiting timelines by grade; NCAA Guide for the College-Bound Student-Athlete 2025-26',
  similar_programs: 'PitchSide programs and U.S. College Scorecard',
  division_facts: 'PitchSide programs and current rosters',
  program_profile: 'Program profile and U.S. College Scorecard',
  program_majors: 'U.S. College Scorecard majors',
  programs_watching_team: 'Coach attendance logged at your games',
}
export function sourceLabels(lookups) {
  const out = []
  for (const l of lookups || []) {
    if (l.tool === 'find_programs') {
      if (l.input?.position && l.input?.hs_class) out.push(SOURCE_LABEL.find_programs)
      const i = l.input || {}
      if (i.major || ['sat_min', 'sat_max', 'admission_rate_max', 'admission_rate_min', 'graduation_rate_min', 'net_price_max',
        'undergrads_min', 'undergrads_max', 'type', 'setting'].some(k => i[k] != null) || (i.sort && !['openings', 'distance'].includes(i.sort))) {
        out.push('U.S. College Scorecard')
      }
      if (i.near) out.push('U.S. College Scorecard', 'U.S. Census locations')
    } else if (SOURCE_LABEL[l.tool]) out.push(SOURCE_LABEL[l.tool])
  }
  return [...new Set(out)]
}

/** Programs to show as cards: from ranked lists, in the order returned. */
export function programCards(lookups) {
  const out = []
  const seen = new Set()
  for (const l of lookups || []) {
    const list = l.output?.programs
    if (!Array.isArray(list) || !['find_programs', 'rank_by_results', 'programs_watching_team', 'event_invite_facts', 'similar_programs'].includes(l.tool)) continue
    for (const p of list) {
      if (!p?.school_id || seen.has(p.school_id)) continue
      seen.add(p.school_id)
      out.push({ ...p, kind: l.tool })
    }
  }
  return out
}
