import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getActiveSeasonId } from '../lib/season'
import { gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'
import HamburgerMenu from '../components/HamburgerMenu'
import FeedbackButton from '../components/FeedbackButton'
import PullToRefresh from '../components/PullToRefresh'

/**
 * Team × College Recruiting Detail at /t/:teamSlug/college/:schoolId
 *
 * The contextual drill-in from a team page's recruiting hero. Answers the
 * actual question parents ask when they tap an "Ohio State" pill:
 * "Which Ohio State coaches showed up at OUR games, and how do I reach
 * them?" — not "show me every Ohio State coach in the database."
 *
 * Layout:
 *  - Breadcrumb + back link to the team page
 *  - School identity card (cyan recruiting theme, matches hero panel)
 *  - "N coaches attended M of your games" summary
 *  - Coach cards, sorted by attendance count (most invested first):
 *      • Avatar (initials) + name + title
 *      • Contact rows (mailto / tel, with "no X on file" fallbacks so
 *        crowdsourcing the missing pieces stays one tap away via the
 *        directory)
 *      • Games attended — opponent, date, event, W/L/T score badge
 *  - "View all N coaches at <school>" link out to the directory for the
 *    broader exploration use case (assistants who haven't shown up yet,
 *    full staff lookup, etc.)
 *
 * Empty state: when no coaches from this school have attended any of
 * this team's games yet, we show a friendly message and a direct link
 * to the school's full directory entry — the user still gets value, just
 * not the team-contextual slice they expected.
 *
 * Inactive coaches: still rendered in their historical attendance, same
 * pattern as the Parent Summary and CSV exports. The strikethrough +
 * "(Inactive)" badge makes their current status legible without erasing
 * the recruiting record.
 *
 * Closed games: included. A closed game still counts as "this coach
 * watched us play"; the lock only affects whether new attendance can be
 * logged.
 */
export default function TeamCollegeDetail() {
  const { teamSlug, schoolId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [school, setSchool] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [totalSchoolCoaches, setTotalSchoolCoaches] = useState(0)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const activeSeasonId = await getActiveSeasonId()
      if (!activeSeasonId) {
        setError('No active season configured.')
        setLoading(false)
        return
      }

      // Team — slug + active season matches PublicTeamPage's resolution.
      const { data: teamData, error: teamErr } = await supabase
        .from('teams')
        .select('id, name, slug, gender')
        .eq('slug', teamSlug)
        .eq('season_id', activeSeasonId)
        .maybeSingle()
      if (teamErr || !teamData) {
        setError('Team not found.')
        setLoading(false)
        return
      }

      // School — straight id lookup. Even if a school later gets merged in
      // dedup, the old id stays in the URL until the redirect catches up;
      // showing "School not found" is the honest answer in that window.
      const { data: schoolData, error: schoolErr } = await supabase
        .from('schools')
        .select('id, school, city, state, division, conference, program_gender')
        .eq('id', schoolId)
        .maybeSingle()
      if (schoolErr || !schoolData) {
        setError('College not found.')
        setLoading(false)
        return
      }

      setTeam(teamData)
      setSchool(schoolData)

      // Attendance × coaches × games, filtered by school AND team via the
      // !inner joins. The .eq() chains here are filtering on the joined
      // tables, which Supabase supports when the relationship is marked
      // !inner.
      const { data: attendanceData, error: attErr } = await supabase
        .from('attendance')
        .select(`
          id,
          coach_id,
          game_id,
          coaches!inner (
            id, first_name, last_name, email, phone, title, is_active, school_id
          ),
          games!inner (
            id, team_id, game_date, game_time, opponent,
            our_score, opponent_score, is_closed,
            events (id, event_name, slug)
          )
        `)
        .eq('coaches.school_id', schoolId)
        .eq('games.team_id', teamData.id)
      if (attErr) throw attErr
      setAttendance(attendanceData || [])

      // Total active coaches at this school — drives the "View all N
      // coaches" footer link count. Active only, since the directory
      // hides inactive by default and the count should match what the
      // user will see when they tap through.
      const { count } = await supabase
        .from('coaches')
        .select('id', { count: 'exact', head: true })
        .eq('school_id', schoolId)
        .eq('is_active', true)
      setTotalSchoolCoaches(count || 0)
    } catch (e) {
      console.error('TeamCollegeDetail load failed:', e)
      setError('Failed to load recruiting detail.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // teamSlug and schoolId are the page identity — re-running on either
    // change is correct (e.g. if a future "next college" navigation links
    // between schools without unmounting).
  }, [teamSlug, schoolId])

  // Group attendance by coach. Sort coaches by attendance count desc
  // (most invested first), then last name asc as the tiebreaker. Within
  // each coach, sort games most-recent-first.
  const coachAttendance = useMemo(() => {
    const byCoach = new Map()
    attendance.forEach((a) => {
      if (!a.coaches || !a.games) return
      if (!byCoach.has(a.coach_id)) {
        byCoach.set(a.coach_id, { coach: a.coaches, games: [] })
      }
      byCoach.get(a.coach_id).games.push(a.games)
    })
    byCoach.forEach((entry) => {
      entry.games.sort((a, b) => {
        const da = a.game_date || ''
        const db = b.game_date || ''
        return db.localeCompare(da)
      })
    })
    return Array.from(byCoach.values()).sort((a, b) => {
      if (b.games.length !== a.games.length) {
        return b.games.length - a.games.length
      }
      return (a.coach.last_name || '').localeCompare(b.coach.last_name || '')
    })
  }, [attendance])

  // Distinct game count across all coach attendance — the "M of your
  // games" denominator in the summary line. Two coaches at the same game
  // counts as one game for this purpose.
  const uniqueGameCount = useMemo(() => {
    const ids = new Set()
    attendance.forEach((a) => {
      if (a.game_id) ids.add(a.game_id)
    })
    return ids.size
  }, [attendance])

  const directoryHref = `/directory?school=${encodeURIComponent(schoolId)}&from=${encodeURIComponent(teamSlug)}`

  return (
    <PullToRefresh onRefresh={load}>
      <div className="min-h-screen bg-gray-50">
        <header className="bg-slate-900 text-white">
          <div className="max-w-5xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
            <Link to="/home" className="flex items-center gap-3 hover:opacity-80">
              <OPLogo className="h-10 w-10" />
              <div>
                <div className="font-semibold">Ohio Premier Soccer</div>
                <div className="text-xs text-cyan-300">PitchSide</div>
              </div>
            </Link>
            <HamburgerMenu />
          </div>
          <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
        </header>

        <main className="max-w-5xl mx-auto px-4 py-6">
          {/* Breadcrumb — Home › Team › College. Team is a link when
              loaded so users can jump straight back without going via
              the "Back to" affordance. */}
          <nav className="text-sm text-gray-500 mb-4">
            <Link to="/home" className="hover:text-gray-700">
              Home
            </Link>
            <span className="mx-2">›</span>
            {team ? (
              <Link to={`/t/${teamSlug}`} className="hover:text-gray-700">
                {team.name}
              </Link>
            ) : (
              <span>Team</span>
            )}
            <span className="mx-2">›</span>
            <span className="text-gray-700">{school?.school || 'College'}</span>
          </nav>

          {team && (
            <Link
              to={`/t/${teamSlug}`}
              className="inline-flex items-center gap-1 text-sm text-cyan-700 hover:text-cyan-900 font-medium mb-3"
            >
              <ChevronLeftIcon />
              Back to {team.name}
            </Link>
          )}

          {loading ? (
            <div className="text-center py-12 text-gray-500">Loading...</div>
          ) : error ? (
            <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 text-center">
              {error}
            </div>
          ) : (
            <>
              {/* College identity card — cyan recruiting theme matches the
                  hero panel on the team page, reinforcing visual
                  continuity from where the user came. */}
              <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg p-4 sm:p-5 mb-4">
                <div className="text-[10px] uppercase tracking-wide font-semibold text-cyan-700 mb-1">
                  College recruiting
                </div>
                <h1 className="text-2xl sm:text-3xl font-bold text-cyan-900 leading-tight">
                  {school.school}
                </h1>
                <p className="text-sm text-cyan-700 mt-1">
                  {[
                    school.city && school.state
                      ? `${school.city}, ${school.state}`
                      : null,
                    school.division || null,
                    school.conference || null,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
              </div>

              {coachAttendance.length > 0 ? (
                <p className="text-sm text-gray-700 mb-3">
                  <span className="font-semibold">
                    {coachAttendance.length}
                  </span>{' '}
                  {coachAttendance.length === 1 ? 'coach' : 'coaches'} attended{' '}
                  <span className="font-semibold">{uniqueGameCount}</span>{' '}
                  {uniqueGameCount === 1 ? 'of your games' : 'of your games'}
                </p>
              ) : (
                <div className="bg-white border border-gray-200 rounded-lg p-6 text-center mb-4">
                  <p className="text-gray-700 mb-3">
                    No {school.school} coaches have attended {team.name} games
                    yet.
                  </p>
                  <Link
                    to={directoryHref}
                    className="inline-flex items-center gap-1 text-sm text-cyan-700 hover:text-cyan-900 font-medium"
                  >
                    Browse all {school.school} coaches in the directory
                    <ArrowRightIcon />
                  </Link>
                </div>
              )}

              <div className="space-y-3 mb-4">
                {coachAttendance.map(({ coach, games }) => (
                  <CoachAttendanceCard
                    key={coach.id}
                    coach={coach}
                    games={games}
                  />
                ))}
              </div>

              {/* "View all N coaches" footer — only when there are coaches
                  at this school beyond those who attended. If everyone at
                  the school has attended (rare but possible for small
                  staffs), the footer would say "View all 2 coaches" when
                  the user just saw 2; that's noise so we hide it. */}
              {totalSchoolCoaches > coachAttendance.length && (
                <Link
                  to={directoryHref}
                  className="flex items-center justify-between px-4 py-3 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                >
                  <span className="text-sm text-cyan-700 font-medium">
                    View all {totalSchoolCoaches} coaches at {school.school}
                  </span>
                  <ArrowRightIcon />
                </Link>
              )}
            </>
          )}
        </main>
        <FeedbackButton />
      </div>
    </PullToRefresh>
  )
}

/**
 * CoachAttendanceCard — one card per coach who attended any of this team's
 * games. Shows identity, contact, and the specific games attended with
 * results. Designed so a parent can scan the list and decide quickly which
 * coach to email first.
 */
function CoachAttendanceCard({ coach, games }) {
  const initials = `${(coach.first_name || '').charAt(0)}${(coach.last_name || '').charAt(0)}`.toUpperCase()
  const isInactive = coach.is_active === false

  return (
    <div className="bg-white border border-gray-200 rounded-lg shadow-sm p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-cyan-100 flex items-center justify-center font-semibold text-sm text-cyan-700 flex-shrink-0">
          {initials || '?'}
        </div>
        <div className="min-w-0 flex-1">
          <p
            className={`text-base font-semibold ${
              isInactive
                ? 'text-gray-400 line-through'
                : 'text-gray-900'
            }`}
          >
            {coach.first_name} {coach.last_name}
          </p>
          {(coach.title || isInactive) && (
            <p className="text-xs text-gray-500">
              {coach.title || ''}
              {isInactive && (
                <span className="ml-1 text-gray-500">(Inactive)</span>
              )}
            </p>
          )}
        </div>
      </div>

      {/* Contact rows — mailto/tel when present, "no X on file" fallbacks
          when missing. Missing contact info isn't a dead end: the
          crowdsource loop is preserved via the directory link in the
          footer, where any parent can add what they know. */}
      <div className="border-t border-gray-100 pt-3 space-y-1">
        {coach.email ? (
          <a
            href={`mailto:${coach.email}`}
            className="flex items-center gap-2 text-sm text-cyan-700 hover:text-cyan-900 break-all py-1"
          >
            <MailIcon />
            <span className="min-w-0">{coach.email}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
            <MailIcon />
            <span className="italic">no email on file</span>
          </div>
        )}
        {coach.phone ? (
          <a
            href={`tel:${coach.phone.replace(/[^+0-9]/g, '')}`}
            className="flex items-center gap-2 text-sm text-cyan-700 hover:text-cyan-900 py-1"
          >
            <PhoneIcon />
            <span>{coach.phone}</span>
          </a>
        ) : (
          <div className="flex items-center gap-2 text-sm text-gray-400 py-1">
            <PhoneIcon />
            <span className="italic">no phone on file</span>
          </div>
        )}
      </div>

      <div className="border-t border-gray-100 pt-3 mt-3">
        <div className="text-[10px] uppercase tracking-wide font-medium text-gray-500 mb-1">
          Attended {games.length} {games.length === 1 ? 'game' : 'games'}
        </div>
        <ul className="divide-y divide-gray-100">
          {games.map((g) => (
            <AttendedGameRow key={g.id} game={g} />
          ))}
        </ul>
      </div>
    </div>
  )
}

/**
 * AttendedGameRow — single row inside a coach's attendance list. Shows
 * opponent on top, date + event below, and a colored W/L/T score badge
 * on the right when a score is set. Games without scores logged yet
 * simply omit the badge — a coach came to watch but we don't know the
 * outcome yet, and a placeholder there would read as noise.
 */
function AttendedGameRow({ game }) {
  // gameResult returns { label, color, score } — label is 'W'/'L'/'T'
  // (falsy when no scores set), color is a Tailwind class string, score
  // is the formatted score like "3-1". Same shape as PublicTeamPage uses
  // for its inline game badges, so the visual cue is consistent.
  const r = gameResult(game)
  return (
    <li className="flex items-center justify-between gap-2 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-gray-900 truncate">
          vs {game.opponent || '—'}
        </p>
        <p className="text-xs text-gray-500 truncate">
          {formatGameDate(game.game_date)}
          {game.events?.event_name ? ` · ${game.events.event_name}` : ''}
        </p>
      </div>
      {r.label && (
        <span
          className={`text-xs font-bold px-2 py-0.5 rounded tabular-nums flex-shrink-0 whitespace-nowrap ${r.color}`}
        >
          {r.label} {r.score}
        </span>
      )}
    </li>
  )
}

/**
 * formatGameDate — manual parse to avoid UTC shift. Same pattern used in
 * the rest of the app (see "Date timezone bug" entry in Build Status).
 * A YYYY-MM-DD string parsed by `new Date(str)` would land in UTC and
 * potentially shift a day in non-UTC viewers; constructing from the
 * parts keeps the date local.
 */
function formatGameDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = String(dateStr).split('-')
  if (!y || !m || !d) return dateStr
  const dt = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function ChevronLeftIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="m15 18-6-6 6-6" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <rect width="20" height="16" x="2" y="4" rx="2" />
      <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    </svg>
  )
}

function PhoneIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className="flex-shrink-0"
    >
      <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
    </svg>
  )
}

function ArrowRightIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}
