/**
 * Tests for src/lib/majorFilter.js (Find programs major filter). Plain node,
 * no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/majorFilter.test.mjs)
 */
import {
  buildCatalog, searchMajors, offeringsBySchool, offeringFor, majorReason, choiceLabel,
} from '../src/lib/majorFilter.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

// Catalog rows as the view returns them (counts may arrive as strings)
const cat = buildCatalog([
  { cip_code: '5138', title: 'Registered Nursing, Nursing Administration, Nursing Research and Clinical Nursing', family_code: '51', family_title: 'Health professions', colleges_bachelors: '612', colleges_associate: '140' },
  { cip_code: '5139', title: 'Practical Nursing, Vocational Nursing and Nursing Assistants', family_code: '51', family_title: 'Health professions', colleges_bachelors: '3', colleges_associate: '40' },
  { cip_code: '3105', title: 'Sports, Kinesiology, and Physical Education/Fitness', family_code: '31', family_title: 'Parks, recreation, fitness and kinesiology', colleges_bachelors: '700', colleges_associate: '90' },
  { cip_code: '1419', title: 'Mechanical Engineering', family_code: '14', family_title: 'Engineering', colleges_bachelors: '300', colleges_associate: '0' },
  { cip_code: '1408', title: 'Civil Engineering', family_code: '14', family_title: 'Engineering', colleges_bachelors: '250', colleges_associate: '0' },
  { cip_code: '5202', title: 'Business Administration, Management and Operations', family_code: '52', family_title: 'Business, management and marketing', colleges_bachelors: '1200', colleges_associate: '400' },
])
check('catalog: majors and areas', cat.majors.length === 6 && cat.areas.length === 4)
check('catalog: counts are numbers', cat.majors.find(m => m.code === '5138').colleges === 612)
check('catalog: area count is the largest single major', cat.areas.find(a => a.code === '14').colleges === 300)

const codes = list => list.map(x => (x.kind === 'area' ? 'A' : '') + x.code).join(',')
check('search: word starts, case-insensitive', codes(searchMajors(cat, 'NURS')) === '5138,5139', codes(searchMajors(cat, 'NURS')))
check('search: middle words count', codes(searchMajors(cat, 'kines')) === 'A31,3105', codes(searchMajors(cat, 'kines')))
check('search: area first, then majors by reach', codes(searchMajors(cat, 'engineering')) === 'A14,1419,1408',
  codes(searchMajors(cat, 'engineering')))
check('search: title starting with the words comes first', codes(searchMajors(cat, 'civil eng')) === '1408')
check('search: every word must match', codes(searchMajors(cat, 'nursing practical')) === '5139')
check('search: not inside a word', searchMajors(cat, 'ursing').length === 0)
check('search: empty query, nothing', searchMajors(cat, '  ').length === 0 && searchMajors(null, 'x').length === 0)
check('search: limit', searchMajors(cat, 'e', 2).length === 2)

// Offerings
const links = [
  { school_id: 'osu', unitid: 204796 }, { school_id: 'osu-m', unitid: 204796 },
  { school_id: 'jc', unitid: 100 }, { school_id: 'none', unitid: 999 },
]
const rows = [
  { unitid: '204796', cip_code: '5138', title: 'Registered Nursing', credential_level: '3', graduates_2yr: '1100' },
  { unitid: '204796', cip_code: '5138', title: 'Registered Nursing', credential_level: '2', graduates_2yr: '10' },
  { unitid: '100', cip_code: '5138', title: 'Registered Nursing', credential_level: '2', graduates_2yr: '80' },
]
const off = offeringsBySchool(links, rows)
check('men and women share a college', off.has('osu') && off.has('osu-m'))
check('college without the major is absent', !off.has('none'))
const four = offeringFor(off, 'osu', 'NCAA D1')
check('four-year counts bachelor’s only', four.level === 'bachelors' && four.graduates === 1100, JSON.stringify(four))
check('four-year with associate only: not offered', offeringFor(off, 'jc', 'NCAA D3') === null)
const jc = offeringFor(off, 'jc', 'JC')
check('junior college counts associate', jc.level === 'associate' && jc.graduates === 80)
check('unlinked program: not offered', offeringFor(off, 'nobody', 'NCAA D1') === null && offeringFor(null, 'osu', 'NCAA D1') === null)

const nursing = { kind: 'major', code: '5138', label: 'Registered Nursing' }
check('reason: one major', majorReason(four, nursing) === 'Offers Registered Nursing (bachelor’s; 1,100 graduates in the last two years).',
  majorReason(four, nursing))
check('reason: associate', majorReason(jc, nursing).startsWith('Offers Registered Nursing (associate degree; 80 graduates'))
const eng = offeringsBySchool([{ school_id: 's', unitid: 1 }], [
  { unitid: 1, cip_code: '1408', title: 'Civil Engineering', credential_level: 3, graduates_2yr: 40 },
  { unitid: 1, cip_code: '1419', title: 'Mechanical Engineering', credential_level: 3, graduates_2yr: 90 },
])
const area = { kind: 'area', code: '14', label: 'Engineering' }
check('reason: area names the biggest major', majorReason(offeringFor(eng, 's', 'NCAA D1'), area) ===
  'Offers 2 Engineering majors (bachelor’s), including Mechanical Engineering.', majorReason(offeringFor(eng, 's', 'NCAA D1'), area))
check('reason: none', majorReason(null, nursing) === null)
check('labels', choiceLabel(area) === 'Engineering (any major)' && choiceLabel(nursing) === 'Registered Nursing' && choiceLabel(null) === '')

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
