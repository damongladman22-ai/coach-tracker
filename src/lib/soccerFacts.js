/**
 * soccerFacts — the few college soccer facts Ask PitchSide may quote that do
 * not come from PitchSide's own data: program counts, athletic scholarship and
 * roster rules, and participation figures. Each is dated and carries its
 * source. Nothing here is advice; anything else points to the governing body.
 *
 * Checked 2026-10-15 (recruiting resources review, Chad Prickett: "these
 * numbers are not up to date ... scholarship stuff"). Review each August.
 * NAIA and NJCAA limits are left out until confirmed on naia.org / njcaa.org.
 */

export const FACTS_CHECKED = '2026-10-15'

export const SOCCER_FACTS = [
  {
    topic: 'NCAA programs by division (2025-26)',
    fact: "Men's soccer: Division I 213, Division II 203, Division III 407. Women's soccer: Division I 350, Division II 260, Division III 419. NCAA projections as of September 2025.",
    source: 'NCAA.org, Membership Composition and Sport Sponsorship',
  },
  {
    topic: 'Division I scholarships and roster limits (from 2025-26)',
    fact: 'From July 1, 2025, Division I schools in the settlement conferences and schools that opted in no longer have sport-specific scholarship limits; they may offer athletic scholarships to anyone on the roster, within a roster limit (28 for men\'s and for women\'s soccer, per the NCAA\'s Q&A as reported in June 2025). Players whose spots were affected when the limits began were designated and do not count against a limit. Schools that did not opt in: ask the school.',
    source: 'NCAA.org, "DI Board of Directors formally adopts changes to roster limits" (June 23, 2025); soccer roster numbers per the NCAA Q&A reported by SwimSwam (June 9, 2025)',
  },
  {
    topic: 'Division II scholarships',
    fact: "Partial (equivalency) scholarships: up to 9.0 full scholarships per men's soccer team and 9.9 per women's team, which coaches may split among players.",
    source: 'NCAA.org, Division II Athletics Scholarships (current equivalency limits)',
  },
  {
    topic: 'Division III scholarships',
    fact: 'Division III schools do not offer athletic scholarships; about 80% of Division III athletes receive merit or need-based aid.',
    source: 'NCAA Guide for the College-Bound Student-Athlete 2025-26',
  },
  {
    topic: 'Who receives athletic aid',
    fact: 'About 57% of Division I athletes and 62% of Division II athletes receive athletics aid (all sports).',
    source: 'NCAA Guide for the College-Bound Student-Athlete 2025-26',
  },
  {
    topic: 'Odds of playing in college (women)',
    fact: "Women's soccer: 377,838 high school players and 29,959 NCAA players (about 7.9% of high school players reach the NCAA); about 0.7% of NCAA players were drafted to a major professional league.",
    source: 'NCAA Guide for the College-Bound Student-Athlete 2025-26 (2022-23 participation data)',
  },
]

export function soccerFacts() {
  return {
    checked: FACTS_CHECKED,
    facts: SOCCER_FACTS,
    not_covered: 'NAIA and junior college (NJCAA) scholarship limits, and every other rule: check with the NAIA, the NJCAA, the NCAA recruiting guide for the division, or the college\'s compliance office.',
  }
}
