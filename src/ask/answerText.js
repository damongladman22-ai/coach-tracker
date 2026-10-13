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
