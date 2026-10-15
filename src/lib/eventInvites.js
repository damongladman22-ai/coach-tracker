/**
 * eventInvites — "invite college coaches to my event" (recruiting resources
 * review item 4, Damon 2026-10-15: from the assistant, typed or from a chip).
 *
 * Pure: no React, no Supabase. api/ask.js (event_invite_facts) loads the rows;
 * these helpers pick the event, format the team's games and rank the programs
 * worth inviting. Tested by test/eventInvites.test.mjs.
 *
 * WHO TO INVITE
 *  - Programs whose coaches were logged at an earlier edition of the same event
 *    (same name once years are taken out, e.g. "ECNL Florida Fall 2025" and
 *    "ECNL Florida Fall"), at games of club teams of the same gender.
 *  - Programs whose coaches have watched this team (its lineage: the same
 *    players in earlier seasons).
 *  - Both first, then by games watched of this team, then by coaches seen at
 *    the event. Only programs of the team's gender.
 */

const norm = s => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim()

/** An event's name without years or season labels: the key that ties editions together. */
export function eventKey(name) {
  return norm(String(name || '')
    .replace(/\b(19|20)\d\d\s*[-/]\s*\d{2,4}\b/g, ' ')
    .replace(/\b(19|20)\d\d\b/g, ' '))
}

const DAY = 24 * 3600 * 1000
/** True for a tournament or showcase (a few days), false for a season-long league schedule. */
export function isShowcase(ev) {
  if (!ev?.start_date || !ev?.end_date) return true
  return (Date.parse(ev.end_date) - Date.parse(ev.start_date)) / DAY <= 10
}

/**
 * Upcoming events -> the one asked for.
 *   query: words from the question ("Phoenix", "Florida showcase"), or empty.
 * Returns { event } or { choices } (several fit, or none was named and more
 * than one showcase is coming up).
 */
export function pickEvent(upcoming, query) {
  const list = upcoming || []
  if (!list.length) return { choices: [] }
  const q = norm(query).replace(/\b(the|event|showcase|tournament|games|schedule|my|our)\b/g, ' ').replace(/\s+/g, ' ').trim()
  if (q) {
    const words = q.split(' ').filter(Boolean)
    const hit = list.filter(e => { const n = norm(e.event_name); return words.every(w => n.includes(w)) })
    if (hit.length === 1) return { event: hit[0] }
    if (hit.length > 1) return { choices: hit }
    const some = list.filter(e => { const n = norm(e.event_name); return words.some(w => w.length > 2 && n.includes(w)) })
    if (some.length === 1) return { event: some[0] }
    return { choices: some.length ? some : list }
  }
  const shows = list.filter(isShowcase)
  if (shows.length === 1) return { event: shows[0] }
  return { choices: shows.length ? shows : list }
}

const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const TZ = {
  'America/New_York': 'ET', 'America/Detroit': 'ET', 'America/Indiana/Indianapolis': 'ET', 'America/Chicago': 'CT',
  'America/Denver': 'MT', 'America/Phoenix': 'MT (Arizona)', 'America/Los_Angeles': 'PT',
}
/** A game as one line: "Sat, Dec 5, 9:00 AM ET vs Florida United". */
export function gameLine(g) {
  const parts = []
  if (g.game_date) {
    const [y, m, d] = String(g.game_date).slice(0, 10).split('-').map(Number)
    const dt = new Date(Date.UTC(y, m - 1, d))
    parts.push(`${WD[dt.getUTCDay()]}, ${MO[m - 1]} ${d}`)
  }
  if (g.game_time) {
    const [h, min] = String(g.game_time).split(':').map(Number)
    const ap = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 === 0 ? 12 : h % 12
    parts.push(`${h12}:${String(min || 0).padStart(2, '0')} ${ap}${g.timezone && TZ[g.timezone] ? ' ' + TZ[g.timezone] : ''}`)
  }
  let s = parts.join(', ')
  if (g.opponent) s += ` vs ${g.opponent}`
  return s || 'time to be announced'
}

/**
 * Programs to invite.
 *   pastRows: attendance at earlier editions of the event, same-gender teams:
 *             { coach_id, game_id, coaches: { school_id, first_name, last_name, title, is_active }, season }
 *   teamRows: attendance at this team's (lineage) games, same shape.
 *   schoolOf: Map(school_id -> { school, program_gender, division, conference, state })
 *   gender:   'W' | 'M' (program gender of the team)
 * Returns [{ school_id, school, division, conference, state, at_event_before, watched_your_team, why }].
 */
export function inviteList(pastRows, teamRows, schoolOf, gender) {
  const per = new Map()
  const get = sid => { let p = per.get(sid); if (!p) per.set(sid, (p = { ev: new Map(), evSeasons: new Set(), team: new Set(), teamCoaches: new Map() })); return p }
  const nameOf = c => `${c?.first_name || ''} ${c?.last_name || ''}`.trim()
  for (const r of pastRows || []) {
    const sid = r.coaches?.school_id
    if (!sid) continue
    const p = get(sid)
    const n = nameOf(r.coaches)
    if (n) p.ev.set(n.toLowerCase(), { name: n, title: r.coaches.title || null, on_staff: r.coaches.is_active !== false })
    if (r.season) p.evSeasons.add(r.season)
  }
  for (const r of teamRows || []) {
    const sid = r.coaches?.school_id
    if (!sid) continue
    const p = get(sid)
    if (r.game_id != null) p.team.add(r.game_id)
    const n = nameOf(r.coaches)
    if (n) p.teamCoaches.set(n.toLowerCase(), n)
  }
  const out = []
  for (const [sid, p] of per) {
    const s = schoolOf.get(sid)
    if (!s || (gender && s.program_gender !== gender)) continue
    const evCoaches = [...p.ev.values()]
    const atEvent = evCoaches.length > 0
    const games = p.team.size
    const why = []
    if (games) why.push(`coaches have watched your team (${games} ${games === 1 ? 'game' : 'games'}: ${[...p.teamCoaches.values()].slice(0, 3).join(', ')})`)
    if (atEvent) why.push(`coaches were logged at this event before (${[...p.evSeasons].sort().join(', ') || 'an earlier season'}: ${evCoaches.slice(0, 3).map(c => c.name + (c.on_staff ? '' : ' (no longer on staff)')).join(', ')})`)
    out.push({
      school_id: sid, school: s.school, division: s.division, conference: s.conference, state: s.state,
      at_event_before: atEvent ? { seasons: [...p.evSeasons].sort(), coaches: evCoaches.map(c => c.name) } : null,
      watched_your_team: games ? { games, coaches: [...p.teamCoaches.values()] } : null,
      why: why.join('; '),
      _score: (atEvent && games ? 1000 : 0) + games * 10 + evCoaches.length,
    })
  }
  return out.sort((a, b) => b._score - a._score || String(a.school).localeCompare(String(b.school)))
    .map(x => { const y = { ...x }; delete y._score; return y })
}
