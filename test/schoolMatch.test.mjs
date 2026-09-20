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
].map(s => ({ school: s, city: '', state: '', conference: '' }));

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
t('unc returns North Carolina', ranked('unc'), ['University of North Carolina']);
t('ucla is gone from the map', ABBREVIATIONS.ucla, undefined);
t('expandTerms keeps the literal term', expandTerms('osu')[0][0], 'osu');

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

console.log(`\n  ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
