/**
 * Find programs — recruiting style filters (backlog G8 follow-up, Damon
 * 2026-10-09: "do the small follow up"). Pure; tested by
 * test/styleFilter.test.mjs.
 *
 * DATA: program_recruiting_style (pipeline out_sql/21), one row per program
 * with a band per dimension ('low' | 'typical' | 'high' | null), read against
 * the program's own division and men's / women's: the College Profile
 * "Recruiting style" card's default peer group. The pipeline computes every
 * value exactly as the card does (parity checked on all 2,774 programs).
 *
 * RULES
 *  - Each option is one band of one dimension. Options in the same dimension
 *    are opposites, so picking one clears the other (toggleStyle).
 *  - Picked options are hard filters, like division and state, combined with
 *    AND. A program with no style row, or no band for a picked dimension
 *    (too little data), drops out.
 *  - The wording is the card's own (LABELS in recruitingStyle.js).
 */
import { LABELS } from '../college-profiles/data/recruitingStyle.js'

const DIM_COL = { build: 'build_band', reach: 'reach_band', abroad: 'abroad_band', stability: 'stability_band' }

export const STYLE_OPTIONS = [
  { key: 'freshmen', dim: 'build', band: 'low' },
  { key: 'transfers', dim: 'build', band: 'high' },
  { key: 'instate', dim: 'reach', band: 'high' },
  { key: 'outofstate', dim: 'reach', band: 'low' },
  { key: 'intl', dim: 'abroad', band: 'high' },
  { key: 'stable', dim: 'stability', band: 'high' },
].map(o => ({ ...o, label: LABELS[o.dim][o.band] }))

const OPT = Object.fromEntries(STYLE_OPTIONS.map(o => [o.key, o]))

/** Style rows -> Map(school_id -> row). */
export function styleMap(rows) {
  const m = new Map()
  for (const r of rows || []) m.set(r.school_id, r)
  return m
}

/** New selection after clicking an option: on/off, clearing its opposite. */
export function toggleStyle(selected, key) {
  const next = new Set(selected)
  if (next.has(key)) { next.delete(key); return next }
  const o = OPT[key]
  if (!o) return next
  for (const k of [...next]) if (OPT[k]?.dim === o.dim) next.delete(k)
  next.add(key)
  return next
}

/** True when the program has every picked style. */
export function matchesStyles(styleRow, selected) {
  if (!selected || selected.size === 0) return true
  if (!styleRow) return false
  for (const k of selected) {
    const o = OPT[k]
    if (!o || styleRow[DIM_COL[o.dim]] !== o.band) return false
  }
  return true
}

/**
 * The reason line: every non-typical band, in card order, or null when the
 * program is typical (or unknown) on all four.
 */
export function styleReason(styleRow, division) {
  if (!styleRow) return null
  const parts = []
  for (const dim of ['build', 'reach', 'abroad', 'stability']) {
    const b = styleRow[DIM_COL[dim]]
    if (b === 'high' || b === 'low') parts.push(LABELS[dim][b])
  }
  if (!parts.length) return null
  return `Recruiting style${division ? ` (against other ${division} programs)` : ''}: ${parts.join(' · ')}.`
}
