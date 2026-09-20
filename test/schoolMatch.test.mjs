/**
 * Tests for src/lib/schoolMatch.js — plain node, no test runner, no deps.
 *
 *     npm test          (or: node test/schoolMatch.test.mjs)
 *
 * The repo has no test framework and this module did not justify adding one.
 * Exit code is the verdict.
 *
 * The school list below is a 30-name sample of real rows. The headline numbers
 * quoted in schoolMatch.js ("raines" returning 1,203 of 1,562) were measured
 * separately against the full corpus; this file guards the BEHAVIOUR, not the
 * corpus-wide count.
 */
import {
  matchesText, withinEdits, typoMatch, expandTerms,
  scoreSchool, matchesSchool, ABBREVIATIONS,
  setAliasIndex, aliasIndexSize,
} from '../src/lib/schoolMatch.js';

const SCHOOLS = [
  'Stanford University', 'Clemson University', 'Duke University',
  'Ohio State University', 'Oregon State University', 'Oklahoma State University',
  'Penn State', 'Michigan State University', 'Mississippi State University',
  'Missouri State University', 'Montana State University',
  'University of Southern California', 'University of South Carolina',
  'University of North Carolina', 'Marquette University', 'Samford University',
  'La Salle University', 'Abilene Christian University',
  'Abraham Baldwin Agricultural College', 'Academy of Art University',
  'Adams State University', 'Alabama A&M University', 'Albright College',
  'Allegheny College', 'Arizona State University', 'Azusa Pacific University',
  'Boston College', 'Boston University', 'Johnson University',
  'Johnson County Community College',
  // Real rows that prod surfaced: they CONTAIN "oklahoma state" but are not
  // the school OSU means. The first version of the matcher returned all three.
  'Eastern Oklahoma State College', 'Northwestern Oklahoma State University',
  'Southwestern Oklahoma State University',
  // Real rows behind the multi-word regression: they share only the word
  // "State" with a query like "ohio state", and alphabetical order put them
  // ABOVE the school the user meant.
  'Adams State University', 'Angelo State University', 'Alabama A&M University',
  // Guards the strict-expansion path, which psu still exercises: this school
  // CONTAINS "penn state" but is not the school PSU means.
  'Eastern Penn State College',
].map(s => ({ id: s, school: s, city: '', state: '', conference: '' }));

// Stands in for school_aliases. Ids are the names, so the mapping is readable.
// Every entry here is one the real table holds: the four that were removed from
// ABBREVIATIONS when the table took them over.
setAliasIndex(new Map([
  ['osu', new Set(['Ohio State University', 'Oregon State University',
                   'Oklahoma State University'])],
  ['usc', new Set(['University of Southern California',
                   'University of South Carolina'])],
  ['unc', new Set(['University of North Carolina'])],
  ['msu', new Set(['Michigan State University', 'Mississippi State University',
                   'Missouri State University', 'Montana State University'])],
]));

let pass = 0, fail = 0;
const t = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  ok ? pass++ : fail++;
  if (!ok) console.log(`  FAIL  ${label}\n        got  ${JSON.stringify(got)}\n        want ${JSON.stringify(want)}`);
};
const hits = q => SCHOOLS.filter(s => matchesSchool(s, q, { fields: ['name'] }))
                         .map(s => s.school);
const ranked = q => {
  const terms = expandTerms(q);
  return SCHOOLS.map(s => [scoreSchool(s, terms, { fields: ['name'] }), s.school])
                .filter(r => r[0] > 0)
                .sort((a, b) => b[0] - a[0])
                .map(r => r[1]);
};

// ── the false positives that motivated all of this ──────────────────────────
t('raines returns nothing', hits('raines'), []);
t('tarheels returns nothing', hits('tarheels'), []);
t('buckeyes returns nothing', hits('buckeyes'), []);
t('xyzzy returns nothing', hits('xyzzy'), []);

// ── typo tolerance, which the old rule claimed and did not do ───────────────
t('stanfrod finds Stanford', hits('stanfrod'), ['Stanford University']);
t('stanfrd finds Stanford', hits('stanfrd'), ['Stanford University']);
t('clemsom finds Clemson', hits('clemsom'), ['Clemson University']);
t('marquett finds Marquette', hits('marquett'), ['Marquette University']);

// ── exact and prefix behaviour is unchanged ─────────────────────────────────
t('duke finds only Duke', hits('duke'), ['Duke University']);
t('stanford outranks Samford', ranked('stanford')[0], 'Stanford University');
t('lasalle finds La Salle', hits('lasalle'), ['La Salle University']);

// ── one-to-many abbreviations: the point of the rewrite ─────────────────────
t('osu returns all three', ranked('osu').sort(),
  ['Ohio State University', 'Oklahoma State University', 'Oregon State University']);
t('usc returns both', ranked('usc').sort(),
  ['University of South Carolina', 'University of Southern California']);
t('msu returns all four', ranked('msu').length, 4);
t('alias index is loaded for these tests', aliasIndexSize(), 4);
t('unc returns North Carolina', ranked('unc'), ['University of North Carolina']);
t('ucla is gone from the map', ABBREVIATIONS.ucla, undefined);
// These four moved to school_aliases and must NOT also live in the map: two
// sources of truth for one abbreviation is what the table exists to end.
t('osu is no longer in the map', ABBREVIATIONS.osu, undefined);
t('usc is no longer in the map', ABBREVIATIONS.usc, undefined);
t('msu is no longer in the map', ABBREVIATIONS.msu, undefined);
t('unc is no longer in the map', ABBREVIATIONS.unc, undefined);
// What the table cannot derive stays in the map: "Penn State" reduces to PS,
// and the table drops anything under three characters.
t('psu is still in the map', ABBREVIATIONS.psu, ['penn state']);
t('psu finds Penn State', ranked('psu').includes('Penn State'), true);
t('psu excludes a school merely containing the phrase',
  ranked('psu').includes('Eastern Penn State College'), false);

// ── expansions are an inference and are scored strictly ─────────────────────
// Found in production, not by these tests. "osu" expanded to "oklahoma state"
// and was matched with the same loose `includes` rule as typed text, so three
// unrelated institutions came back alongside the three real answers.
t('osu excludes schools that merely contain the phrase',
  ranked('osu').filter(n => /Eastern|Northwestern|Southwestern/.test(n)), []);
t('osu returns exactly the three', ranked('osu').sort(),
  ['Ohio State University', 'Oklahoma State University', 'Oregon State University']);
// The guard against over-correcting: a plain startsWith would lose this one,
// because "University of" sits in front of the phrase.
t('usc still finds Southern California',
  ranked('usc').includes('University of Southern California'), true);
t('usc still finds South Carolina',
  ranked('usc').includes('University of South Carolina'), true);
t('unc still finds North Carolina', ranked('unc'),
  ['University of North Carolina']);
t('expandTerms keeps the literal term', expandTerms('osu')[0][0], 'osu');

// ── every term must be found, not just one ──────────────────────────────────
// Found in production by Damon, not by these tests. Splitting a query into
// terms and summing meant a school matching ONE word of a multi-word query
// still scored above zero, so "ohio state" returned Adams State, Angelo State
// and Arizona State. The rule this replaced treated the phrase as a single
// substring and never had the failure; the split is what introduced it.
t('ohio state returns only Ohio State', ranked('ohio state'),
  ['Ohio State University']);
t('ohio state excludes other State schools',
  ranked('ohio state').filter(n => /Adams|Angelo|Arizona/.test(n)), []);
t('a term that matches nothing kills the whole query',
  ranked('ohio zzzz'), []);
t('multi-word still works when both terms hit', ranked('boston college'),
  ['Boston College']);
t('partial phrase does not match', ranked('state university').includes('Duke University'),
  false);

// ── fields option must not silently widen a page's behaviour ────────────────
const withConf = [{ school: 'Somewhere College', city: 'Nowhere',
                    state: 'Iowa', conference: 'Big Ten' }];
t('conference matches when allowed',
  matchesSchool(withConf[0], 'big ten', { fields: ['name', 'conference'] }), true);
t('conference ignored when not listed',
  matchesSchool(withConf[0], 'big ten', { fields: ['name'] }), false);
t('empty query matches everything', matchesSchool(withConf[0], '   '), true);

// ── the shared text rule the two twins each had a copy of ───────────────────
t('matchesText substring', matchesText('La Salle University', 'salle'), true);
t('matchesText space-collapsed', matchesText('La Salle University', 'lasalle'), true);
t('matchesText miss', matchesText('La Salle University', 'raines'), false);
t('matchesText empty term matches', matchesText('anything', ''), true);

// ── distance primitive ──────────────────────────────────────────────────────
t('withinEdits transposition is 2', withinEdits('stanford', 'stanfrod', 2), true);
t('withinEdits transposition not 1', withinEdits('stanford', 'stanfrod', 1), false);
t('withinEdits length guard', withinEdits('duke', 'dukeuniversity', 2), false);
t('short terms never typo-match', typoMatch('penn state', 'pennstate', 'pen'), false);

// ── a guard for the defect class, not the defect ────────────────────────────
// The old rule passed any term whose characters appeared anywhere in the name.
// If something like it ever comes back, a nonsense term made only of letters
// present in a long school name will start matching again.
t('character-bag regression guard',
  hits('aibcnrsiu'), []);   // every letter appears in "Abilene Christian University"

// ── an empty index must degrade, never break ────────────────────────────────
// If school_aliases fails to load, search must behave as it did before the
// table existed. A search box that breaks because a lookup table did not
// arrive is worse than one without abbreviations.
setAliasIndex(new Map());
t('no alias table: name search still works', hits('duke'), ['Duke University']);
t('no alias table: typo tolerance still works', hits('stanfrod'),
  ['Stanford University']);
t('no alias table: osu simply finds nothing', hits('osu'), []);
t('no alias table: the residual map still works',
  ranked('psu').includes('Penn State'), true);
// A truthy non-Map is the real hazard: a mis-shaped fetch result would be
// assigned and then throw on .get during the next keystroke. null is NOT a
// sufficient test — it lands on an empty Map under a sloppy implementation too.
t('setAliasIndex rejects an array', (setAliasIndex([1, 2]), aliasIndexSize()), 0);
t('setAliasIndex rejects an object', (setAliasIndex({ osu: 1 }), aliasIndexSize()), 0);
t('search survives a mis-shaped index', hits('duke'), ['Duke University']);
t('setAliasIndex rejects null', (setAliasIndex(null), aliasIndexSize()), 0);

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
