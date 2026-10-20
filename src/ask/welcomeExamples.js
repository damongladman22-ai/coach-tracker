/**
 * welcomeExamples — the example questions on the assistant's welcome screen,
 * worded for the program the family picked (Damon 2026-10-20: the examples all
 * said "women's", so a men's family read the screen as not meant for them).
 *
 * gender: 'W' | 'M' | null. With null the wording names no gender; the
 * assistant then asks once when a question needs it. With a pick the examples
 * name it, and the page sends the pick with every question (context.gender), so
 * the assistant does not need to ask.
 *
 * Four groups by the job a family is doing, two examples each. `team: true`
 * marks examples that need the club's own attendance data; they are left out
 * when showTeam is false (for a partner widget later).
 */

export const GENDERS = ['W', 'M']
export const GENDER_LABEL = { W: 'Women’s soccer', M: 'Men’s soccer' }
const WORD = { W: "women's", M: "men's" }
const CAP = { W: "Women's", M: "Men's" }

/** A stored or passed value as 'W', 'M' or null. */
export function cleanGender(v) {
  const s = String(v || '').trim().toUpperCase()
  return s === 'W' || s === 'M' ? s : null
}

// "women's " / "men's " / "" for the middle of a sentence.
const mid = g => (WORD[g] ? WORD[g] + ' ' : '')

export const GROUPS = [
  {
    title: 'Build your list',
    blurb: 'Openings at your position, Reach / Good fit / Safety, distance from home and majors.',
    qs: g => [
      { q: `Which D3 ${mid(g)}programs within 150 miles of Columbus, Ohio will need a goalkeeper for the class of 2028?` },
      { q: `${g ? CAP[g] + ' D2' : 'D2'} and D3 programs that offer nursing, labelled Reach, Good fit or Safety for a 1250 SAT` },
    ],
  },
  {
    title: 'Research a program',
    blurb: 'Results and peer standing, coaching staff, roster style, academics, cost, earnings and visit awards.',
    qs: g => [
      { q: `How has Kenyon ${mid(g)}soccer done over the last three seasons, and who is on the staff?` },
      { q: 'What does Denison cost, what do graduates earn, and does it pay for a campus visit?' },
    ],
  },
  {
    title: 'Reach out',
    blurb: 'Emails to coaching staffs, preparing for a coach call and inviting coaches to your events.',
    qs: g => [
      { q: `Draft an email to the Ohio Wesleyan ${mid(g)}soccer coaches` },
      { q: `Help me prepare for a call with the Wooster ${mid(g)}soccer coaches` },
    ],
  },
  {
    title: 'Plan the year',
    blurb: 'What to do this year for your class, key dates, and which college coaches have watched your team.',
    qs: () => [
      { q: 'What should a class of 2028 player be doing this fall?' },
      { q: 'Which college programs have watched our team play?', team: true },
    ],
  },
]

/** One group's examples for this gender, without the team-only ones when showTeam is false. */
export function groupQs(group, gender = null, showTeam = true) {
  return group.qs(cleanGender(gender)).filter(x => showTeam || !x.team)
}
