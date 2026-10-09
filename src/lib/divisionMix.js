/**
 * Division mix of the colleges whose coaches attended (backlog F14). Pure, no
 * network; tested by test/divisionMix.test.mjs.
 *
 * Counts COLLEGES, not coaches: three coaches from one school are one college.
 * A school row is a program, so the same college's men's and women's programs
 * would count twice, but an event summary only ever shows one team's gender.
 */

export const DIVISION_KEYS = [
  { key: 'D1', label: 'D1', name: 'Division I', match: 'NCAA D1', color: '#185FA5' },
  { key: 'D2', label: 'D2', name: 'Division II', match: 'NCAA D2', color: '#1D9E75' },
  { key: 'D3', label: 'D3', name: 'Division III', match: 'NCAA D3', color: '#BA7517' },
  { key: 'NAIA', label: 'NAIA', name: 'NAIA', match: 'NAIA', color: '#D85A30' },
  { key: 'JC', label: 'JC', name: 'Junior college', match: 'JC', color: '#888780' },
  { key: 'OTHER', label: 'Other', name: 'Other', match: null, color: '#B4B2A9' },
]

/** 'NCAA D1' -> 'D1'; anything unknown or missing -> 'OTHER'. */
export function divisionKey(division) {
  const d = String(division || '').trim().toUpperCase()
  const hit = DIVISION_KEYS.find(k => k.match && k.match.toUpperCase() === d)
  return hit ? hit.key : 'OTHER'
}

/**
 * schools: school objects ({ id, division }); duplicates by id count once.
 * Returns { total, parts: [{ key, label, name, color, count, share }] } with
 * only the divisions that have at least one college, in D1..JC, Other order.
 */
export function divisionMix(schools) {
  const seen = new Set()
  const counts = new Map()
  for (const s of schools || []) {
    if (!s || s.id == null || seen.has(s.id)) continue
    seen.add(s.id)
    const k = divisionKey(s.division)
    counts.set(k, (counts.get(k) || 0) + 1)
  }
  const total = seen.size
  const parts = DIVISION_KEYS
    .filter(d => counts.get(d.key))
    .map(d => ({ key: d.key, label: d.label, name: d.name, color: d.color,
                 count: counts.get(d.key), share: total ? counts.get(d.key) / total : 0 }))
  return { total, parts }
}

/** Does this school pass the chosen division chip? 'ALL' passes everything. */
export function inDivision(school, key) {
  return !key || key === 'ALL' || divisionKey(school?.division) === key
}
