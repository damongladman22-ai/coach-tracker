/**
 * Find programs — coach attendance as an interest signal (backlog F5, Damon
 * 2026-10-09: flag + filter, the openings ranking unchanged). Pure; tested by
 * test/attendanceSignal.test.mjs.
 *
 * The family picks one of the club's teams (their starred team is chosen for
 * them). Every college program whose coaches have logged attendance at that
 * team's games gets a "Watched your team" badge and a reason line, and a
 * switch narrows the list to those programs. The ranking itself never changes.
 *
 * SEASONS (Damon 2026-10-09: carry over automatically). Players move up one
 * age group each season, so a team's history is its LINEAGE: the same
 * program (ECNL, ECNL RL, ...), the same gender, one age group younger in
 * each earlier season (2026-27 U17 Girls ECNL <- 2025-26 U16 Girls ECNL).
 * Picking a team counts attendance at every team in its lineage. A season
 * with no match, or with more than one, ends the lineage there rather than
 * guess. A starred team from an earlier season selects its successor.
 *
 * DATA: attendance rows for the lineage's games, each with its coach's school
 * (coaches.school_id; a men's and a women's program are separate schools
 * rows, so a women's search only matches women's coaching staffs) and the
 * game's date. One coach at several games counts once as a coach; one game
 * with several coaches counts once as a game.
 */

/** Club team gender -> program_gender ('W' | 'M'), or null when unknown. */
export function teamProgramGender(teamGender) {
  const g = String(teamGender || '').toLowerCase()
  if (/girl|women|female/.test(g)) return 'W'
  if (/boy|men|male/.test(g)) return 'M'
  return null
}

/**
 * Teams to offer for a women's / men's search: the club's teams whose gender
 * matches (teams with an unknown gender are always offered), sorted by name.
 */
export function teamsFor(teams, programGender) {
  return (teams || [])
    .filter(t => { const g = teamProgramGender(t.gender); return !programGender || !g || g === programGender })
    .slice()
    .sort((a, b) => String(a.name).localeCompare(String(b.name)))
}

/** Age number of a club team: from its age group ('U16'), else its name. */
export function teamAge(team) {
  const m = /U\s*(\d+)/i.exec(team?.age_groups?.name || '') || /\bU\s*(\d+)/i.exec(team?.name || '')
  return m ? Number(m[1]) : null
}

/**
 * The team and its predecessors, newest first:
 *   [{ team, season }] where season is the seasons row.
 * teams: every club team (any season), each { id, name, gender, season_id,
 * program_id, age_groups: { name } }; seasons: [{ id, start_date }].
 */
export function lineage(team, teams, seasons) {
  if (!team) return []
  const order = (seasons || []).slice().sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
  const idx = order.findIndex(s => String(s.id) === String(team.season_id))
  const out = [{ team, season: order[idx] || null }]
  const age = teamAge(team)
  const g = teamProgramGender(team.gender)
  if (idx < 0 || age == null || team.program_id == null) return out
  for (let k = 1; idx - k >= 0; k++) {
    const season = order[idx - k]
    const cands = (teams || []).filter(t => String(t.season_id) === String(season.id) &&
      String(t.program_id) === String(team.program_id) && teamProgramGender(t.gender) === g &&
      teamAge(t) === age - k)
    if (cands.length !== 1) break
    out.push({ team: cands[0], season })
  }
  return out
}

/**
 * The team to pick by default: the first starred team on offer, or the
 * team on offer whose lineage contains a starred team (a star kept from an
 * earlier season); else none.
 */
export function defaultTeamId(offered, favorites, teams = null, seasons = null) {
  const fav = new Set((favorites || []).map(String))
  const now = (offered || []).find(x => fav.has(String(x.id)))
  if (now) return now.id
  if (teams && seasons) {
    const t = (offered || []).find(x => lineage(x, teams, seasons).some(l => fav.has(String(l.team.id))))
    if (t) return t.id
  }
  return null
}

/**
 * Attendance rows -> Map(school_id -> { coaches, games, latest }).
 *   rows: [{ coach_id, game_id, coaches: { school_id }, games: { game_date } }]
 * latest is the most recent game date ('YYYY-MM-DD') or null.
 */
export function summarizeAttendance(rows) {
  const acc = new Map()
  for (const r of rows || []) {
    const sid = r.coaches?.school_id
    if (!sid) continue
    const a = acc.get(sid) || { coaches: new Set(), games: new Set(), latest: null }
    if (r.coach_id != null) a.coaches.add(r.coach_id)
    if (r.game_id != null) a.games.add(r.game_id)
    const d = r.games?.game_date || null
    if (d && (!a.latest || d > a.latest)) a.latest = d
    acc.set(sid, a)
  }
  const out = new Map()
  for (const [sid, a] of acc) out.set(sid, { coaches: a.coaches.size, games: a.games.size, latest: a.latest })
  return out
}

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December']

/** 'YYYY-MM-DD' -> 'July 14, 2026' (no time zone shifts), or null. */
export function longDate(d) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(d || ''))
  if (!m) return null
  return `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}, ${m[1]}`
}

/** The reason line, or null when the program has not watched the team. */
export function attendanceReason(sig) {
  if (!sig || !sig.coaches) return null
  const who = sig.coaches === 1 ? '1 coach from this program' : `${sig.coaches} coaches from this program`
  const verb = 'attended'
  const games = sig.games === 1 ? '1 of your games' : `${sig.games} of your games`
  const when = sig.latest ? `, most recently ${longDate(sig.latest)}` : ''
  return `${who} ${verb} ${games}${when}.`
}
