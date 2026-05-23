import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getActiveSeasonId } from '../lib/season'
import { computeRecord, gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'
import VideoThumbnail from '../components/VideoThumbnail'
import GameVideosPanel from '../components/GameVideosPanel'
import FeedbackButton from '../components/FeedbackButton'
import { useRealtimeVideos } from '../hooks/useRealtimeVideos'
import { useFavorite } from '../hooks/useFavorite'

/**
 * Public Team Page at /t/:teamSlug
 *
 * The "team identity" hub for parents/players. Shows:
 *  - Identity (name, age group, gender, program, season)
 *  - Season record (W/L/D/GF/GA/GD)
 *  - Stats (games, schools, coaches)
 *  - Two tabs: Games (chronological newest-first) and Events (grouped by event)
 *  - Top colleges that have watched this team
 *
 * Defaults to the team in the active season for the given slug.
 *
 * Sprint 2 changes:
 *  - Old Upcoming/Past split replaced with Games + Events tabs
 *  - Game rows show prominent video thumbnails (replacing the small VideoBadge pill)
 *  - Subtle "N colleges" indicator on game rows where coaches have logged attendance
 *  - Events tab gives a per-event scorecard view, drilling into the existing
 *    /e/:eventSlug/:teamSlug page for game-day flows
 */
export default function PublicTeamPage() {
  const { teamSlug } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [attendance, setAttendance] = useState([])
  const [activeTab, setActiveTab] = useState('games') // 'games' | 'events'
  const { videosByGame } = useRealtimeVideos(games.map((g) => g.id))
  const [isFavorite, setFavorite] = useFavorite(team?.id)

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamSlug])

  const load = async () => {
    setLoading(true)
    setError(null)

    const activeSeasonId = await getActiveSeasonId()
    if (!activeSeasonId) {
      setError('No active season configured.')
      setLoading(false)
      return
    }

    // Find the team in the active season
    const { data: teamData, error: teamError } = await supabase
      .from('teams')
      .select(
        '*, age_groups(name), programs(name), seasons(id, name, slug)'
      )
      .eq('slug', teamSlug)
      .eq('season_id', activeSeasonId)
      .maybeSingle()

    if (teamError || !teamData) {
      setError('Team not found.')
      setLoading(false)
      return
    }
    setTeam(teamData)

    // All games for this team
    const { data: gamesData } = await supabase
      .from('games')
      .select(
        '*, game_types(id, name), events(id, event_name, slug, start_date, end_date, location)'
      )
      .eq('team_id', teamData.id)
      .order('game_date')
    setGames(gamesData || [])

    // All attendance for those games
    if (gamesData && gamesData.length > 0) {
      const gameIds = gamesData.map((g) => g.id)
      const { data: attData } = await supabase
        .from('attendance')
        .select(
          'id, game_id, coach_id, coaches(id, first_name, last_name, schools(id, school, city, state, division, conference))'
        )
        .in('game_id', gameIds)
      setAttendance(attData || [])
    } else {
      setAttendance([])
    }

    setLoading(false)
  }

  // Stats
  const stats = useMemo(() => {
    const games_count = games.length
    const schools = new Set()
    const coaches = new Set()
    attendance.forEach((a) => {
      if (a.coach_id) coaches.add(a.coach_id)
      if (a.coaches?.schools?.id) schools.add(a.coaches.schools.id)
    })
    return {
      games: games_count,
      schools: schools.size,
      coaches: coaches.size,
    }
  }, [games, attendance])

  // Unique school count per game — drives the "N colleges" indicator on each row.
  // Using schools (not coaches) because recruiting parents care more about
  // "how many programs scouted this game" than "how many bodies showed up."
  const schoolsByGame = useMemo(() => {
    const map = new Map()
    attendance.forEach((a) => {
      const schoolId = a.coaches?.schools?.id
      if (!schoolId) return
      if (!map.has(a.game_id)) map.set(a.game_id, new Set())
      map.get(a.game_id).add(schoolId)
    })
    const out = {}
    map.forEach((set, gid) => {
      out[gid] = set.size
    })
    return out
  }, [attendance])

  // Games sorted chronological newest-first for the Games tab.
  // Future games naturally rise to the top; past games descend. A team in
  // mid-season sees "next Saturday's game" at the top, then everything
  // before that descending.
  const sortedGames = useMemo(() => {
    return [...games].sort(
      (a, b) => parseGameDate(b.game_date) - parseGameDate(a.game_date)
    )
  }, [games])

  // Games grouped by event for the Events tab. Standalone games (no event_id)
  // are excluded from Events tab; they still appear in Games tab.
  const eventGroups = useMemo(() => {
    const groups = new Map()
    games.forEach((g) => {
      if (!g.events) return
      const eid = g.events.id
      if (!groups.has(eid)) {
        groups.set(eid, {
          event: g.events,
          games: [],
          attendance: [],
        })
      }
      groups.get(eid).games.push(g)
    })
    // Attach attendance rows to each event group based on game_id
    attendance.forEach((a) => {
      groups.forEach((g) => {
        if (g.games.some((game) => game.id === a.game_id)) {
          g.attendance.push(a)
        }
      })
    })
    return Array.from(groups.values()).sort(
      (a, b) => parseGameDate(b.event.start_date) - parseGameDate(a.event.start_date)
    )
  }, [games, attendance])

  // Top colleges by attendance count
  const topColleges = useMemo(() => {
    const tally = new Map()
    attendance.forEach((a) => {
      const school = a.coaches?.schools
      if (!school) return
      const key = school.id
      if (!tally.has(key)) {
        tally.set(key, {
          ...school,
          gameIds: new Set(),
          coachIds: new Set(),
        })
      }
      const entry = tally.get(key)
      entry.gameIds.add(a.game_id)
      if (a.coach_id) entry.coachIds.add(a.coach_id)
    })
    return Array.from(tally.values())
      .map((s) => ({
        ...s,
        games: s.gameIds.size,
        coaches: s.coachIds.size,
      }))
      .sort((a, b) => b.games - a.games || b.coaches - a.coaches)
      .slice(0, 10)
  }, [attendance])

  const formatDate = (s) => {
    const [y, m, d] = s.split('-')
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }
  const formatTime = (t) => {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    const h12 = h % 12 || 12
    return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  return (
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
          <div className="flex items-center gap-2 text-sm">
            <Link to="/directory" className="text-gray-300 hover:text-white px-2 py-1">
              Directory
            </Link>
            <Link to="/help?context=parent" className="text-gray-300 hover:text-white px-2 py-1">
              Help
            </Link>
            <Link to="/admin" className="text-gray-400 hover:text-white px-2 py-1">
              Admin
            </Link>
          </div>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-6">
        <nav className="text-sm text-gray-500 mb-4">
          <Link to="/home" className="hover:text-gray-700">Home</Link>
          <span className="mx-2">›</span>
          <span className="text-gray-700">
            {team?.name || 'Team'}
          </span>
        </nav>

        {loading ? (
          <div className="text-center py-12">Loading...</div>
        ) : error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-6 text-center">
            {error}
          </div>
        ) : (
          <>
            {/* Compact team header — replaces the old Identity / Season Record /
                Stats stack so the first game is visible above the fold on phones */}
            {(() => {
              const r = computeRecord(games)
              return (
                <div className="bg-white rounded-lg shadow-md p-4 sm:p-5 mb-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h1 className="text-2xl sm:text-3xl font-bold text-gray-900 truncate">
                        {team.name}
                      </h1>
                      <p className="text-sm text-gray-600 mt-1">
                        {team.age_groups?.name} · {team.gender} ·{' '}
                        {team.programs?.name}
                      </p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {team.seasons?.name}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setFavorite(!isFavorite)}
                      aria-label={
                        isFavorite
                          ? 'Remove from My Teams'
                          : 'Add to My Teams'
                      }
                      aria-pressed={isFavorite}
                      className="flex-shrink-0 p-2 -m-2 rounded-full hover:bg-gray-100 active:bg-gray-200"
                    >
                      <StarIcon filled={isFavorite} />
                    </button>
                  </div>
                  {r.played > 0 && (
                    <div className="grid grid-cols-7 gap-1 sm:gap-2 pt-3 mt-3 border-t border-gray-100">
                      <HeaderStat value={r.played} label="GP" />
                      <HeaderStat value={r.wins} label="W" />
                      <HeaderStat value={r.losses} label="L" />
                      <HeaderStat value={r.ties} label="D" />
                      <HeaderStat value={r.gf} label="GF" />
                      <HeaderStat value={r.ga} label="GA" />
                      <HeaderStat
                        value={`${r.gd > 0 ? '+' : ''}${r.gd}`}
                        label="GD"
                      />
                    </div>
                  )}
                </div>
              )
            })()}

            {/* Tabs + tab content */}
            {games.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500 mb-8">
                No games scheduled yet.
              </div>
            ) : (
              <>
                <div className="mb-4 border-b border-gray-200 flex gap-1">
                  <TabButton
                    active={activeTab === 'games'}
                    onClick={() => setActiveTab('games')}
                  >
                    Games <span className="text-gray-400 ml-1">({games.length})</span>
                  </TabButton>
                  <TabButton
                    active={activeTab === 'events'}
                    onClick={() => setActiveTab('events')}
                  >
                    Events <span className="text-gray-400 ml-1">({eventGroups.length})</span>
                  </TabButton>
                </div>

                {activeTab === 'games' ? (
                  <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100 mb-8">
                    {sortedGames.map((g) => (
                      <GameCard
                        key={g.id}
                        game={g}
                        teamSlug={teamSlug}
                        teamName={team?.name}
                        formatDate={formatDate}
                        formatTime={formatTime}
                        videos={videosByGame[g.id] || []}
                        schoolsCount={schoolsByGame[g.id] || 0}
                      />
                    ))}
                  </div>
                ) : eventGroups.length === 0 ? (
                  <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500 mb-8">
                    No event-based games this season.
                    <div className="text-xs text-gray-400 mt-1">
                      Standalone games appear in the Games tab.
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3 mb-8">
                    {eventGroups.map((group) => (
                      <EventCard
                        key={group.event.id}
                        event={group.event}
                        games={group.games}
                        attendance={group.attendance}
                        teamSlug={teamSlug}
                      />
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Top colleges */}
            {topColleges.length > 0 && (
              <>
                <div className="mb-3">
                  <h2 className="text-xl font-semibold text-gray-800">
                    Colleges Watching This Team
                  </h2>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {stats.schools}{' '}
                    {stats.schools === 1 ? 'school' : 'schools'} ·{' '}
                    {stats.coaches}{' '}
                    {stats.coaches === 1 ? 'coach' : 'coaches'} across all games
                  </p>
                </div>
                <div className="bg-white rounded-lg shadow-md overflow-hidden mb-8">
                  <table className="w-full">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">
                          School
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden sm:table-cell">
                          Division
                        </th>
                        <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase hidden md:table-cell">
                          Conference
                        </th>
                        <th className="px-4 py-3 text-right text-xs font-medium text-gray-500 uppercase">
                          Games
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {topColleges.map((s) => (
                        <tr key={s.id}>
                          <td className="px-4 py-3 text-sm font-medium text-gray-900">
                            {s.school}
                            <span className="text-gray-400 text-xs ml-2">
                              {s.city && s.state ? `${s.city}, ${s.state}` : ''}
                            </span>
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 hidden sm:table-cell">
                            {s.division || '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-600 hidden md:table-cell">
                            {s.conference || '—'}
                          </td>
                          <td className="px-4 py-3 text-sm text-right font-medium">
                            {s.games}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-gray-500 mb-8">
                  Want to contact one of these coaches? Visit the{' '}
                  <Link to="/directory" className="text-blue-600 hover:underline">
                    Coach Directory
                  </Link>
                  .
                </p>
              </>
            )}
          </>
        )}
      </main>
      <FeedbackButton />
    </div>
  )
}

function HeaderStat({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-base sm:text-lg font-bold text-gray-900 leading-none tabular-nums">
        {value}
      </div>
      <div className="text-[10px] uppercase tracking-wider text-gray-500 mt-1">
        {label}
      </div>
    </div>
  )
}

function StarIcon({ filled }) {
  if (filled) {
    return (
      <svg
        width="22"
        height="22"
        viewBox="0 0 24 24"
        fill="currentColor"
        className="text-amber-400"
        aria-hidden="true"
      >
        <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
      </svg>
    )
  }
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinejoin="round"
      className="text-gray-400"
      aria-hidden="true"
    >
      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" />
    </svg>
  )
}

/**
 * Tab button used in the Games | Events tab strip on the team page.
 * Sized for mobile tap targets (44px+ via py-3 + line-height).
 */
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-3 text-sm font-medium transition-colors ${
        active
          ? 'text-cyan-700'
          : 'text-gray-600 hover:text-gray-900'
      }`}
      style={{ minHeight: 44 }}
    >
      {children}
      {active && (
        <span
          aria-hidden="true"
          className="absolute bottom-0 left-2 right-2 h-0.5 bg-cyan-600 rounded-t"
        />
      )}
    </button>
  )
}

/**
 * GameCard — one row in the Games tab.
 *
 * Layout (mobile-first):
 *   [content lines]                    [thumbnail (if video)]
 *                                      [action button (if applicable)]
 *
 * Content lines:
 *   1. Date + result badge + status + "N colleges" indicator
 *   2. Time · vs/at opponent
 *   3. Event context (or game type) + location
 *
 * Right column:
 *  - VideoThumbnail (md size) when videos exist — tap toggles inline panel.
 *  - Action button (Live Tracker / Summary) underneath, when game is in an event.
 *
 * Tapping the thumbnail expands the same GameVideosPanel used previously.
 */
function GameCard({
  game,
  teamSlug,
  teamName,
  formatDate,
  formatTime,
  videos = [],
  schoolsCount = 0,
}) {
  const [videosExpanded, setVideosExpanded] = useState(false)
  const r = gameResult(game)
  const eventSlug = game.events?.slug
  const eventName = game.events?.event_name
  const isClosed = game.is_closed
  const inEvent = !!eventSlug
  const hasVideo = videos.length > 0

  const isPast = (() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const gameDate = parseGameDate(game.game_date)
    return (
      gameDate < today ||
      (gameDate.getTime() === today.getTime() && isClosed)
    )
  })()

  // Action button — present only for games attached to an event
  let action = null
  if (inEvent) {
    if (isPast || isClosed) {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}/summary`}
          className="text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 px-3 py-2 rounded-lg text-center block whitespace-nowrap"
        >
          Summary
        </Link>
      )
    } else {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}`}
          className="text-xs font-medium bg-cyan-100 text-cyan-700 hover:bg-cyan-200 active:bg-cyan-300 px-3 py-2 rounded-lg text-center block whitespace-nowrap"
        >
          Open Tracker
        </Link>
      )
    }
  }

  return (
    <div>
      <div className="p-4 flex items-start gap-3">
        <div className="min-w-0 flex-1">
          {/* Line 1: date + result + status badges + coach indicator */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-gray-900 text-sm">
              {formatDate(game.game_date)}
            </span>
            {r.label && (
              <span
                className={`text-xs font-bold px-2 py-0.5 rounded tabular-nums ${r.color}`}
              >
                {r.label} {r.score}
              </span>
            )}
            {isClosed && !r.label && (
              <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                Closed
              </span>
            )}
            {!isPast && !isClosed && (
              <span className="text-xs text-blue-600 font-medium">
                Upcoming
              </span>
            )}
            {schoolsCount > 0 && (
              <span
                className="text-xs text-purple-700 font-medium"
                title={`${schoolsCount} ${
                  schoolsCount === 1 ? 'college' : 'colleges'
                } attended`}
              >
                {schoolsCount} {schoolsCount === 1 ? 'college' : 'colleges'}
              </span>
            )}
          </div>
          {/* Line 2: time · vs/at opponent */}
          <div className="text-sm text-gray-700 mt-0.5">
            {game.game_time && <>{formatTime(game.game_time)} · </>}
            {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}
          </div>
          {/* Line 3: event context (or game type) + location */}
          <div className="text-xs text-gray-500 mt-1 flex items-center gap-2 flex-wrap">
            {eventName ? (
              <span className="truncate">
                <span className="text-gray-400">at</span> {eventName}
              </span>
            ) : (
              game.game_types?.name && (
                <span className="bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {game.game_types.name}
                </span>
              )
            )}
            {game.location && (
              <span className="text-gray-400">📍 {game.location}</span>
            )}
          </div>
        </div>

        {/* Right column: thumbnail + action stacked vertically */}
        {(hasVideo || action) && (
          <div className="flex-shrink-0 flex flex-col items-stretch gap-2">
            {hasVideo && (
              <button
                type="button"
                onClick={() => setVideosExpanded((e) => !e)}
                aria-expanded={videosExpanded}
                aria-label={`${videos.length} video${
                  videos.length === 1 ? '' : 's'
                } available — tap to ${videosExpanded ? 'collapse' : 'expand'}`}
                className="relative rounded-md overflow-hidden block hover:opacity-90 active:opacity-80"
              >
                <VideoThumbnail videoId={videos[0].id} size="md" />
                <div
                  className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none"
                  aria-hidden="true"
                >
                  <svg
                    width="22"
                    height="22"
                    viewBox="0 0 24 24"
                    fill="white"
                  >
                    <path d="M8 5v14l11-7z" />
                  </svg>
                </div>
                {videos.length > 1 && (
                  <div
                    className="absolute bottom-1 right-1 bg-black/70 text-white text-[10px] font-medium px-1.5 py-0.5 rounded pointer-events-none"
                    aria-hidden="true"
                  >
                    {videos.length}
                  </div>
                )}
              </button>
            )}
            {action}
          </div>
        )}
      </div>
      {videosExpanded && hasVideo && (
        <GameVideosPanel videos={videos} game={game} teamName={teamName} />
      )}
    </div>
  )
}

/**
 * EventCard — one entry in the Events tab.
 *
 * A self-contained scorecard for the team at one event. Shows event name,
 * date range, location, and a row of stat pills (GP · W-L-D · GF·GA) along
 * with an optional coach-attendance pill.
 *
 * Smart routing on tap to avoid a flash from the live tracker's internal
 * redirect logic:
 *   - All games closed (and there are games) → /summary directly
 *   - Otherwise (live / upcoming) → /e/:eventSlug/:teamSlug (live tracker)
 *
 * Without this, past events tap into the live tracker, which then sees
 * "all games closed" and bounces to /summary — producing a visible flash
 * of the wrong page.
 */
function EventCard({ event, games, attendance, teamSlug }) {
  const record = computeRecord(games)
  const schoolIds = new Set()
  attendance.forEach((a) => {
    if (a.coaches?.schools?.id) schoolIds.add(a.coaches.schools.id)
  })
  const schoolsCount = schoolIds.size

  const allClosed = games.length > 0 && games.every((g) => g.is_closed)
  const destHref = allClosed
    ? `/e/${event.slug}/${teamSlug}/summary`
    : `/e/${event.slug}/${teamSlug}`

  return (
    <Link
      to={destHref}
      className="block bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-4"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 truncate">
            {event.event_name}
          </h3>
          <div className="text-xs text-gray-500 mt-0.5">
            {formatEventDate(event.start_date, event.end_date)}
            {event.location ? ` · ${event.location}` : ''}
          </div>
        </div>
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className="text-gray-400 flex-shrink-0 mt-1"
          aria-hidden="true"
        >
          <path d="m9 18 6-6-6-6" />
        </svg>
      </div>
      <div className="flex items-center gap-1.5 flex-wrap text-xs">
        <Pill label="GP" value={games.length} />
        {record.played > 0 && (
          <>
            <Pill label="W" value={record.wins} color="emerald" />
            <Pill label="L" value={record.losses} color="rose" />
            <Pill label="D" value={record.ties} />
            <Pill label="GF" value={record.gf} />
            <Pill label="GA" value={record.ga} />
          </>
        )}
        {schoolsCount > 0 && (
          <span className="text-purple-700 font-medium ml-auto whitespace-nowrap">
            {schoolsCount} {schoolsCount === 1 ? 'college' : 'colleges'}
          </span>
        )}
      </div>
    </Link>
  )
}

function Pill({ label, value, color = 'gray' }) {
  const colorClasses = {
    gray: 'bg-gray-100 text-gray-700',
    emerald: 'bg-emerald-100 text-emerald-700',
    rose: 'bg-rose-100 text-rose-700',
  }
  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded ${colorClasses[color]}`}
    >
      <span className="text-[10px] font-medium uppercase tracking-wide">
        {label}
      </span>
      <span className="font-bold tabular-nums">{value}</span>
    </span>
  )
}

function formatEventDate(start, end) {
  const s = parseGameDate(start)
  const e = end ? parseGameDate(end) : s
  const opts = { month: 'short', day: 'numeric' }
  const startStr = s.toLocaleDateString('en-US', opts)
  if (!end || end === start) return startStr
  const endStr = e.toLocaleDateString('en-US', opts)
  return `${startStr} – ${endStr}`
}

function parseGameDate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d)
}
