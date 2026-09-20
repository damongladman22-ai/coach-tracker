/**
 * Tests for src/lib/resolveSchool.js — plain node, no test runner, no deps.
 *
 *     npm test          (or: node test/resolveSchool.test.mjs)
 *
 * WHAT THESE GUARD
 * ----------------
 * Not "does it find the right school" — schoolMatch.test.mjs covers the
 * scoring. These guard the two properties a RESOLVER has and a search filter
 * must not: it refuses when the name does not identify exactly one school, and
 * it has no fallback tier that invents an answer.
 *
 * Every assertion that expects `null` is load-bearing. The resolver this
 * replaced returned a school for all 9,601 full-name variants it was measured
 * on, including the ones that named three schools equally well; a regression
 * here does not fail loudly, it silently imports coaches against the wrong
 * school.
 */
import { resolveSchool, canon, stripProgramNoise } from '../src/lib/resolveSchool.js';
import { setAliasIndex } from '../src/lib/schoolMatch.js';

const NAMES = [
  'Abilene Christian University',
  'Auburn University',
  'Auburn University – Montgomery',
  'Bethel University – Indiana',
  'Bethel University – Minnesota',
  'Bethel University – Tennessee',
  'Saint Anselm College',
  'St. John Fisher College',
  'Texas A&M University',
  'University of Arkansas',
  'Arkansas State University',
  'University of North Dakota',
  'North Dakota State University',
  'Duke University',
  'Gonzaga University',
  'College of Charleston',
  'Charleston Southern University',
  // Two rows that CANONICALISE to the same string. Real: the corpus holds
  // St. Joseph's University alongside Saint Joseph's University, and the
  // canonical-equality tier must not pick one of them.
  "St. Mary's College",
  'Saint Marys College',
];
const SCHOOLS = NAMES.map((school, i) => ({ id: `id-${i}`, school }));
const byName = n => SCHOOLS.find(s => s.school === n);

let pass = 0, fail = 0;
function t(label, actual, expected) {
  const a = JSON.stringify(actual), e = JSON.stringify(expected);
  if (a === e) { pass++; console.log(`  ok   ${label}`); }
  else { fail++; console.log(`  FAIL ${label}\n         got ${a}\n         want ${e}`); }
}
/** name of the resolved school, or null */
const who = q => { const r = resolveSchool(q, SCHOOLS); return r ? r.school.school : null; };
const tier = q => { const r = resolveSchool(q, SCHOOLS); return r ? r.confidence : null; };

setAliasIndex(new Map());

console.log('\nexact identity');
t('stored name resolves to itself', who('Duke University'), 'Duke University');
t('and is labelled exact', tier('Duke University'), 'exact');
t('case is irrelevant', who('DUKE UNIVERSITY'), 'Duke University');
t('padding is irrelevant', who('   Duke University   '), 'Duke University');
t('internal whitespace collapses', who('Duke    University'), 'Duke University');

console.log('\nspelling variants resolve EXACTLY, not fuzzily');
t('St. for Saint', who('St. Anselm College'), 'Saint Anselm College');
t('Saint for St.', who('Saint John Fisher College'), 'St. John Fisher College');
t('a spelling variant is still exact', tier('St. Anselm College'), 'exact');
t('and for &', who('Texas A and M University'), 'Texas A&M University');
t('hyphen for en-dash', who('Auburn University - Montgomery'), 'Auburn University – Montgomery');

console.log('\ntrailing programme labels are removed');
t("women's soccer", who("Duke University Women's Soccer"), 'Duke University');
t("men's soccer", who("Duke University Men's Soccer"), 'Duke University');
t('bare soccer', who('Duke University Soccer'), 'Duke University');
t('athletics', who('Duke University Athletics'), 'Duke University');
t('stacked labels', who("Duke University Women's Soccer Athletics"), 'Duke University');
t('a campus tail survives the strip',
  who("Auburn University – Montgomery Women's Soccer"), 'Auburn University – Montgomery');
t('the label is not stripped out of the middle of a name',
  stripProgramNoise('Soccer Valley College'), 'Soccer Valley College');

console.log('\nREFUSALS — the whole point of this module');
t('three schools share a truncated name', who('Bethel University'), null);
t('a bare state name names several schools', who('Arkansas'), null);
t('so does a bare two-word state name', who('North Dakota'), null);
t('a crowded field refuses even with a clear scoring winner',
  who('Charleston'), null);
t('nothing at all', who('Zzyzx Polytechnic'), null);
// Guards the ambiguity check on the CANONICAL tier specifically. Without it
// the tier returns whichever row came first, at confidence 'exact' — the most
// trusted badge on the most arbitrary answer.
// A spelling stored VERBATIM still wins — that tier runs first, and rightly.
t("a verbatim name beats a canonical collision", who("St. Mary's College"), "St. Mary's College");
// But a third spelling, stored under neither, reaches the canonical tier and
// matches both rows. It must refuse rather than take the first.
t('a spelling that canonicalises onto two rows refuses', who("Saint Mary's College"), null);
t('empty string', resolveSchool('', SCHOOLS), null);
t('null name', resolveSchool(null, SCHOOLS), null);
t('non-string name', resolveSchool(42, SCHOOLS), null);
t('missing school list', resolveSchool('Duke University', null), null);
t('empty school list', resolveSchool('Duke University', []), null);

console.log('\nno fallback tier');
// The resolver this replaced ended with "first school sharing any four-letter
// word". 'university' is shared by nearly every row; under the old rule this
// returned whichever came first in the array.
t('a word every school shares resolves to nobody', who('University'), null);
t('a shared word plus noise still resolves to nobody', who('State University'), null);

console.log('\nan unambiguous partial name still resolves');
t('dropping University leaves one candidate',
  who('Abilene Christian'), 'Abilene Christian University');
t('and is labelled high, not exact', tier('Abilene Christian'), 'high');
t('a distinctive single word resolves', who('Gonzaga'), 'Gonzaga University');

console.log('\nthe alias table is consulted');
setAliasIndex(new Map([
  ['zags', new Set([byName('Gonzaga University').id])],
  ['blue devils', new Set([byName('Duke University').id])],
  // An alias two schools claim. UNC, CCC and MSU are each claimed by ten or
  // more schools in the real table; a resolver must not pick one.
  ['bu', new Set([byName('Bethel University – Indiana').id,
                  byName('Bethel University – Minnesota').id])],
]));
t('a nickname resolves', who('zags'), 'Gonzaga University');
t('a closed-up multi-word nickname resolves', who('bluedevils'), 'Duke University');
t('a spaced multi-word nickname resolves', who('Blue Devils'), 'Duke University');
t('an alias two schools claim refuses', who('bu'), null);
t('an alias hit is labelled high', tier('zags'), 'high');

console.log('\ncanon');
t('canon folds the variants it claims to',
  canon("St. Mary's University – Texas"), 'saint marys university texas');
t('canon is idempotent', canon(canon('Texas A&M University')), canon('Texas A&M University'));

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
