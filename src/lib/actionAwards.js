/**
 * actionAwards — small awards a college gives for an ACTION a family can take:
 * a campus visit, filing the FAFSA, a referral, applying by a date, or going to
 * an event (Chad, 2026-10-15: "Capital took $1,000 off for a visit"; Damon:
 * build it for Ohio now).
 *
 * The rows come from public.college_action_awards (pipeline
 * out_sql/31_college_action_awards.sql): curated from each college's own
 * website, with the page, the date checked and the entry year the page states.
 * A college that was checked and publishes none has one 'none_found' row, so
 * "checked, nothing published" is told apart from "not checked yet".
 *
 * Pure: no React, no Supabase. Used by api/ask.js (action_awards, and the
 * awards lines on find_programs, program_profile and call_prep_facts) and by
 * the Campus and cost card. Tested by test/actionAwards.test.mjs.
 */

/** Which colleges have been checked so far, in words. Widen as states are added. */
export const AWARDS_SCOPE = 'Ohio colleges with NCAA Division II, Division III or NAIA soccer'
export const AWARDS_NOTE = 'From each college\'s own website. Amounts and deadlines change every year, so confirm with the admissions office before relying on one.'

export const TYPE_LABEL = {
  visit: 'Campus visit award',
  fafsa: 'FAFSA filing award',
  referral: 'Referral award',
  apply_by: 'Apply-by-date award',
  event: 'Event award',
}
const TYPE_ORDER = { visit: 0, apply_by: 1, fafsa: 2, event: 3, referral: 4 }
const SOON_DAYS = 30

const num = x => (x == null || x === '' || isNaN(Number(x)) ? null : Number(x))
const day = x => (x ? String(x).slice(0, 10) : null)

/** One table row, with numbers as numbers and dates as YYYY-MM-DD. */
export function normalizeAward(r) {
  return {
    unitid: num(r.unitid),
    type: r.award_type,
    name: r.name || null,
    amount: num(r.amount),
    per_year: r.per_year == null ? null : !!r.per_year,
    amount_total: num(r.amount_total),
    amount_text: r.amount_text || null,
    condition: r.condition_text || null,
    deadline: day(r.deadline),
    deadline_text: r.deadline_text || null,
    entry_year: num(r.entry_year),
    url: r.url || null,
    checked: day(r.checked),
    confidence: r.confidence || null,
  }
}

/** Days from today (YYYY-MM-DD) to a date (YYYY-MM-DD); negative once passed. */
export function daysUntil(date, today) {
  if (!date || !today) return null
  return Math.round((Date.parse(date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000)
}

/** 'none' (no deadline), 'passed', 'soon' (within 30 days) or 'open'. */
export function deadlineStatus(a, today) {
  const d = daysUntil(a.deadline, today)
  if (d == null) return 'none'
  if (d < 0) return 'passed'
  return d <= SOON_DAYS ? 'soon' : 'open'
}

/** Awards first by type (visit first), then by the larger yearly amount. */
function order(x, y) {
  return (TYPE_ORDER[x.type] ?? 9) - (TYPE_ORDER[y.type] ?? 9) ||
    yearly(y) - yearly(x) || String(x.name).localeCompare(String(y.name))
}
const yearly = a => (a.amount == null ? 0 : a.per_year === false ? a.amount / 4 : a.amount)

/** Every row grouped by college: Map unitid -> [normalized rows]. */
export function awardsByUnit(rows) {
  const m = new Map()
  for (const r of rows || []) {
    const a = normalizeAward(r)
    if (a.unitid == null) continue
    if (!m.has(a.unitid)) m.set(a.unitid, [])
    m.get(a.unitid).push(a)
  }
  for (const list of m.values()) list.sort(order)
  return m
}

/**
 * One college's awards for display or the assistant:
 * { checked: false } when PitchSide has not checked it, else
 * { checked: true, checked_on, nothing_published, awards: [...] } with each
 * award's deadline status. Pass types to keep only some kinds.
 */
export function collegeAwards(list, today, types = null) {
  if (!list || !list.length) return { checked: false }
  const keep = list.filter(a => a.type !== 'none_found' && (!types || types.includes(a.type)))
  const checked_on = list.map(a => a.checked).filter(Boolean).sort().pop() || null
  return {
    checked: true,
    checked_on,
    nothing_published: keep.length === 0,
    awards: keep.map(a => ({ ...a, label: TYPE_LABEL[a.type] || a.type, status: deadlineStatus(a, today) })),
  }
}

/** A short line: "Campus visit award: $2,000 a year ($8,000 over four years); visit by Dec 5, 2026". */
export function shortLine(a, today) {
  const st = deadlineStatus(a, today)
  let s = `${TYPE_LABEL[a.type] || a.type}: ${a.amount_text || a.name}`
  if (st !== 'none' && a.deadline_text) s += `; ${a.deadline_text.charAt(0).toLowerCase()}${a.deadline_text.slice(1)}`
  if (st === 'passed') s += ' (passed)'
  return s
}

/** The headline figure for a card: "$2,000/yr", "$1,000", or "—". */
export function cardValue(a) {
  if (!a || a.amount == null) return '—'
  const $ = '$' + Math.round(a.amount).toLocaleString('en-US')
  return a.per_year ? `${$}/yr` : $
}

/**
 * Deadlines still ahead across several colleges, soonest first:
 * [{ school, label, name, amount_text, deadline, deadline_text, days_left }].
 * items: [{ school, awards }] where awards come from collegeAwards.
 */
export function upcomingDeadlines(items, today, limit = 8) {
  const out = []
  for (const { school, awards } of items) {
    for (const a of awards || []) {
      const d = daysUntil(a.deadline, today)
      if (d == null || d < 0) continue
      out.push({ school, label: a.label || TYPE_LABEL[a.type], name: a.name, amount_text: a.amount_text, deadline: a.deadline, deadline_text: a.deadline_text, days_left: d })
    }
  }
  out.sort((x, y) => x.deadline.localeCompare(y.deadline) || String(x.school).localeCompare(String(y.school)))
  return out.slice(0, limit)
}
