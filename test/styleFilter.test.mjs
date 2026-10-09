/**
 * Tests for src/lib/styleFilter.js (Find programs recruiting style filters,
 * backlog G8 follow-up). Plain node, no deps. Exit code is the verdict.
 *
 *     npm test          (or: node test/styleFilter.test.mjs)
 */
import { STYLE_OPTIONS, styleMap, toggleStyle, matchesStyles, styleReason } from '../src/lib/styleFilter.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

check('six options with the card wording', STYLE_OPTIONS.length === 6 &&
  STYLE_OPTIONS.map(o => o.label).join('|') ===
  'Builds through freshmen|Leans on transfers|Recruits heavily in-state|Recruits mostly out of state|International lean|Stable roster',
  STYLE_OPTIONS.map(o => o.label).join('|'))

let sel = new Set()
sel = toggleStyle(sel, 'freshmen')
check('pick one', sel.has('freshmen') && sel.size === 1)
sel = toggleStyle(sel, 'transfers')
check('opposite clears it', sel.has('transfers') && !sel.has('freshmen') && sel.size === 1)
sel = toggleStyle(sel, 'stable')
check('other dimensions combine', sel.has('transfers') && sel.has('stable') && sel.size === 2)
sel = toggleStyle(sel, 'stable')
check('pick again to clear', !sel.has('stable') && sel.size === 1)
check('unknown key ignored', toggleStyle(new Set(['intl']), 'nope').size === 1)

const a = { school_id: 'a', build_band: 'low', reach_band: 'high', abroad_band: 'typical', stability_band: 'high' }
const b = { school_id: 'b', build_band: 'high', reach_band: null, abroad_band: 'high', stability_band: 'low' }
const m = styleMap([a, b])
check('map by school', m.get('a') === a && m.get('b') === b && m.size === 2)
check('nothing picked keeps all', matchesStyles(a, new Set()) && matchesStyles(undefined, new Set()))
check('AND across picks', matchesStyles(a, new Set(['freshmen', 'stable'])) && !matchesStyles(a, new Set(['freshmen', 'intl'])))
check('no band for a picked dimension drops out', !matchesStyles(b, new Set(['instate'])) && !matchesStyles(b, new Set(['outofstate'])))
check('no style row drops out when filtering', !matchesStyles(undefined, new Set(['stable'])))

check('reason lists the marked bands in card order',
  styleReason(a, 'NCAA D1') === 'Recruiting style (against other NCAA D1 programs): Builds through freshmen · Recruits heavily in-state · Stable roster.',
  styleReason(a, 'NCAA D1'))
check('reason includes mostly domestic and high turnover',
  styleReason({ build_band: 'typical', reach_band: 'typical', abroad_band: 'low', stability_band: 'low' }, 'NAIA') ===
  'Recruiting style (against other NAIA programs): Mostly domestic · High turnover.')
check('all typical -> no line', styleReason({ build_band: 'typical', reach_band: 'typical', abroad_band: null, stability_band: 'typical' }, 'NCAA D2') === null)
check('no row -> no line', styleReason(null, 'NCAA D1') === null)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
