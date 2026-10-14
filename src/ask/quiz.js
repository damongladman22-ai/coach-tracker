// The quick quiz on the Ask tab (Chad Prickett's pilot idea, Damon 2026-10-14):
// about a dozen multiple-choice questions that build the player's profile, then
// one message to the assistant asking for a shortlist. Pure (no imports) so the
// tests can load it.
//
// Every answer maps to something PitchSide can search (find_programs filters),
// except the playing-time priority, which the assistant weighs in its trade-offs.

// High-school classes still to graduate. From June the senior class has left.
export function classOptions(now = new Date()) {
  const y = now.getFullYear()
  const first = now.getMonth() >= 5 ? y + 1 : y
  return [0, 1, 2, 3].map(i => {
    const c = first + i
    return { value: String(c), label: `Class of ${c}` }
  })
}

export function quizQuestions(now = new Date()) {
  return [
    { id: 'gender', q: 'Which program is this for?', options: [
      { value: 'W', label: "Women's soccer" }, { value: 'M', label: "Men's soccer" }] },
    { id: 'position', q: 'What position?', options: [
      { value: 'GK', label: 'Goalkeeper' }, { value: 'D', label: 'Defender' },
      { value: 'M', label: 'Midfielder' }, { value: 'F', label: 'Forward' }] },
    { id: 'hs_class', q: 'High school graduating class?', options: classOptions(now) },
    { id: 'home', q: 'Where is home?', input: { placeholder: 'Town and state, or ZIP code (e.g. Dublin, OH or 43017)', required: true } },
    { id: 'distance', q: 'How far from home would you go?', options: [
      { value: '120', label: 'About 2 hours' }, { value: '240', label: 'About 4 hours' },
      { value: '360', label: 'About 6 hours' }, { value: 'any', label: 'Anywhere' }] },
    { id: 'state', q: 'In your home state?', options: [
      { value: 'either', label: 'Either is fine' }, { value: 'out', label: 'Out of state only' },
      { value: 'in', label: 'Home state only' }] },
    { id: 'level', q: 'Which level?', options: [
      { value: 'D1', label: 'NCAA D1 only' }, { value: 'D1D2', label: 'NCAA D1 or D2' },
      { value: 'D2D3', label: 'NCAA D2 or D3' }, { value: 'NAIA_JC', label: 'NAIA or junior college' },
      { value: 'open', label: 'Open to any level' }] },
    { id: 'playing_time', q: 'What matters more?', options: [
      { value: 'early', label: 'Playing early (more minutes sooner)' },
      { value: 'level', label: 'Playing at the highest level' },
      { value: 'balance', label: 'A balance of both' }] },
    { id: 'size', q: 'School size?', options: [
      { value: 'small', label: 'Small (under 5,000 students)' }, { value: 'mid', label: 'Mid-size (5,000 to 15,000)' },
      { value: 'large', label: 'Large (over 15,000)' }, { value: 'any', label: 'No preference' }] },
    { id: 'type', q: 'Public or private?', options: [
      { value: 'public', label: 'Public' }, { value: 'private', label: 'Private' }, { value: 'either', label: 'Either' }] },
    { id: 'cost', q: 'Most the family wants to pay per year (after aid)?', options: [
      { value: '15000', label: 'Under $15,000' }, { value: '25000', label: 'Under $25,000' },
      { value: '35000', label: 'Under $35,000' }, { value: 'any', label: 'Not a deciding factor' }] },
    { id: 'test', q: 'Test score?', score: true, options: [
      { value: 'SAT', label: 'SAT' }, { value: 'ACT', label: 'ACT' }, { value: 'none', label: 'Not taken yet' }] },
    { id: 'major', q: 'Intended major?', input: { placeholder: 'e.g. nursing, engineering, business (optional)', required: false },
      options: [{ value: 'undecided', label: 'Undecided' }] },
  ]
}

const LEVEL_WORDS = {
  D1: 'NCAA D1 only', D1D2: 'NCAA D1 or D2', D2D3: 'NCAA D2 or D3',
  NAIA_JC: 'NAIA or junior college', open: 'any level',
}
const SIZE_WORDS = { small: 'small (under 5,000 undergraduates)', mid: 'mid-size (5,000 to 15,000 undergraduates)', large: 'large (over 15,000 undergraduates)' }
const POS_WORDS = { GK: 'goalkeeper', D: 'defender', M: 'midfielder', F: 'forward' }

// A valid score for the chosen test, or null.
export function cleanScore(test, raw) {
  const n = Number(String(raw ?? '').trim())
  if (!Number.isFinite(n)) return null
  if (test === 'SAT' && n >= 400 && n <= 1600) return Math.round(n)
  if (test === 'ACT' && n >= 1 && n <= 36) return Math.round(n)
  return null
}

// The answers as the first message to the assistant. It starts with
// "Quick quiz answers:" so the assistant knows it has the whole profile and
// searches at once instead of asking clarifying questions.
export function quizMessage(a) {
  const lines = []
  lines.push(`Program: ${a.gender === 'M' ? "men's" : "women's"} soccer.`)
  if (a.position) lines.push(`Position: ${POS_WORDS[a.position] || a.position}.`)
  if (a.hs_class) lines.push(`High school class of ${a.hs_class}.`)
  if (a.home) lines.push(`Home: ${String(a.home).trim()}.`)
  if (a.distance && a.distance !== 'any') lines.push(`Distance: within about ${Number(a.distance) / 60} hours of home (${a.distance} miles).`)
  else if (a.distance === 'any') lines.push('Distance: anywhere.')
  if (a.state === 'out') lines.push('Out of state only.')
  else if (a.state === 'in') lines.push('Home state only.')
  if (a.level) lines.push(`Level: ${LEVEL_WORDS[a.level] || a.level}.`)
  if (a.playing_time === 'early') lines.push('Priority: playing early, more minutes sooner.')
  else if (a.playing_time === 'level') lines.push('Priority: playing at the highest level.')
  else if (a.playing_time === 'balance') lines.push('Priority: a balance of early playing time and level.')
  if (a.size && a.size !== 'any') lines.push(`School size: ${SIZE_WORDS[a.size]}.`)
  if (a.type && a.type !== 'either') lines.push(`${a.type === 'public' ? 'Public' : 'Private'} colleges.`)
  if (a.cost && a.cost !== 'any') lines.push(`Cost: under $${Number(a.cost).toLocaleString('en-US')} a year net price.`)
  const score = cleanScore(a.test, a.score)
  if (score != null) lines.push(`Test score: ${a.test} ${score}.`)
  else if (a.test === 'none') lines.push('No SAT or ACT score yet.')
  const major = String(a.major || '').trim()
  if (major && major.toLowerCase() !== 'undecided') lines.push(`Intended major: ${major}.`)
  else lines.push('Major: undecided.')
  return `Quick quiz answers: ${lines.join(' ')}\nPlease recommend a shortlist of programs that fit, with the trade-offs between them.`
}
