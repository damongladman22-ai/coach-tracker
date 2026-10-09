/**
 * Find programs — the major filter (Damon 2026-10-09: "adding a criteria for
 * major would be good"; chosen: a specific major, with search). Pure; tested
 * by test/majorFilter.test.mjs.
 *
 * DATA (College Scorecard, loaded for the Campus and cost card, backlog F8)
 *   college_major_catalog   one row per 4-digit CIP major, with how many
 *                           soccer colleges offer it (pipeline
 *                           out_sql/19_college_major_catalog.sql)
 *   college_majors          the majors each federal college graduated
 *                           students in over the two most recent award years
 *   school_federal_college  program -> federal college
 *
 * RULES
 *  - A choice is one major ('5138' Registered Nursing...) or a whole area
 *    ('51' Health professions, any major).
 *  - A four-year program counts only bachelor's degrees. A junior college
 *    (division 'JC') counts associate degrees too, since that is what a
 *    two-year college awards.
 *  - Like division and state, it is a hard filter: a program whose college
 *    does not offer the choice drops out, and so does a program with no
 *    federal college on file (joint teams, Canadian schools).
 */

const BACHELORS = 3
const ASSOCIATE = 2

function words(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().split(' ').filter(Boolean)
}

/** Every query word is the start of some word in the text. */
function matches(qWords, text) {
  const w = words(text)
  return qWords.every(q => w.some(x => x.startsWith(q)))
}

/**
 * Catalog rows from the view -> { majors, areas }.
 *   majors: { kind:'major', code, label, area, colleges, associate }
 *           colleges / associate = soccer colleges offering it as a
 *           bachelor's / associate degree
 *   areas:  { kind:'area', code, label, colleges } — colleges is the largest
 *           single-major count in the area (a floor, never an overstatement)
 */
export function buildCatalog(rows) {
  const majors = []
  const areas = new Map()
  for (const r of rows || []) {
    const colleges = Number(r.colleges_bachelors) || 0
    const associate = Number(r.colleges_associate) || 0
    majors.push({ kind: 'major', code: r.cip_code, label: r.title, area: r.family_title, colleges, associate })
    const a = areas.get(r.family_code) || { kind: 'area', code: r.family_code, label: r.family_title, colleges: 0 }
    a.colleges = Math.max(a.colleges, colleges)
    areas.set(r.family_code, a)
  }
  majors.sort((a, b) => b.colleges - a.colleges || a.label.localeCompare(b.label))
  return { majors, areas: [...areas.values()].sort((a, b) => a.label.localeCompare(b.label)) }
}

/**
 * Suggestions for what the player typed: up to 2 areas ("Engineering, any
 * major") then majors. A major whose title starts with the words typed comes
 * first; otherwise the most widely offered first.
 */
export function searchMajors(catalog, query, limit = 8) {
  const q = words(query)
  if (!q.length || !catalog) return []
  const phrase = q.join(' ')
  const areas = catalog.areas.filter(a => matches(q, a.label)).slice(0, 2)
  const majors = catalog.majors
    .filter(m => matches(q, m.label))
    .map(m => ({ m, starts: words(m.label).join(' ').startsWith(phrase) ? 0 : 1 }))
    .sort((a, b) => a.starts - b.starts || b.m.colleges - a.m.colleges || a.m.label.localeCompare(b.m.label))
    .map(x => x.m)
  return [...areas, ...majors].slice(0, limit)
}

/**
 * Who offers the choice.
 *   links       [{ school_id, unitid }]
 *   majorRows   college_majors rows for the choice:
 *               [{ unitid, cip_code, title, credential_level, graduates_2yr }]
 * Returns Map(school_id -> { bachelors: [...], associate: [...] }), each list
 * [{ code, title, graduates }] most graduates first.
 */
export function offeringsBySchool(links, majorRows) {
  const byUnit = new Map()
  for (const r of majorRows || []) {
    const u = Number(r.unitid)
    const lvl = Number(r.credential_level)
    if (lvl !== BACHELORS && lvl !== ASSOCIATE) continue
    const o = byUnit.get(u) || { bachelors: [], associate: [] }
    ;(lvl === BACHELORS ? o.bachelors : o.associate).push({
      code: r.cip_code, title: r.title, graduates: r.graduates_2yr == null ? null : Number(r.graduates_2yr),
    })
    byUnit.set(u, o)
  }
  for (const o of byUnit.values()) {
    o.bachelors.sort((a, b) => (b.graduates || 0) - (a.graduates || 0))
    o.associate.sort((a, b) => (b.graduates || 0) - (a.graduates || 0))
  }
  const out = new Map()
  for (const l of links || []) {
    const o = byUnit.get(Number(l.unitid))
    if (o) out.set(l.school_id, o)
  }
  return out
}

/**
 * What counts for this program: bachelor's for a four-year program; at a
 * junior college, associate degrees too. Returns
 *   { level: 'bachelors' | 'associate' | 'both', list, graduates } or null.
 */
export function offeringFor(offerings, schoolId, division) {
  const o = offerings && offerings.get(schoolId)
  if (!o) return null
  const jc = division === 'JC'
  const list = jc ? [...o.associate, ...o.bachelors] : o.bachelors
  if (!list.length) return null
  const level = !jc ? 'bachelors'
    : (o.associate.length && o.bachelors.length ? 'both' : o.associate.length ? 'associate' : 'bachelors')
  const graduates = list.reduce((s, m) => s + (m.graduates || 0), 0)
  return { level, list, graduates }
}

const LEVEL_WORDS = { bachelors: 'bachelor’s', associate: 'associate degree', both: 'associate and bachelor’s' }

/** The reason line under a result row. */
export function majorReason(offer, choice) {
  if (!offer || !choice) return null
  const lvl = LEVEL_WORDS[offer.level]
  const g = offer.graduates
  const grads = g > 0 ? `; ${g.toLocaleString('en-US')} ${g === 1 ? 'graduate' : 'graduates'} in the last two years` : ''
  if (choice.kind === 'major') {
    return `Offers ${choice.label} (${lvl}${grads}).`
  }
  const titles = [...new Set(offer.list.map(m => m.title))]
  const n = titles.length
  return `Offers ${n} ${choice.label} ${n === 1 ? 'major' : 'majors'} (${lvl}), including ${titles[0]}.`
}

/** Short label for the chosen major or area. */
export function choiceLabel(choice) {
  if (!choice) return ''
  return choice.kind === 'area' ? `${choice.label} (any major)` : choice.label
}
