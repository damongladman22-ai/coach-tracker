// Splitting a streamed answer into what the reader sees and the follow-up
// buttons. Pure (no imports) so the tests can load it.

// The answer without the STATUS line (logged, never shown) and without the
// FOLLOW-UPS line and anything after it. Text after STATUS is kept.
// While streaming, a half-written STATUS / FOLLOW-UPS word at the end is hidden.
export function stripMeta(text) {
  const t = text || ''
  const f = /\n?[ \t]*\**FOLLOW-?UPS\b/i.exec(t)
  return (f ? t.slice(0, f.index) : t)
    .replace(/^[ \t]*\**STATUS\b[^\n]*(\n|$)/gim, '')
    .replace(/\n[ \t]*\**(S|ST|STA|STAT|STATU|F|FO|FOL|FOLL|FOLLO|FOLLOW|FOLLOW-|FOLLOW-U|FOLLOW-UP)$/i, '')
    .trim()
}

export function splitAnswer(text) {
  const t = text || ''
  const body = stripMeta(t)
  const m = /\**FOLLOW-?UPS:?\**:?/i.exec(t)
  if (!m) return { body, followups: [] }
  const followups = t.slice(m.index + m[0].length).split('|')
    .map(s => s.replace(/^\s*(?:[-*\u2022]|\d+[.)])\s+/, '').trim()).filter(s => s.length > 3).slice(0, 3)
  return { body, followups }
}

// What an earlier assistant turn is sent back as, in the conversation history:
// the visible answer plus, when it ran a program search, the exact filters it
// used. Without them a follow-up such as "why is Michigan not on the list?"
// re-ran the search with different filters and contradicted the list the reader
// had just seen (pilot, 2026-10-14). The server tells the model never to show it.
export function historyContent(content, lookups) {
  const body = splitAnswer(content).body
  const last = [...(lookups || [])].reverse().find(l => l && l.tool === 'find_programs' && l.input)
  if (!last) return body
  const filters = { ...last.input }
  delete filters.schools
  delete filters.limit
  return `${body}\n\n[Filters used for this answer: find_programs ${JSON.stringify(filters)}]`
}

// ── Outreach email drafts (backlog F4) ──────────────────────────────────────
// The model writes a draft between ---EMAIL--- and ---END EMAIL--- lines:
// To / Cc / Subject lines, a blank line, then the body. splitEmail() pulls it
// out so the page can show it as an email card. While streaming, the end line
// may not have arrived yet (complete: false).
const EMAIL_START = /^[ \t]*-{2,}[ \t]*EMAIL[ \t]*-{2,}[ \t]*$/im
const EMAIL_END = /^[ \t]*-{2,}[ \t]*END[ \t]*EMAIL[ \t]*-{2,}[ \t]*$/im

export function splitEmail(text) {
  const t = text || ''
  const s = EMAIL_START.exec(t)
  if (!s) return { before: t, email: null, after: '' }
  const rest = t.slice(s.index + s[0].length)
  const e = EMAIL_END.exec(rest)
  const inner = (e ? rest.slice(0, e.index) : rest).replace(/^\s*\n/, '')
  const lines = inner.split('\n')
  const head = {}
  let i = 0
  for (; i < lines.length; i++) {
    const m = /^\s*\**(To|Cc|Subject)\**\s*:\s*\**\s*(.*?)\s*$/i.exec(lines[i])
    if (!m) break
    head[m[1].toLowerCase()] = m[2]
  }
  return {
    before: t.slice(0, s.index).trim(),
    email: { to: head.to || '', cc: head.cc || '', subject: head.subject || '', body: lines.slice(i).join('\n').trim(), complete: !!e },
    after: e ? rest.slice(e.index + e[0].length).trim() : '',
  }
}

const EMAIL_RE = /^[^\s@,;<>()"']+@[^\s@,;<>()"']+\.[a-z]{2,}$/i

// Email addresses the look-ups in this answer returned (outreach_facts and
// program_coaches). Only these are put in To and Cc, so a mistyped or made-up
// address from the model never reaches the family's email app.
export function knownEmails(lookups) {
  const out = new Set()
  const add = list => { for (const c of list || []) if (c?.email && EMAIL_RE.test(c.email)) out.add(c.email.toLowerCase()) }
  for (const l of lookups || []) {
    const o = l?.output || {}
    if (l?.tool === 'outreach_facts') { add(o.to); add(o.cc) }
    if (l?.tool === 'program_coaches') add(o.coaches)
  }
  return out
}

export function addressList(text, known) {
  const seen = new Set()
  const out = []
  for (const raw of String(text || '').split(/[,;\s]+/)) {
    const a = raw.replace(/^[<(]+|[>).]+$/g, '').trim()
    const k = a.toLowerCase()
    if (!EMAIL_RE.test(a) || seen.has(k) || (known && !known.has(k))) continue
    seen.add(k)
    out.push(a)
  }
  return out
}

// A mailto: link that opens the draft in the family's email app.
export function mailtoHref({ to = [], cc = [], subject = '', body = '' }) {
  const q = []
  if (cc.length) q.push('cc=' + cc.join(','))
  if (subject) q.push('subject=' + encodeURIComponent(subject))
  if (body) q.push('body=' + encodeURIComponent(body.replace(/\r?\n/g, '\r\n')))
  return 'mailto:' + to.join(',') + (q.length ? '?' + q.join('&') : '')
}

// The draft as plain text, for Copy.
export function emailText({ to = [], cc = [], subject = '', body = '' }) {
  return [to.length ? `To: ${to.join(', ')}` : null, cc.length ? `Cc: ${cc.join(', ')}` : null,
    subject ? `Subject: ${subject}` : null].filter(Boolean).join('\n') + (subject || to.length ? '\n\n' : '') + body
}
