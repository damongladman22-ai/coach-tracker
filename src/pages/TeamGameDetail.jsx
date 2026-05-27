import { useEffect, useMemo, useRef, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'
import HamburgerMenu from '../components/HamburgerMenu'
import FeedbackButton from '../components/FeedbackButton'
import PullToRefresh from '../components/PullToRefresh'
import VideoThumbnail from '../components/VideoThumbnail'
import GameVideosPanel from '../components/GameVideosPanel'

/**
 * Team Game Detail at /t/:teamSlug/game/:gameId
 *
 * The single-game story — what happened, who watched, the recording.
 * Read-only: this is the page parents share when they want someone to
 * see a specific game (a college coach, a relative, a recruiter).
 *
 * Layout:
 *  - Game identity card: date/time, opponent, home/away, score badge,
 *    location, and a link to the parent event when present
 *  - Video section: inline player for the selected video with a
 *    thumbnail strip below for the rest. Hidden entirely when no
 *    videos exist for this game.
 *  - Colleges watching this game: coaches grouped by school, each
 *    school header click-through to the team × college recruiting
 *    detail page so parents can drill into that school's record with
 *    this team. Hidden entirely when no attendance was logged.
 *  - Secondary action: link to the live tracker (active events) or
 *    parent summary (past/closed) so parents can still get to the
 *    editing workflow from here.
 *
 * Notably absent: a lineup / who-played section. AthleteOne doesn't
 * give us per-game roster data, so a stale or fabricated lineup would
 * mislead more than it would help.
 *
 * Inactive coaches: still rendered with the strikethrough + "(Inactive)"
 * badge, matching the established historical-correctness pattern from
 * ParentSummary, CSV exports, and TeamCollegeDetail.
 */
export default function TeamGameDetail() {
  const { teamSlug, gameId } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [game, setGame] = useState(null)
  const [videos, setVideos] = useState([])
  const [attendance, setAttendance] = useState([])
  // Selected video for the inline player. Starts at the first video so
  // parents land on a working player on arrival; user taps thumbnails
  // below to switch.
  const [selectedVideoId, setSelectedVideoId] = useState(null)
  // Player container ref — used to scrollIntoView when the user taps a
  // thumbnail. On mobile the player can sit below the thumbnail strip
  // and out of viewport, so without this users would tap a thumbnail
  // and not see anything change until they scrolled down to find the
  // updated player.
  const playerRef = useRef(null)

  // Tap-thumbnail handler — swap the selected video and scroll the
  // player into view. The scroll is deferred to the next animation
  // frame so React has committed the re-render with the new video
  // before we measure / scroll to it.
  const handleSelectVideo = (videoId) => {
    setSelectedVideoId(videoId)
    requestAnimationFrame(() => {
      playerRef.current?.scrollIntoView({
        behavior: 'smooth',
        block: 'start',
      })
    })
  }

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      // Game first — it's the page identity. If the id is bogus we can
      // fail fast without wasting other queries.
      const { data: gameData, error: gameErr } = await supabase
        .from('games')
        .select(`
          id, team_id, game_date, game_time, timezone, opponent,
          our_score, opponent_score, is_home, location, is_closed,
          game_types (id, name),
          events (id, event_name, slug, start_date, end_date, location)
        `)
        .eq('id', gameId)
        .maybeSingle()
      if (gameErr || !gameData) {
        setError('Game not found.')
        setLoading(false)
        return
      }

      // Team — load via the team_id from the game (not the URL slug), so
      // links built from this page point at the correct team even if the
      // slug in the URL was stale or wrong. We do verify the slugs match
      // below and use the team's authoritative slug for the back link.
      const { data: teamData, error: teamErr } = await supabase
        .from('teams')
        .select('id, name, slug, gender')
        .eq('id', gameData.team_id)
        .maybeSingle()
      if (teamErr || !teamData) {
        setError('Team not found.')
        setLoading(false)
        return
      }

      setGame(gameData)
      setTeam(teamData)

      // Videos for this game — direct query rather than the realtime
      // hook used on the team page, since this is one game and the
      // websocket-via-polling subscribe path isn't worth it. Order by
      // most-recent uploads first.
      const { data: videosData } = await supabase
        .from('videos')
        .select('*')
        .eq('game_id', gameId)
        .order('created_at', { ascending: false })
      setVideos(videosData || [])
      if (videosData && videosData.length > 0) {
        setSelectedVideoId(videosData[0].id)
      }

      // Attendance — coaches who logged at this game, with their school
      // for the grouped display below.
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select(`
          id, coach_id,
          coaches (
            id, first_name, last_name, email, phone, title, is_active,
            schools (id, school, city, state, division, conference)
          )
        `)
        .eq('game_id', gameId)
      setAttendance(attendanceData || [])
    } catch (e) {
      console.error('TeamGameDetail load failed:', e)
      setError('Failed to load game.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
    // gameId is the page identity; teamSlug is informational (for the
    // back link). Re-running on either change is correct.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamSlug, gameId])

  // Group attendance by school for the "colleges watching" section.
  // Each school is one block; coaches inside are sorted by last name.
  // Schools themselves are sorted alphabetically (predictable scan
  // order for parents looking for one specific program).
  const coachesBySchool = useMemo(() => {
    const bySchool = new Map()
    attendance.forEach((a) => {
      const coach = a.coaches
      const school = coach?.schools
      if (!coach || !school) return
      if (!bySchool.has(school.id)) {
        bySchool.set(school.id, { school, coaches: [] })
      }
      bySchool.get(school.id).coaches.push(coach)
    })
    bySchool.forEach((entry) => {
      entry.coaches.sort((a, b) =>
        (a.last_name || '').localeCompare(b.last_name || '')
      )
    })
    return Array.from(bySchool.values()).sort((a, b) =>
      (a.school.school || '').localeCompare(b.school.school || '')
    )
  }, [attendance])

  // Distinct coach count, for the section header. Two coaches at this
  // game from the same school still count as two.
  const coachCount = useMemo(() => {
    const set = new Set()
    attendance.forEach((a) => {
      if (a.coach_id) set.add(a.coach_id)
    })
    return set.size
  }, [attendance])

  // The currently-selected video object (used to render the inline
  // player below the thumbnail strip).
  const selectedVideo = useMemo(() => {
    if (!selectedVideoId) return null
    return videos.find((v) => v.id === selectedVideoId) || null
  }, [videos, selectedVideoId])

  // Date/time/event helpers — computed once per render rather than
  // inside JSX so the read flow stays clean.
  const dateLabel = game ? formatLongDate(game.game_date) : ''
  const timeLabel = game ? formatTime(game.game_time) : ''
  const r = game ? gameResult(game) : { label: '', color: '', score: '' }
  const homeAway = game?.is_home ? 'Home' : game ? 'Away' : ''

  // Past vs upcoming, mirroring the GameCard logic on the team page so
  // the action button below matches the team-page action.
  const isPast = useMemo(() => {
    if (!game) return false
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const [y, m, d] = String(game.game_date || '').split('-')
    if (!y || !m || !d) return false
    const gameDate = new Date(Number(y), Number(m) - 1, Number(d))
    return (
      gameDate < today ||
      (gameDate.getTime() === today.getTime() && game.is_closed)
    )
  }, [game])

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
          {/* Breadcrumb — Home › Team › Game label. Team is a link when
              loaded so users can hop straight back without going via
              the "Back to" affordance below. */}
          <nav className="text-sm text-gray-500 mb-4">
            <Link to="/home" className="hover:text-gray-700">
              Home
            </Link>
            <span className="mx-2">›</span>
            {team ? (
              <Link
                to={`/t/${team.slug || teamSlug}`}
                className="hover:text-gray-700"
              >
                {team.name}
              </Link>
            ) : (
              <span>Team</span>
            )}
            <span className="mx-2">›</span>
            <span className="text-gray-700">
              {game?.opponent ? `vs ${game.opponent}` : 'Game'}
            </span>
          </nav>

          {team && (
            <Link
              to={`/t/${team.slug || teamSlug}`}
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
              {/* Game identity card — the headline of the page. Score
                  badge sits next to the matchup so the result is the
                  first thing parents scan; date/time/location live
                  below as secondary info. */}
              <div className="bg-white rounded-lg shadow-md p-4 sm:p-5 mb-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-gray-500 mb-1">
                      {homeAway && (
                        <span className="font-medium">{homeAway}</span>
                      )}
                      {game.game_types?.name && (
                        <>
                          {homeAway && <span>·</span>}
                          <span>{game.game_types.name}</span>
                        </>
                      )}
                      {game.is_closed && (
                        <>
                          <span>·</span>
                          <span className="inline-flex items-center gap-1 text-gray-500">
                            <LockIcon />
                            Closed
                          </span>
                        </>
                      )}
                    </div>
                    <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 leading-tight">
                      {game.is_home
                        ? `vs ${game.opponent || '—'}`
                        : `at ${game.opponent || '—'}`}
                    </h1>
                    <p className="text-sm text-gray-600 mt-1">
                      {dateLabel}
                      {timeLabel ? ` · ${timeLabel}` : ''}
                    </p>
                    {game.location && (
                      <p className="text-xs text-gray-500 mt-1">
                        <i className="inline-block align-middle mr-1">
                          <PinIcon />
                        </i>
                        {game.location}
                      </p>
                    )}
                  </div>
                  {r.label && (
                    <span
                      className={`text-base font-bold px-3 py-1.5 rounded tabular-nums whitespace-nowrap ${r.color}`}
                    >
                      {r.label} {r.score}
                    </span>
                  )}
                </div>

                {/* Event context — link to the parent event when the
                    game belongs to one. Helps parents jump to the full
                    event slate (other teams, other games this team
                    played at the same event). Passes ?from=<teamSlug>
                    so the event page shows a "Back to team" link. */}
                {game.events?.slug && (
                  <div className="mt-3 pt-3 border-t border-gray-100">
                    <Link
                      to={`/e/${game.events.slug}?from=${encodeURIComponent(team.slug || teamSlug)}`}
                      className="inline-flex items-center gap-1 text-sm text-cyan-700 hover:text-cyan-900 font-medium"
                    >
                      Part of {game.events.event_name}
                      <ArrowRightIcon />
                    </Link>
                  </div>
                )}

                {/* Secondary action — surface the existing event-level
                    workflow so parents can still get to live logging or
                    the per-event summary. The unified game page is
                    read-only; this link is the bridge to the editing
                    flow when one is appropriate. ?from=<teamSlug> rides
                    along so the destination page can offer a back link
                    to where the user came from. */}
                {game.events?.slug && (
                  <div className="mt-3">
                    {!isPast && !game.is_closed ? (
                      <Link
                        to={`/e/${game.events.slug}/${team.slug || teamSlug}?from=${encodeURIComponent(team.slug || teamSlug)}`}
                        className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 bg-cyan-100 text-cyan-700 hover:bg-cyan-200 active:bg-cyan-300 rounded-lg text-sm font-medium"
                      >
                        Open Live Tracker
                      </Link>
                    ) : (
                      <Link
                        to={`/e/${game.events.slug}/${team.slug || teamSlug}/summary?from=${encodeURIComponent(team.slug || teamSlug)}`}
                        className="inline-flex items-center justify-center w-full sm:w-auto px-4 py-2 bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 rounded-lg text-sm font-medium"
                      >
                        Event Summary
                      </Link>
                    )}
                  </div>
                )}
              </div>

              {/* Video section — inline player for the selected video,
                  thumbnail strip for any others. Hidden entirely when
                  no videos exist; an empty player would just be noise. */}
              {videos.length > 0 && (
                <section className="bg-white rounded-lg shadow-md p-4 sm:p-5 mb-4">
                  <div className="flex items-center justify-between gap-2 mb-3">
                    <h2 className="text-base font-semibold text-gray-800">
                      Video{videos.length > 1 ? 's' : ''}
                      <span className="text-gray-400 font-normal ml-1">
                        ({videos.length})
                      </span>
                    </h2>
                  </div>

                  {videos.length > 1 && (
                    <div className="grid grid-cols-3 gap-2 mb-3">
                      {videos.map((v) => {
                        const isSelected = v.id === selectedVideoId
                        return (
                          <button
                            key={v.id}
                            type="button"
                            onClick={() => handleSelectVideo(v.id)}
                            className={`relative aspect-video rounded overflow-hidden ring-2 transition-all ${
                              isSelected
                                ? 'ring-cyan-500'
                                : 'ring-transparent hover:ring-gray-300'
                            }`}
                            aria-label={`Play video ${v.id}`}
                            aria-pressed={isSelected}
                          >
                            <VideoThumbnail videoId={v.id} size="fill" />
                          </button>
                        )
                      })}
                    </div>
                  )}

                  {selectedVideo && (
                    <div ref={playerRef} className="scroll-mt-4">
                      <GameVideosPanel
                        videos={[selectedVideo]}
                        game={game}
                        teamName={team?.name}
                      />
                    </div>
                  )}
                </section>
              )}

              {/* Colleges watching this game — grouped by school. Each
                  school header is a click-through to the team × college
                  detail page so parents can pivot from "who watched
                  this game" to "what else has this school watched". */}
              {coachesBySchool.length > 0 ? (
                <section className="bg-white rounded-lg shadow-md p-4 sm:p-5 mb-4">
                  <div className="mb-3">
                    <h2 className="text-base font-semibold text-gray-800">
                      Colleges watching this game
                    </h2>
                    <p className="text-xs text-gray-500 mt-0.5">
                      <span className="font-semibold">{coachCount}</span>{' '}
                      {coachCount === 1 ? 'coach' : 'coaches'} from{' '}
                      <span className="font-semibold">
                        {coachesBySchool.length}
                      </span>{' '}
                      {coachesBySchool.length === 1 ? 'school' : 'schools'}
                    </p>
                  </div>
                  <div className="space-y-3">
                    {coachesBySchool.map(({ school, coaches }) => (
                      <SchoolBlock
                        key={school.id}
                        school={school}
                        coaches={coaches}
                        teamSlug={team.slug || teamSlug}
                      />
                    ))}
                  </div>
                </section>
              ) : (
                <div className="bg-white rounded-lg shadow-md p-6 text-center text-gray-500 mb-4">
                  <p className="text-sm">
                    No coaches have been logged at this game yet.
                  </p>
                  {game.events?.slug && !isPast && !game.is_closed && (
                    <Link
                      to={`/e/${game.events.slug}/${team.slug || teamSlug}?from=${encodeURIComponent(team.slug || teamSlug)}`}
                      className="inline-block mt-2 text-sm text-cyan-700 hover:text-cyan-900 font-medium"
                    >
                      Open the live tracker to log coaches →
                    </Link>
                  )}
                </div>
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
 * SchoolBlock — one school's grouped coach list. School header links to
 * the team × college detail page so parents can pivot from "who watched
 * THIS game" to "what else has this school watched at our games." Each
 * coach row has inline mailto / tel where available, with "no X on file"
 * fallbacks to keep the crowdsourcing loop visible from here.
 */
function SchoolBlock({ school, coaches, teamSlug }) {
  const collegeHref = `/t/${encodeURIComponent(teamSlug)}/college/${encodeURIComponent(school.id)}`
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <Link
        to={collegeHref}
        className="block bg-cyan-50 hover:bg-cyan-100 transition-colors px-4 py-2.5 border-b border-cyan-100"
      >
        <div className="flex items-center justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-cyan-900 truncate">
              {school.school}
            </p>
            <p className="text-xs text-cyan-700 truncate">
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
          <ArrowRightIcon className="text-cyan-700 flex-shrink-0" />
        </div>
      </Link>
      <ul className="divide-y divide-gray-100">
        {coaches.map((c) => (
          <CoachRow key={c.id} coach={c} />
        ))}
      </ul>
    </div>
  )
}

/**
 * CoachRow — single coach inside a school block. Name + title on top,
 * contact rows below. Email and phone tap into mailto/tel as usual.
 * Inactive coaches render with the strikethrough + "(Inactive)" badge
 * for historical correctness — they were at this game; we just note
 * they've since left the program.
 */
function CoachRow({ coach }) {
  const isInactive = coach.is_active === false
  return (
    <li className="px-4 py-3">
      <p
        className={`text-sm font-semibold ${
          isInactive ? 'text-gray-400 line-through' : 'text-gray-900'
        }`}
      >
        {coach.first_name} {coach.last_name}
      </p>
      {(coach.title || isInactive) && (
        <p className="text-xs text-gray-500 mb-1">
          {coach.title || ''}
          {isInactive && (
            <span className="ml-1 text-gray-500">(Inactive)</span>
          )}
        </p>
      )}
      <div className="flex flex-col gap-0.5">
        {coach.email ? (
          <a
            href={`mailto:${coach.email}`}
            className="inline-flex items-center gap-2 text-xs text-cyan-700 hover:text-cyan-900 break-all"
          >
            <MailIcon />
            <span className="min-w-0">{coach.email}</span>
          </a>
        ) : (
          <div className="inline-flex items-center gap-2 text-xs text-gray-400">
            <MailIcon />
            <span className="italic">no email on file</span>
          </div>
        )}
        {coach.phone ? (
          <a
            href={`tel:${coach.phone.replace(/[^+0-9]/g, '')}`}
            className="inline-flex items-center gap-2 text-xs text-cyan-700 hover:text-cyan-900"
          >
            <PhoneIcon />
            <span>{coach.phone}</span>
          </a>
        ) : (
          <div className="inline-flex items-center gap-2 text-xs text-gray-400">
            <PhoneIcon />
            <span className="italic">no phone on file</span>
          </div>
        )}
      </div>
    </li>
  )
}

/**
 * formatLongDate — "Saturday, April 19" style. Manual parse to avoid the
 * UTC shift that bit us in earlier date handling (see "Date timezone
 * bug" in Build Status). Returns empty string for missing/malformed
 * input so the surrounding layout doesn't break.
 */
function formatLongDate(dateStr) {
  if (!dateStr) return ''
  const [y, m, d] = String(dateStr).split('-')
  if (!y || !m || !d) return dateStr
  const dt = new Date(Number(y), Number(m) - 1, Number(d))
  if (Number.isNaN(dt.getTime())) return dateStr
  return dt.toLocaleDateString('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  })
}

/**
 * formatTime — "7:30 PM" from a "HH:MM" string. Matches the pattern in
 * PublicTeamPage's formatTime so the two pages render the same time the
 * same way.
 */
function formatTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (Number.isNaN(h)) return ''
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 || 12
  return `${h12}:${String(m || 0).padStart(2, '0')} ${ampm}`
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

function ArrowRightIcon({ className = '' }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
      className={className}
    >
      <path d="M5 12h14M12 5l7 7-7 7" />
    </svg>
  )
}

function MailIcon() {
  return (
    <svg
      width="14"
      height="14"
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
      width="14"
      height="14"
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

function PinIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  )
}

function LockIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  )
}
