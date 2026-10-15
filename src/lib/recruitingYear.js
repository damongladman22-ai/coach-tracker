/**
 * recruitingYear — "what should we be doing now?" for a player's graduating
 * class (recruiting resources review item 5, Damon 2026-10-15: in the
 * assistant; the key NCAA dates included, sourced and dated).
 *
 * Pure: no React, no Supabase. Used by api/ask.js (recruiting_year).
 * Tested by test/recruitingYear.test.mjs.
 *
 * The steps combine three timelines families are given: a club's recruiting
 * timeline by grade, a goalkeeper academy's recruiting roadmap, and the NCAA
 * Guide for the College-Bound Student-Athlete 2025-26 (its grade-by-grade
 * steps). Written for any club; nothing club-specific.
 *
 * The dated rules are the headline ones for NCAA soccer only, as published for
 * 2025-26 (NCAA guide and the Division I and II soccer recruiting calendars):
 *  - June 15 after sophomore year: Division I and II coaches may begin calls,
 *    texts, emails and off-campus contact; Division II visits may begin.
 *  - August 1 before junior year: Division I official and unofficial visits
 *    may begin.
 *  - April 1 of senior year: request final athletics certification from the
 *    NCAA Eligibility Center (fall enrollees).
 * Rules change: every answer says to confirm with the NCAA's recruiting guide
 * for the division or the college's compliance office. Review each August.
 *
 * Junior and senior years also carry a step on campus visit grants (Chad's
 * visit and action awards, 2026-10-15): many small colleges pay for a visit made
 * by a deadline, often in November or December of senior year. The awards
 * themselves come from the action_awards look-up, not from here.
 */

export const RULES_AS_OF = '2025-26'
export const RULES_SOURCE = 'NCAA Guide for the College-Bound Student-Athlete 2025-26 and the NCAA Division I and II soccer recruiting calendars. ' +
  'Rules change: confirm in the NCAA recruiting guide for your division (on.ncaa.com/recruitguides) or with the college\'s compliance office.'

const GRADE_WORD = { 9: 'freshman', 10: 'sophomore', 11: 'junior', 12: 'senior' }

/**
 * Where a class is today: { grade, label, summer } where grade is 9..12, below 9
 * (middle school) or above 12 (graduated). June and July are the summer
 * before the next grade.
 */
export function gradeNow(hsClass, now = new Date()) {
  const y = now.getFullYear(), m = now.getMonth()   // 0 = January
  const summer = m === 5 || m === 6
  const endYear = m >= 7 ? y + 1 : y                 // the school year ending next spring (from August)
  let grade = 12 - (Number(hsClass) - endYear)
  if (summer) grade += 1                             // June and July: the summer before the next grade
  const word = GRADE_WORD[grade]
  const label = grade > 12 ? 'graduated'
    : grade < 9 ? 'middle school'
      : summer ? `the summer before ${word} year` : `${word} year`
  return { grade, label, summer }
}

/** The key NCAA dates for one class, as calendar dates. */
export function keyDates(hsClass) {
  const c = Number(hsClass)
  return [
    { date: `${c - 2}-06-15`, what: 'June 15 after sophomore year: NCAA Division I and II soccer coaches may begin calls, texts, emails and off-campus contact, and Division II visits may begin. Not every player hears from coaches that day.' },
    { date: `${c - 2}-08-01`, what: 'August 1 before junior year: NCAA Division I official and unofficial visits may begin.' },
    { date: `${c}-04-01`, what: 'April 1 of senior year: request final athletics certification in the NCAA Eligibility Center account (fall enrollees).' },
  ]
}

const STEPS = {
  8: [
    'Focus on development and enjoying the game; college coaches rarely watch players this young.',
    'Learn how high school courses count: the NCAA counts core courses from ninth grade on.',
  ],
  9: [
    'Prioritize academics: core courses from ninth grade count toward NCAA eligibility, and grades open doors to academic aid.',
    'Keep developing skills, strength and fitness; college coaches rarely attend at this age, so development comes first.',
    'Start collecting game video and save your best clips.',
    'Research colleges and the differences between divisions; watch a few college games.',
    'Create a free Profile Page account at the NCAA Eligibility Center (eligibilitycenter.org).',
  ],
  10: [
    'Keep grades up and plan to take the SAT or ACT if your target colleges use it.',
    'Write down your non-negotiables (distance, size, cost, majors, setting) and build a list across reach, good fit and safety schools.',
    'Update your recruiting profile and edit a highlight video (about 3 minutes, best clips first).',
    'Email coaches at colleges you like before your events, with your schedule, and invite them to watch.',
    'Consider ID camps only at schools you are serious about.',
    'If a Division I or II school is recruiting you, move your Eligibility Center account to an Academic and Athletics Certification account.',
  ],
  11: [
    'Have your highlight video ready before June 15 after sophomore year, when Division I and II coaches may start reaching out.',
    'Promote yourself: email coaches with your schedule and video before each event, and follow up after.',
    'Prepare for phone calls with coaches: know your questions, and remember you are interviewing them too.',
    'Visit campuses (unofficial and official visits) and go to ID camps where the staff has shown interest.',
    'Ask admissions at each college on your list whether it gives a campus visit grant: some pay $1,000 or more a year for a visit made by a deadline, often in the fall of senior year.',
    'Narrow your list: start from about 20 schools and keep subtracting.',
    'Share your NCAA ID with schools recruiting you, and ask your counselor to upload your transcript at the end of the year.',
    'Offers and commitments often start this year.',
  ],
  12: [
    'Narrow to your top 3 to 5 and set your own timeline; understand each coach\'s timeline too.',
    'Check campus visit grant deadlines for the colleges on your list: several fall in November and December of senior year.',
    'Apply to the colleges on your list; take official and overnight visits.',
    'File the FAFSA in the fall and compare financial aid packages side by side.',
    'Commit, and tell the other coaches you have been talking with.',
    'Sign the athletics aid agreement (Division I or II) or a celebratory signing form (Division III) when the time comes.',
    'From April 1, request final athletics certification in your Eligibility Center account (fall enrollees); after graduation, have your final transcript sent.',
  ],
}

const COMMIT_TIMING = {
  W: 'Women\'s commitments typically come late in junior year to early senior year.',
  M: 'Men\'s commitments typically come a little later: late junior year to about March of senior year.',
}

/**
 * The checklist for one class: { hs_class, now, this_year, next_up, key_dates,
 * commitment_timing, source }.
 */
export function recruitingYear(hsClass, gender = null, now = new Date()) {
  const g = gradeNow(hsClass, now)
  const today = now.toISOString().slice(0, 10)
  const grade = Math.max(8, Math.min(12, g.grade))
  const thisYear = g.grade > 12 ? [] : STEPS[grade]
  const next = g.grade >= 12 ? [] : STEPS[Math.min(12, Math.max(9, grade + 1))].slice(0, 3)
  const dates = keyDates(hsClass).map(d => ({ ...d, passed: d.date < today }))
  return {
    hs_class: Number(hsClass),
    now: `${g.label} (class of ${hsClass})`,
    this_year: thisYear,
    next_up: next,
    key_dates: dates,
    commitment_timing: g.grade >= 10 && g.grade <= 12 ? (COMMIT_TIMING[gender] || `${COMMIT_TIMING.W} ${COMMIT_TIMING.M}`) : undefined,
    rules_as_of: RULES_AS_OF,
    source: RULES_SOURCE,
  }
}
