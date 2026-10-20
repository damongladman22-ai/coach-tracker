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
 * TEMPLATES, NOT SENT AS-IS (Damon 2026-10-20: "why are we pre selecting
 * colleges"). Tapping an example puts it in the question box with the parts the
 * family must supply in square brackets ([college], [town or ZIP], [year] ...).
 * The first one is selected so typing replaces it; Tab moves to the next; the
 * box will not send while a [bracketed] part is left (see findPlaceholder).
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
      { q: `Which ${mid(g)}programs within [distance] miles of [town or ZIP] will need a [position] for the class of [year]?` },
      { q: `${g ? CAP[g] + ' programs' : 'Programs'} that offer [major], labelled Reach, Good fit or Safety for a [SAT or ACT score]` },
    ],
  },
  {
    title: 'Research a program',
    blurb: 'Results and peer standing, coaching staff, roster style, academics, cost, earnings and visit awards.',
    qs: g => [
      { q: `How has [college] ${mid(g)}soccer done over the last three seasons, and who is on the staff?` },
      { q: 'What does [college] cost, what do graduates earn, and does it pay for a campus visit?' },
    ],
  },
  {
    title: 'Reach out',
    blurb: 'Emails to coaching staffs, preparing for a coach call and inviting coaches to your events.',
    qs: g => [
      { q: `Draft an email to the [college] ${mid(g)}soccer coaches` },
      { q: `Help me prepare for a call with the [college] ${mid(g)}soccer coaches` },
    ],
  },
  {
    title: 'Plan the year',
    blurb: 'What to do this year for your class, key dates, and which college coaches have watched your team.',
    qs: () => [
      { q: 'What should a class of [year] player be doing this year?' },
      { q: 'Which college programs have watched our team play?', team: true },
    ],
  },
]

// A part the family must fill in: [college], [town or ZIP] ... (no nesting, one line, short).
const PLACEHOLDER = /\[[^[\]\n]{1,40}\]/g

/** The first [placeholder] starting at or after `from` (wrapping to the start), as { start, end }, or null. */
export function findPlaceholder(text, from = 0) {
  const all = [...String(text || '').matchAll(PLACEHOLDER)].map(m => ({ start: m.index, end: m.index + m[0].length }))
  if (!all.length) return null
  return all.find(r => r.start >= from) || all[0]
}

/** The text split into plain parts and [placeholder] parts, for display. */
export function splitPlaceholders(text) {
  const out = []
  let last = 0
  for (const m of String(text || '').matchAll(PLACEHOLDER)) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), ph: false })
    out.push({ text: m[0], ph: true })
    last = m.index + m[0].length
  }
  if (last < String(text || '').length) out.push({ text: text.slice(last), ph: false })
  return out
}

/** One group's examples for this gender, without the team-only ones when showTeam is false. */
export function groupQs(group, gender = null, showTeam = true) {
  return group.qs(cleanGender(gender)).filter(x => showTeam || !x.team)
}
