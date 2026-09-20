/**
 * Resolve an imported school name to exactly ONE school record, or refuse.
 *
 * WHY THIS IS NOT matchesSchool
 * -----------------------------
 * schoolMatch.js answers "should this row appear in the list" for five search
 * surfaces. A wrong row there is visible noise the user scrolls past. This
 * answers "which school do these coaches belong to", and the answer is written
 * to the database. A wrong answer here is a data defect, not a UX annoyance,
 * so the contract is the opposite one: it must be willing to return nothing.
 *
 * It reuses the scoring in schoolMatch.js rather than reimplementing it — the
 * whole point of that module is that the app has one answer to "does this
 * string name this school". What is added here is the two rules a resolver
 * needs and a filter must not have.
 *
 * RULE 1 — NO FALLBACK TIER.
 * The resolver this replaces ended with "return the first school sharing any
 * four-letter word". Measured over 9,601 realistic import-name variants it
 * returned a school for every single full-name query — it had no way to say "I
 * do not know". An unmatched row a human resolves by hand is strictly better
 * than a confident wrong school written silently.
 *
 * RULE 2 — TIES REFUSE, AND SO DOES A CROWDED FIELD.
 * "Bethel University" designates three real schools in our data. The honest
 * answer is none of them. More than that: if more than one school scores at
 * all on a fuzzy query, the query has not identified a school, even when one
 * of them scores highest. "Arkansas" prefixes Arkansas State University and
 * sits mid-name in University of Arkansas, so prefix scoring hands it to
 * Arkansas State — a defensible ranking for a search box and the wrong answer
 * for a resolver.
 *
 * MEASURED, against 1,520 school records (2026-09-20):
 *
 *   9,601 full-name variants — dropped "University", dropped campus tails,
 *   St./Saint, &/and, appended "Women's Soccer", case and padding:
 *     old  743 wrong (7.7%),  0 refusals
 *     new    2 wrong (0.02%), 540 refusals (5.6%)
 *   and the new resolver is right MORE often in absolute terms (8,999 vs
 *   8,858), because the variants it now handles outnumber the ones it declines.
 *
 *   907 abbreviations and nicknames that name exactly one school:
 *     old    4 right (0.4%),  126 wrong (13.9%)
 *     new  835 right (92.1%),   0 wrong
 *
 * The full write-up is claude/Import_School_Resolver_Is_A_Sixth_Matcher_20260920.md.
 */
import { expandTerms, scoreSchool } from './schoolMatch.js';   // .js so the plain-node test runner can resolve it

/**
 * Trailing programme labels. Import files routinely carry the sport or the
 * department on the end of the school name — "Auburn University – Montgomery
 * Women's Soccer" — and every one of those words is absent from the stored
 * name, so without this the whole query scores zero and nothing resolves.
 * Applied repeatedly because "… Women's Soccer Athletics" happens.
 */
const PROGRAM_NOISE =
  /\s*(?:\((?:[wm])\)|(?:women|men)(?:'|’)?s?\s+soccer|soccer|athletics?(?:\s+department)?|(?:women|men)(?:'|’)?s)\s*$/i;

export function stripProgramNoise(name) {
  let s = String(name || '').trim();
  for (let i = 0; i < 4; i++) {
    const next = s.replace(PROGRAM_NOISE, '').trim();
    if (next === s || !next) break;
    s = next;
  }
  return s;
}

/**
 * Canonical form for EXACT comparison only. Both sides get it, so this widens
 * equality, never fuzziness — which is why it can afford to be aggressive. It
 * absorbs the spelling variants import files actually contain: Saint vs St.,
 * & vs and, en-dash vs hyphen, and punctuation. Saint/St. alone was 82% of
 * those names resolving to the wrong school before this existed.
 */
export function canon(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/\bst\.?\b/g, 'saint')
    .replace(/[–—-]/g, ' ')
    .replace(/[.,'’"()]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * @returns {{school: object, confidence: 'exact'|'high'}|null}
 *   null means "no confident single answer" — either nothing matched or more
 *   than one school did. The caller must treat null as a row for a human.
 */
export function resolveSchool(rawName, schools) {
  if (!rawName || typeof rawName !== 'string' || !Array.isArray(schools)) return null;
  const raw = rawName.toLowerCase().trim().replace(/\s+/g, ' ');
  if (!raw) return null;

  // 1. The name exactly as stored.
  const verbatim = schools.filter(s => String(s.school || '').toLowerCase().trim() === raw);
  if (verbatim.length === 1) return { school: verbatim[0], confidence: 'exact' };
  if (verbatim.length > 1) return null;

  // 2. Canonical equality — Saint/St., &/and, dashes, punctuation.
  const c = canon(raw);
  let pool = schools.filter(s => canon(s.school) === c);
  if (pool.length > 1) return null;
  if (pool.length === 1) return { school: pool[0], confidence: 'exact' };

  // 3. The same, after removing a trailing programme label.
  const stripped = stripProgramNoise(raw);
  if (stripped && stripped !== raw) {
    const cs = canon(stripped);
    pool = schools.filter(s => canon(s.school) === cs);
    if (pool.length > 1) return null;
    if (pool.length === 1) return { school: pool[0], confidence: 'exact' };
  }

  // 4. Scored match — abbreviations and nicknames from school_aliases, name
  //    prefixes, typos. A single winner or nothing.
  const query = stripped || raw;
  const terms = expandTerms(query);
  if (!terms.length) return null;

  let top = 0;
  let winner = null;
  let candidates = 0;
  for (const s of schools) {
    const score = scoreSchool(s, terms, { fields: ['name'], query });
    if (score <= 0) continue;
    // Rule 2. A second school scoring at all means the string did not identify
    // one school, whatever the ranking says.
    if (++candidates > 1) return null;
    top = score;
    winner = s;
  }
  if (!winner || top === 0) return null;
  return { school: winner, confidence: 'high' };
}
