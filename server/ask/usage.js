// Pilot usage for /owner/ask (Damon 2026-10-14: "are we tracking the usage for
// trends and measuring real world use"). Pure: summarizeUsage() takes ask_log
// rows and the pilot list and returns everything the Pilot usage view shows.

// What a question was about, from the look-ups it ran (first match wins).
export function topicOf(lookups) {
  const ls = Array.isArray(lookups) ? lookups : []
  const has = t => ls.some(l => l.tool === t)
  const fp = ls.find(l => l.tool === 'find_programs')?.input || null
  if (has('programs_watching_team')) return 'Your team'
  if (fp?.position && fp?.hs_class) return 'Openings'
  if (fp?.near) return 'Distance'
  if (fp && (fp.major || ['sat_min', 'sat_max', 'admission_rate_max', 'admission_rate_min', 'graduation_rate_min', 'net_price_max',
    'undergrads_min', 'undergrads_max', 'type', 'setting'].some(k => fp[k] != null))) return 'Academic fit'
  if (has('program_majors')) return 'Academic fit'
  if (has('rank_by_results') || has('program_results')) return 'Results'
  if (has('program_coaches')) return 'Coaches'
  if (has('program_transfers')) return 'Transfers'
  if (has('program_profile')) return 'Program profile'
  if (fp) return 'Program search'
  if (has('find_school')) return 'Find a school'
  return 'No look-up'
}

const DAY = 864e5
const dayKey = iso => String(iso).slice(0, 10)
const median = a => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor((a.length - 1) / 2)] : null)
const pct = (a, p) => (a.length ? a.slice().sort((x, y) => x - y)[Math.min(a.length - 1, Math.floor(a.length * p))] : null)
const inc = (o, k, n = 1) => { o[k] = (o[k] || 0) + n }

/**
 * rows: ask_log rows { created_at, pilot_id, conversation_id, source, status, rating, ms, cost_usd, lookups, error }
 * pilots: [{ id, name }]
 */
export function summarizeUsage(rows, pilots, { now = Date.now(), days = 30, budget = null } = {}) {
  const name = new Map((pilots || []).map(p => [p.id, p.name]))
  const all = (rows || []).filter(r => r.created_at)
  const costs = all.map(r => Number(r.cost_usd)).filter(x => Number.isFinite(x) && x > 0)
  const spend = costs.reduce((a, b) => a + b, 0)

  // Questions per day for the last `days` days (oldest first), with active pilots.
  const byDay = new Map()
  for (let i = days - 1; i >= 0; i--) byDay.set(dayKey(new Date(now - i * DAY).toISOString()), { questions: 0, pilots: new Set(), cost: 0 })
  for (const r of all) {
    const d = byDay.get(dayKey(r.created_at))
    if (!d) continue
    d.questions++
    if (r.pilot_id) d.pilots.add(r.pilot_id)
    d.cost += Number(r.cost_usd) || 0
  }

  // Conversations: rows sharing a conversation_id; rows without one count alone.
  const convs = new Map()
  all.forEach((r, i) => { const k = r.conversation_id || 'row:' + i; convs.set(k, (convs.get(k) || 0) + 1) })
  const convSizes = [...convs.values()]

  const status = {}, sources = {}, topics = {}
  for (const r of all) {
    inc(status, r.error ? 'error' : (r.status || 'unknown'))
    inc(sources, r.source || 'not recorded')
    inc(topics, topicOf(r.lookups))
  }
  const ms = all.map(r => r.ms).filter(x => Number.isFinite(x) && x > 0)

  // Per pilot.
  const per = new Map()
  for (const r of all) {
    if (!r.pilot_id) continue
    let p = per.get(r.pilot_id)
    if (!p) per.set(r.pilot_id, (p = { id: r.pilot_id, name: name.get(r.pilot_id) || 'pilot', questions: 0, convs: new Set(), days: new Set(), up: 0, down: 0, notAnswered: 0, cost: 0, last: null }))
    p.questions++
    p.convs.add(r.conversation_id || r.created_at)
    p.days.add(dayKey(r.created_at))
    if (r.rating === 1) p.up++
    if (r.rating === -1) p.down++
    if (r.error || r.status === 'unavailable' || r.status === 'partial') p.notAnswered++
    p.cost += Number(r.cost_usd) || 0
    if (!p.last || r.created_at > p.last) p.last = r.created_at
  }
  const week = now - 7 * DAY
  const perPilot = [...per.values()].map(p => ({
    id: p.id, name: p.name, questions: p.questions, conversations: p.convs.size, active_days: p.days.size,
    thumbs_up: p.up, thumbs_down: p.down, not_answered: p.notAnswered, cost_usd: p.cost, last_used: p.last,
  })).sort((a, b) => b.questions - a.questions)

  const sortDesc = o => Object.entries(o).sort((a, b) => b[1] - a[1]).map(([label, n]) => ({ label, n }))
  return {
    questions: all.length,
    spend_usd: spend,
    budget_usd: budget,
    avg_cost_usd: costs.length ? spend / costs.length : null,
    pilots_with_questions: perPilot.length,
    active_pilots_7d: perPilot.filter(p => p.last_used && Date.parse(p.last_used) >= week).length,
    returning_pilots: perPilot.filter(p => p.active_days >= 2).length,
    conversations: convSizes.length,
    questions_per_conversation: convSizes.length ? all.length / convSizes.length : null,
    conversations_with_followups: convSizes.filter(n => n >= 2).length,
    thumbs_up: all.filter(r => r.rating === 1).length,
    thumbs_down: all.filter(r => r.rating === -1).length,
    median_ms: median(ms),
    p90_ms: pct(ms, 0.9),
    by_day: [...byDay.entries()].map(([day, d]) => ({ day, questions: d.questions, pilots: d.pilots.size, cost_usd: d.cost })),
    status: sortDesc(status),
    sources: sortDesc(sources),
    topics: sortDesc(topics),
    per_pilot: perPilot,
  }
}
