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

// ── alias index (school_aliases) ─────────────────────────────────────────────

/**
 * alias_norm -> Set of school_id. Loaded once by useSchoolAliases and read
 * synchronously here during scoring.
 *
 * This is STRICTLY BETTER than the string expansion below, and for a reason
 * worth stating: the table maps an alias to school IDENTITIES, so "usc" hits
 * the two universities by id. The string map has to guess from the name --
 * "does this name begin with 'southern california', allowing noise words in
 * front" -- which is a heuristic that happens to work. Where the table has an
 * answer, the heuristic is not consulted at all.
 */
let ALIAS_INDEX = new Map();

export function setAliasIndex(index) {
  ALIAS_INDEX = index instanceof Map ? index : new Map();
}

export function aliasIndexSize() {
  return ALIAS_INDEX.size;
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
  // Only what school_aliases cannot derive. The table takes a school's
  // initials and drops anything under three characters, because a two-letter
  // abbreviation is claimed by too many schools to carry signal. That leaves
  // these four, which are real despite being short or not matching the
  // initials convention: "Penn State" reduces to PS, not PSU.
  //
  // osu, msu, usc and unc have been REMOVED: the table now holds them, and it
  // holds them completely. The hand-written map said osu meant Ohio State; a
  // correction earlier today said four schools; the table says CCC is claimed
  // by 11 and MSU by 10. Hand curation does not survive 1,621 names.
  psu: ['penn state'],
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
  const whole = String(query || '').toLowerCase().trim().replace(/\s+/g, ' ');
  const out = whole
    .split(' ')
    .filter(Boolean)
    .map(t => (ABBREVIATIONS[t] ? [t, ...ABBREVIATIONS[t]] : [t]));
  // The unsplit query rides along on the array.
  //
  // scoreSchool needs it to look up multi-word aliases, and passing it as a
  // separate option meant any caller who forgot silently lost all 190 phrase
  // nicknames — with no error, just no results. The terms and the phrase they
  // came from are one piece of information, so they travel together.
  Object.defineProperty(out, 'query', { value: whole, enumerable: false });
  return out;
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
  // INTERIOR substring matching is for terms of 4+ characters only. A three
  // letter fragment landing inside a longer word is a coincidence, not a
  // match: measured over 1,564 real names, "usc" interior-matched Ursinus,
  // Tusculum, Mount Aloysius, Albertus Magnus and Gustavus Adolphus, "acu"
  // matched Syracuse, Immaculata and Quinnipiac, and "msu" matched Roger
  // Williams University -- every interior hit was noise and not one was
  // legitimate. Short queries are almost always abbreviations, which the alias
  // table and the prefix rules already answer properly.
  if (term.length >= 4) {
    if (name.includes(term)) return 20;
    if (nameNoSpaces.includes(termNoSpaces)) return 18;
  }
  // Reachable for short terms now that the two rules above are length-gated:
  // a 3-character term that PREFIXES the space-collapsed name is a real hit.
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
  const id = school.id;

  // WHOLE-PHRASE alias check, before anything is split into terms.
  //
  // 14% of the nicknames in school_aliases are multi-word — Golden Stallions,
  // Red Devils, Great Danes, Yellow Jackets, Fighting Owls. The per-term
  // lookup below can never find them: "golden stallions" becomes the terms
  // "golden" and "stallions", and neither is a key. 190 aliases would have
  // been stored and then been unreachable.
  //
  // Scored 60, above a name prefix (50): someone who types a school's full
  // nickname has named that school as precisely as typing its name, and more
  // precisely than a query that merely prefixes it.
  const rawQuery = opts.query || terms.query;
  if (id && rawQuery) {
    const whole = String(rawQuery).toLowerCase().trim().replace(/\s+/g, ' ');
    if (whole.includes(' ')) {
      const hits = ALIAS_INDEX.get(whole);
      if (hits && hits.has(id)) return 60;
    }
  }
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
    // The alias table first: an id match is knowledge, not inference. Scored
    // at 45 -- below a name match (100 exact, 50 prefix) and above a substring
    // hit (20), which is where an alias belongs: "osu" should put Ohio State
    // above a school with "osu" buried in its name, without outranking someone
    // who typed the name itself.
    const hits = id && ALIAS_INDEX.get(alternatives[0]);
    if (hits && hits.has(id)) best = 45;
    // Index 0 is what the user actually typed; everything after it is an
    // expansion we inferred, and is scored strictly. See scoreOne.
    for (let i = 0; i < alternatives.length; i++) {
      const s = scoreOne(fields, alternatives[i], i > 0);
      if (s > best) best = s;
    }
    // EVERY term must be found. Summing alone means a school matching just one
    // word of a multi-word query still scores above zero, so "ohio state"
    // returned Adams State, Arizona State and Angelo State on the strength of
    // "state" — and alphabetical order put them above Ohio State. The rule
    // being replaced here treated the whole phrase as one substring, so it
    // never had this failure; the split into terms is what introduced it.
    if (best === 0) return 0;
    total += best;
  }
  return total;
}

/** Boolean form, for pages that filter a list they sort themselves. */
export function matchesSchool(school, query, opts = {}) {
  const terms = expandTerms(query);
  if (!terms.length) return true;
  return scoreSchool(school, terms, { ...opts, query }) > 0;
}
