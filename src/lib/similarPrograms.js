/**
 * similarPrograms — "More like this": programs like one a family already likes
 * (Columbus Goalkeeper Academy roadmap: "if you find a school you really like,
 * look at other schools in the same conference"; Damon 2026-10-15).
 *
 * Pure: no React, no Supabase. Used by api/ask.js (similar_programs).
 * Tested by test/similarPrograms.test.mjs.
 *
 * Candidates: the same men's / women's program and the same division.
 * Points, each with its reason in words:
 *   same conference 3; average SAT within 60 points 2 (within 120: 1);
 *   admission rate within 15 points 1; undergraduates between half and twice
 *   as many 1; net price within $8,000 a year 1; same public / private 1;
 *   same setting (city, suburb, town, rural) 0.5; campus within 300 miles 1.
 * Ties: closer campus first. A college with no Scorecard figures can still
 * match on conference and distance.
 */

const R = 3958.8
export function miles(a, b) {
  if (!a || !b || a.lat == null || b.lat == null) return null
  const t = x => (Number(x) * Math.PI) / 180
  const dLat = t(b.lat - a.lat), dLon = t(b.lon - a.lon)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(t(a.lat)) * Math.cos(t(b.lat)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

const num = v => (v == null || v === '' || Number.isNaN(Number(v)) ? null : Number(v))
const control = c => (Number(c) === 1 ? 'public' : Number(c) === 2 || Number(c) === 3 ? 'private' : null)
const setting = l => ({ 1: 'city', 2: 'suburb', 3: 'town', 4: 'rural' }[Math.floor(Number(l) / 10)] || null)
const pointOf = f => (f && f.latitude != null && f.longitude != null ? { lat: Number(f.latitude), lon: Number(f.longitude) } : null)

/**
 * target: { id, division, program_gender, conference }, targetFacts: College Scorecard row or null.
 * schools: [{ id, school, division, program_gender, conference, state }], factsOf: Map(id -> facts).
 * Returns up to `limit` rows: { school_id, school, division, conference, state, score, distance_miles, why }.
 */
export function similarPrograms(target, targetFacts, schools, factsOf, limit = 10) {
  const tf = targetFacts || null
  const tp = pointOf(tf)
  const out = []
  for (const s of schools || []) {
    if (s.id === target.id || s.program_gender !== target.program_gender || s.division !== target.division) continue
    const f = factsOf.get(s.id) || null
    let score = 0
    const why = []
    if (target.conference && s.conference === target.conference) { score += 3; why.push(`same conference (${s.conference})`) }
    const sat = num(f?.sat_average), tsat = num(tf?.sat_average)
    if (sat != null && tsat != null) {
      const d = Math.abs(sat - tsat)
      if (d <= 60) { score += 2; why.push(`average SAT ${sat} (vs ${tsat})`) } else if (d <= 120) { score += 1; why.push(`average SAT ${sat} (vs ${tsat})`) }
    }
    const adm = num(f?.admission_rate), tadm = num(tf?.admission_rate)
    if (adm != null && tadm != null && Math.abs(adm - tadm) <= 0.15) { score += 1; why.push(`admits ${Math.round(adm * 100)}% (vs ${Math.round(tadm * 100)}%)`) }
    const ug = num(f?.undergrad_enrollment), tug = num(tf?.undergrad_enrollment)
    if (ug && tug && ug >= tug / 2 && ug <= tug * 2) { score += 1; why.push(`${ug.toLocaleString('en-US')} undergraduates`) }
    const np = num(f?.avg_net_price), tnp = num(tf?.avg_net_price)
    if (np != null && tnp != null && Math.abs(np - tnp) <= 8000) { score += 1; why.push(`net price $${Math.round(np).toLocaleString('en-US')} a year`) }
    if (control(f?.control) && control(f?.control) === control(tf?.control)) { score += 1; why.push(control(f.control)) }
    if (setting(f?.locale) && setting(f?.locale) === setting(tf?.locale)) { score += 0.5; why.push(`${setting(f.locale)} setting`) }
    const dist = miles(tp, pointOf(f))
    if (dist != null && dist <= 300) { score += 1; why.push(`${Math.round(dist)} miles from it`) }
    if (score < 2) continue
    out.push({ school_id: s.id, school: s.school, division: s.division, conference: s.conference, state: s.state,
      score, distance_miles: dist != null ? Math.round(dist) : null, why: why.join('; ') })
  }
  return out.sort((a, b) => b.score - a.score || (a.distance_miles ?? 1e9) - (b.distance_miles ?? 1e9)).slice(0, limit)
}
