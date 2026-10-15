/**
 * fitTier — Reach / Good fit / Safety for one program and one player
 * (recruiting resources review 2026-10-15, item 2; Damon: athletic fit from the
 * level the family is aiming for plus the program's strength in its division,
 * shown in Ask PitchSide and on Find programs).
 *
 * Pure: no React, no Supabase. Used by api/ask.js (find_programs) and
 * src/pages/FindPrograms.jsx. Tested by test/fitTier.test.mjs.
 *
 * The idea comes from club recruiting guidance: build a list with some
 * REACH schools (high academic bar or low admission rate, very competitive
 * program), many GOOD FIT schools, and some SAFETY schools (confident of
 * admission, and a player expects to make a big impact on the field).
 *
 * ACADEMIC (from the U.S. College Scorecard)
 *  - With the player's SAT (an ACT is converted with ACT_TO_SAT):
 *      reach  : the college's average SAT is 80 or more above the player's,
 *               or it admits under 25% of applicants;
 *      safety : its average SAT is 80 or more below the player's and it
 *               admits at least half (or, with no SAT published, admits 80%+);
 *      good   : otherwise.
 *  - Without a score: reach under 30% admitted, safety 80%+ admitted, else good.
 *  - No published figures: no academic label.
 *
 * ATHLETIC (the level the family is aiming for, and the program's strength)
 *  - Levels, highest first: NCAA D1, then NCAA D2 and NAIA, then NCAA D3,
 *    then junior college. The target is the set of levels the family named.
 *  - A program above the highest target level is a reach; below the lowest,
 *    a safety.
 *  - Within the target: strength is the program's place among programs of
 *    its own division and gender, 0 (weakest) to 1 (strongest): D-I by RPI
 *    rank, otherwise by win percentage over the latest two seasons (at least
 *    MIN_GAMES games). With one target level: top quarter reach, bottom
 *    quarter safety. With several: at the top level, the stronger half is a
 *    reach; at the bottom level, the weaker half is a safety. No results
 *    (NAIA and junior colleges are not covered): good fit.
 *  - Openings: under half an estimated freshman opening at the position moves
 *    the label one step toward reach (safety to good, good to reach).
 *  - No target level ("any level"): no athletic label.
 *
 * OVERALL
 *  - Reach if either side is a reach.
 *  - Safety if the athletic side is a safety and the academic side is a
 *    safety, or a good fit at a college admitting 60%+, or has no figures.
 *  - With no athletic label, the academic label alone.
 *  - Otherwise good fit. Every label comes with its reasons in plain words.
 */

export const MIN_GAMES = 5

// Highest first. NAIA sits with NCAA D2 (both offer partial athletic aid).
export const DIV_RANK = { 'NCAA D1': 4, 'NCAA D2': 3, NAIA: 3, 'NCAA D3': 2, JC: 1 }

export const ACT_TO_SAT = {
  36: 1590, 35: 1540, 34: 1500, 33: 1460, 32: 1430, 31: 1400, 30: 1370, 29: 1340, 28: 1310, 27: 1280, 26: 1240,
  25: 1210, 24: 1180, 23: 1140, 22: 1110, 21: 1080, 20: 1040, 19: 1010, 18: 970, 17: 930, 16: 890, 15: 850,
  14: 800, 13: 760, 12: 710, 11: 670, 10: 630, 9: 590,
}

export const TIER_LABEL = { reach: 'Reach', good: 'Good fit', safety: 'Safety' }

const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))

/** A test score as an SAT total: 400 to 1600 as is, 1 to 36 read as an ACT composite. */
export function satEquivalent(score, test = null) {
  const n = num(score)
  if (n == null) return null
  if (test === 'ACT' || (test == null && n >= 1 && n <= 36)) return ACT_TO_SAT[Math.round(n)] ?? null
  return n >= 400 && n <= 1600 ? Math.round(n) : null
}

/** 'NCAA D1' -> 'D1' for reasons. */
const shortDiv = d => String(d || '').replace(/^NCAA /, '')

/**
 * program_results rows -> Map(school_id -> { pct, basis }).
 *   rows: { school_id, season, wins, losses, ties, rpi_rank }, the latest two
 *         seasons (others are ignored).
 *   programOf: Map(school_id -> { division, gender }) from schools, so each
 *         program is compared with its own division and gender.
 */
export function strengthIndex(rows, programOf) {
  const seasons = [...new Set((rows || []).map(r => num(r.season)).filter(s => s != null))].sort((a, b) => b - a).slice(0, 2)
  const keep = new Set(seasons)
  const per = new Map()
  for (const r of rows || []) {
    const season = num(r.season)
    if (!keep.has(season)) continue
    const p = per.get(r.school_id) || { w: 0, g: 0, rpi: null, rpiSeason: null }
    const w = num(r.wins) || 0, l = num(r.losses) || 0, t = num(r.ties) || 0
    p.w += w + t / 2
    p.g += w + l + t
    // RPI from the newest season with enough games played.
    const rpi = num(r.rpi_rank)
    if (rpi != null && w + l + t >= MIN_GAMES && (p.rpiSeason == null || season > p.rpiSeason)) { p.rpi = rpi; p.rpiSeason = season }
    per.set(r.school_id, p)
  }
  // Groups: division + gender.
  const groups = new Map()
  for (const [id, p] of per) {
    const prog = programOf.get(id)
    if (!prog?.division) continue
    const k = prog.division + '|' + (prog.gender || '')
    if (!groups.has(k)) groups.set(k, [])
    groups.get(k).push({ id, p })
  }
  const out = new Map()
  const place = (list, val, higherIsBetter, basis) => {
    const xs = list.filter(x => val(x) != null)
    if (xs.length < 10) return
    const sorted = xs.map(val).sort((a, b) => a - b)
    for (const x of xs) {
      const v = val(x)
      // Share of peers this program beats (ties count half), 0..1.
      let below = 0, same = 0
      for (const s of sorted) { if (s < v) below++; else if (s === v) same++ }
      let pct = (below + (same - 1) / 2) / Math.max(1, sorted.length - 1)
      if (!higherIsBetter) pct = 1 - pct
      if (!out.has(x.id)) out.set(x.id, { pct: Math.round(pct * 100) / 100, basis })
    }
  }
  for (const list of groups.values()) {
    place(list, x => x.p.rpi, false, 'RPI')
    place(list, x => (x.p.g >= MIN_GAMES ? x.p.w / x.p.g : null), true, 'record')
  }
  return out
}

/** Academic side: { tier, why } or null. f: { sat_average, admission_rate }. */
export function academicFit(f, studentSat) {
  const sat = num(f?.sat_average), adm = num(f?.admission_rate)
  const admitted = adm != null ? `admits ${Math.round(adm * 100)}%` : null
  if (studentSat != null && sat != null) {
    const diff = sat - studentSat
    const satWords = diff >= 0 ? `average SAT ${sat}, ${diff} above yours` : `average SAT ${sat}, ${-diff} below yours`
    if (diff >= 80 || (adm != null && adm < 0.25)) return { tier: 'reach', why: [satWords, admitted].filter(Boolean).join(', ') }
    if (diff <= -80 && (adm == null || adm >= 0.5)) return { tier: 'safety', why: [satWords, admitted].filter(Boolean).join(', ') }
    return { tier: 'good', why: [satWords, admitted].filter(Boolean).join(', ') }
  }
  if (adm == null) return null
  const limit = studentSat != null ? 0.25 : 0.3
  if (adm < limit) return { tier: 'reach', why: admitted }
  if (adm >= 0.8) return { tier: 'safety', why: admitted }
  return { tier: 'good', why: admitted }
}

const STEP_UP = { safety: 'good', good: 'reach', reach: 'reach' }

/**
 * Athletic side: { tier, why } or null.
 *   division: schools.division ('NCAA D1', …); strength: { pct, basis } or null;
 *   targets: divisions aimed for (array), empty or null = any level;
 *   estFreshman: estimated freshman openings at the position, or null.
 */
export function athleticFit(division, strength, targets, estFreshman = null, gender = null) {
  const ranks = (targets || []).map(d => DIV_RANK[d]).filter(Boolean)
  const r = DIV_RANK[division]
  if (!ranks.length || !r) return null
  const hi = Math.max(...ranks), lo = Math.min(...ranks)
  const d = shortDiv(division)
  const group = `${d}${gender === 'W' ? ' women' : gender === 'M' ? ' men' : ''}`
  let tier, why
  if (r > hi) { tier = 'reach'; why = `${d} is above the level you are aiming for` }
  else if (r < lo) { tier = 'safety'; why = `${d} is below the level you are aiming for` }
  else if (!strength) { tier = 'good'; why = `${d}, no results data to place it within the division` }
  else {
    const p = strength.pct
    const by = strength.basis === 'RPI' ? 'by RPI' : 'by record'
    const where = p >= 0.75 ? `top quarter of ${group} ${by}`
      : p >= 0.5 ? `upper half of ${group} ${by}`
        : p > 0.25 ? `lower half of ${group} ${by}` : `bottom quarter of ${group} ${by}`
    if (hi === lo) tier = p >= 0.75 ? 'reach' : p <= 0.25 ? 'safety' : 'good'
    else if (r === hi) tier = p >= 0.5 ? 'reach' : 'good'
    else if (r === lo) tier = p < 0.5 ? 'safety' : 'good'
    else tier = 'good'
    why = where
  }
  const open = num(estFreshman)
  if (open != null && open < 0.5 && tier !== 'reach') {
    tier = STEP_UP[tier]
    why += '; under one estimated freshman opening at your position'
  }
  return { tier, why }
}

/**
 * The label for one program: { tier, label, why: [..], academic, athletic } or null.
 *   p: { division, gender, sat_average, admission_rate, est_freshman }
 *   player: { sat (SAT total or null), targets (divisions or null) }
 */
export function fitFor(p, strength, player) {
  const a = academicFit(p, player?.sat ?? null)
  const b = athleticFit(p.division, strength, player?.targets, p.est_freshman, p.gender)
  if (!a && !b) return null
  let tier
  if (a?.tier === 'reach' || b?.tier === 'reach') tier = 'reach'
  else if (!b) tier = a.tier
  else if (b.tier === 'safety' && (!a || a.tier === 'safety' || (a.tier === 'good' && num(p.admission_rate) >= 0.6))) tier = 'safety'
  else tier = 'good'
  const why = []
  if (b) why.push(`Athletic ${TIER_LABEL[b.tier].toLowerCase()}: ${b.why}`)
  if (a) why.push(`Academic ${TIER_LABEL[a.tier].toLowerCase()}: ${a.why}`)
  return { tier, label: TIER_LABEL[tier], why, academic: a?.tier ?? null, athletic: b?.tier ?? null }
}

/** Counts per tier: { reach, good, safety }. */
export function tierCounts(fits) {
  const c = { reach: 0, good: 0, safety: 0 }
  for (const f of fits || []) if (f && c[f.tier] != null) c[f.tier]++
  return c
}
