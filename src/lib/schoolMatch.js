/**
 * One school-matching module, used by every search surface.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this, five surfaces each had their own search:
 *
 *   SchoolSearch (AttendanceMatrix)  scored ranking, 9 abbreviations,
 *                                    city/state/conference, typo tolerance
 *   CollegeExplore  (/schools)       plain substring on the school name
 *   CoachDirectory                   substring + space-collapsed
 *   Schools (admin)                  substring on name/state/conference
 *   ParentSummary                    substring + space-collapsed
 *
 * Two of those were literal copy-paste twins. And the gradient ran backwards:
 * the most capable search sat on the admin screen with the fewest users, the
 * least capable on the public page a parent lands on first. Nothing required
 * that -- each grew where it was needed, and none knew about the others.
 *
 * So the rules live here once. A sixth search box gets them for free, which is
 * the actual point: the old state regressed the moment anyone added a screen.
 *
 * TWO SHAPES, because the call sites genuinely differ. Three surfaces rank
 * results and want a score; two filter a list they sort themselves and want a
 * boolean. Forcing either into the other's shape would mean hijacking a page's
 * own sort order, so both are exported and neither is a wrapper apology for
 * the other.
 */

// ── text rules ───────────────────────────────────────────────────────────────

/**
 * The rule CoachDirectory and ParentSummary each had their own copy of.
 * Substring, then substring with spaces removed so "lasalle" finds "La Salle".
 * Applies to ANY text -- CoachDirectory runs it over coach names too, which is
 * why it is not school-specific.
 */
export function matchesText(text, term) {
  if (!term) return true;
  const t = String(term).toLowerCase().trim();
  const s = String(text || '').toLowerCase();
  if (s.includes(t)) return true;
  return s.replace(/\s+/g, '').includes(t.replace(/\s+/g, ''));
}

/**
 * Bounded Levenshtein: true when `a` and `b` are within `max` edits. Rows are
 * computed one at a time and the walk aborts as soon as an entire row exceeds
 * `max`, so a non-match on a long name costs a few cells, not a full matrix.
 */
export function withinEdits(a, b, max) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > max) return false;
  let prev = new Array(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;
  for (let i = 1; i <= la; i++) {
    const cur = new Array(lb + 1);
    cur[0] = i;
    let best = i;
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(
        prev[j] + 1,
        cur[j - 1] + 1,
        prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)
      );
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return false;
    prev = cur;
  }
  return prev[lb] <= max;
}

/**
 * Typo tolerance: is `term` a near-miss for any WORD of the name, or for the
 * whole name with spaces removed?
 *
 * This replaced a character-bag matcher that counted how many of the term's
 * characters appeared ANYWHERE in the name and passed at 70%. Measured against
 * 1,562 real school names, that rule returned 1,203 schools for "raines", 1,234
 * for "tarheels" and 664 for "buckeyes" -- all false positives, and none of them
 * "no results". It also failed the one job it claimed: "stanfrod" returned 810
 * schools and Stanford was not among them. This rule returns 0, 0, 0, Stanford.
 *
 * Terms under 4 characters are excluded: at that length an edit budget of 1
 * cannot separate a typo from a different word, and short terms are already
 * served by the prefix rules.
 */
export function typoMatch(name, nameNoSpaces, term) {
  if (term.length < 4) return false;
  const max = term.length <= 6 ? 1 : 2;
  for (const w of name.split(' ')) {
    if (Math.abs(w.length - term.length) <= max && withinEdits(w, term, max)) {
      return true;
    }
  }
  return Math.abs(nameNoSpaces.length - term.length) <= max &&
         withinEdits(nameNoSpaces, term, max);
}

// ── abbreviations ────────────────────────────────────────────────────────────

/**
 * ONE-TO-MANY on purpose. The map this replaces sent each abbreviation to a
 * single school -- `osu: 'ohio state'` -- which silently hid Oregon State and
 * Oklahoma State from anyone who typed OSU. An abbreviation that belongs to
 * several schools is a fact about the world, not an ambiguity to resolve by
 * picking one; the honest answer is all of them, ranked.
 *
 * These are the same nine keys the old map had, corrected -- NOT a new
 * hand-curated list. The real source is the school_aliases table
 * (claude/School_Search_Aliases_Backlog_Item_20260912.md section 4.1), which
 * will replace this constant wholesale; expandTerms already returns the array
 * shape that table will feed.
 *
 * `ucla` was a no-op in the old map (it mapped to itself) and is dropped: the
 * stored name is "University of California - Los Angeles", which no string
 * expansion reaches. It needs the alias table, and pretending otherwise here
 * would just be a different no-op.
 */
export const ABBREVIATIONS = {
  osu: ['ohio state', 'oregon state', 'oklahoma state'],
  psu: ['penn state'],
  msu: ['michigan state', 'mississippi state', 'missouri state', 'montana state'],
  usc: ['southern california', 'south carolina'],
  unc: ['north carolina'],
  ut: ['texas', 'tennessee', 'toledo', 'utah'],
  um: ['michigan', 'miami', 'maine', 'massachusetts', 'montana'],
  iu: ['indiana'],
};

/**
 * A query becomes a list of terms, each of which is a list of ALTERNATIVES.
 * "osu" -> [['osu', 'ohio state', 'oregon state', 'oklahoma state']].
 * The abbreviation itself is kept as an alternative so a school whose name
 * literally contains it still matches.
 */
export function expandTerms(query) {
  return String(query || '')
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(t => (ABBREVIATIONS[t] ? [t, ...ABBREVIATIONS[t]] : [t]));
}

// ── school scoring ───────────────────────────────────────────────────────────

/**
 * Words that can sit in front of a school's distinguishing name without
 * changing which school it is. "University of Southern California" IS the
 * school USC expands to; "Eastern Oklahoma State College" is NOT the school
 * OSU expands to, because "Eastern" distinguishes it.
 */
const PREFIX_NOISE = new Set(['university', 'college', 'the', 'of', 'at']);

/** Does `name` begin with `phrase`, ignoring any leading noise words? */
function beginsWithPhrase(name, phrase) {
  if (name.startsWith(phrase)) return true;
  const words = name.split(' ');
  let i = 0;
  while (i < words.length && PREFIX_NOISE.has(words[i])) i++;
  return i > 0 && words.slice(i).join(' ').startsWith(phrase);
}

/**
 * Score one alternative against one school. Highest-value rule wins.
 *
 * `strict` marks an ABBREVIATION EXPANSION rather than text the user typed.
 * Expansions are an inference on our part, so they are held to a higher bar:
 * the school's name must BEGIN with the expansion, allowing only noise words
 * in front of it. Scored loosely, "osu" expanding to "oklahoma state" returned
 * Eastern Oklahoma State College, Northwestern Oklahoma State University and
 * Southwestern Oklahoma State University alongside the three real answers --
 * three separate institutions that merely contain the phrase. A plain
 * startsWith would have been too strict the other way and lost "University of
 * Southern California" for "usc", which is why the noise-word skip exists.
 */
function scoreOne(fields, term, strict) {
  const { name, nameNoSpaces, city, state, conference } = fields;
  const termNoSpaces = term.replace(/\s+/g, '');
  if (name === term) return 100;
  if (strict) return beginsWithPhrase(name, term) ? 50 : 0;
  if (name.startsWith(term)) return 50;
  if (name.split(' ').some(w => w.startsWith(term))) return 30;
  if (name.includes(term)) return 20;
  if (nameNoSpaces.includes(termNoSpaces)) return 18;
  if (nameNoSpaces.startsWith(termNoSpaces)) return 16;
  if (state && (state === term || state.startsWith(term))) return 12;
  if (city && city.includes(term)) return 10;
  if (conference && conference.includes(term)) return 5;
  if (typoMatch(name, nameNoSpaces, term)) return 8;
  return 0;
}

/**
 * Rank a school against expanded terms. Each term contributes the BEST score
 * across its alternatives, so "osu" scores Ohio State, Oregon State and
 * Oklahoma State each on their own merits rather than on whichever expansion
 * happened to be listed first.
 *
 * `opts.fields` limits which fields are consulted. CollegeExplore searches the
 * school name only; passing its own field set keeps that page's behaviour
 * rather than silently widening it to city and conference.
 */
export function scoreSchool(school, terms, opts = {}) {
  const use = opts.fields || ['name', 'city', 'state', 'conference'];
  const name = String(school.school || '').toLowerCase();
  const fields = {
    name,
    nameNoSpaces: name.replace(/\s+/g, ''),
    city: use.includes('city') ? String(school.city || '').toLowerCase() : '',
    state: use.includes('state') ? String(school.state || '').toLowerCase() : '',
    conference: use.includes('conference')
      ? String(school.conference || '').toLowerCase() : '',
  };
  let total = 0;
  for (const alternatives of terms) {
    let best = 0;
    // Index 0 is what the user actually typed; everything after it is an
    // expansion we inferred, and is scored strictly. See scoreOne.
    for (let i = 0; i < alternatives.length; i++) {
      const s = scoreOne(fields, alternatives[i], i > 0);
      if (s > best) best = s;
    }
    total += best;
  }
  return total;
}

/** Boolean form, for pages that filter a list they sort themselves. */
export function matchesSchool(school, query, opts = {}) {
  const terms = expandTerms(query);
  if (!terms.length) return true;
  return scoreSchool(school, terms, opts) > 0;
}
