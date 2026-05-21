import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getActiveSeasonId } from '../lib/season'
import { computeRecord, gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'
import VideoBadge from '../components/VideoBadge'
import GameVideosPanel from '../components/GameVideosPanel'
import { useRealtimeVideos } from '../hooks/useRealtimeVideos'

/**
 * Public Team Page at /t/:teamSlug
 *
 * The "team identity" hub for parents/players. Shows:
 *  - Identity (name, age group, gender, program, season)
 *  - Season summary (games, schools, coaches)
 *  - Full schedule grouped by event + "Other Games" for standalone
 *  - Top colleges that have watched this team
 *
 * Defaults to the team in the active season for the given slug.
 */
export default function PublicTeamPage() {
  const { teamSlug } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [attendance, setAttendance] = useState([])
  const { videosByGame } = useRealtimeVideos(games.map((g) => g.id))

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

  // Date helper used by the schedule split
  const parseGameDate = (s) => {
    const [y, m, d] = s.split('-')
    return new Date(y, m - 1, d)
  }

  // Stats
  const stats = (() => {
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
  })()

  // Split games into upcoming and past
  const { upcoming, past } = (() => {
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const up = []
    const p = []
    games.forEach((g) => {
      const d = parseGameDate(g.game_date)
      // Past = before today, or today-but-closed (already played + locked)
      if (d < today || (d.getTime() === today.getTime() && g.is_closed)) {
        p.push(g)
      } else {
        up.push(g)
      }
    })
    up.sort((a, b) => parseGameDate(a.game_date) - parseGameDate(b.game_date))
    p.sort((a, b) => parseGameDate(b.game_date) - parseGameDate(a.game_date))
    return { upcoming: up, past: p }
  })()

  // Top colleges by attendance count
  const topColleges = (() => {
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
  })()

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
            {/* Identity card */}
            <div className="bg-white rounded-lg shadow-md p-6 mb-6">
              <h1 className="text-3xl font-bold text-gray-900">{team.name}</h1>
              <p className="text-gray-600 mt-1">
                {team.age_groups?.name} · {team.gender} · {team.programs?.name}
              </p>
              <p className="text-xs text-gray-400 mt-2">
                Season: {team.seasons?.name}
              </p>
            </div>

            {/* Season record */}
            {(() => {
              const r = computeRecord(games)
              if (r.played === 0) return null
              return (
                <div className="bg-white rounded-lg shadow-md p-5 mb-6">
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-3">
                    Season Record
                  </div>
                  <div className="grid grid-cols-4 sm:grid-cols-7 gap-x-2 gap-y-4 sm:gap-y-0">
                    <RecordStat value={r.played} label="GP" />
                    <RecordStat value={r.wins} label="W" />
                    <RecordStat value={r.losses} label="L" />
                    <RecordStat value={r.ties} label="D" />
                    <RecordStat value={r.gf} label="GF" />
                    <RecordStat value={r.ga} label="GA" />
                    <RecordStat
                      value={`${r.gd > 0 ? '+' : ''}${r.gd}`}
                      label="GD"
                    />
                  </div>
                </div>
              )
            })()}

            {/* Stats */}
            <div className="grid grid-cols-3 gap-3 mb-6">
              <StatCard label="Games" value={stats.games} />
              <StatCard label="Schools" value={stats.schools} />
              <StatCard label="Coaches" value={stats.coaches} />
            </div>

            {/* Schedule */}
            {games.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500 mb-8">
                No games scheduled yet.
              </div>
            ) : (
              <div className="mb-8 space-y-6">
                {upcoming.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-blue-500"></span>
                      Upcoming
                      <span className="text-sm font-normal text-gray-500">
                        ({upcoming.length})
                      </span>
                    </h2>
                    <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100">
                      {upcoming.map((g) => (
                        <GameCard
                          key={g.id}
                          game={g}
                          teamSlug={teamSlug}
                          teamName={team?.name}
                          isPast={false}
                          formatDate={formatDate}
                          formatTime={formatTime}
                          videos={videosByGame[g.id] || []}
                        />
                      ))}
                    </div>
                  </div>
                )}
                {past.length > 0 && (
                  <div>
                    <h2 className="text-xl font-semibold text-gray-800 mb-3 flex items-center gap-2">
                      <span className="h-2 w-2 rounded-full bg-gray-400"></span>
                      Past Results
                      <span className="text-sm font-normal text-gray-500">
                        ({past.length})
                      </span>
                    </h2>
                    <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100">
                      {past.map((g) => (
                        <GameCard
                          key={g.id}
                          game={g}
                          teamSlug={teamSlug}
                          teamName={team?.name}
                          isPast={true}
                          formatDate={formatDate}
                          formatTime={formatTime}
                          videos={videosByGame[g.id] || []}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Top colleges */}
            {topColleges.length > 0 && (
              <>
                <h2 className="text-xl font-semibold text-gray-800 mb-3">
                  Colleges Watching This Team
                </h2>
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
                  <Link
                    to="/directory"
                    className="text-blue-600 hover:underline"
                  >
                    Coach Directory
                  </Link>
                  .
                </p>
              </>
            )}
          </>
        )}
      </main>
    </div>
  )
}

function StatCard({ label, value }) {
  return (
    <div className="bg-white rounded-lg shadow-md p-3 sm:p-4 text-center">
      <div className="text-2xl sm:text-3xl font-bold text-gray-900 tabular-nums">
        {value}
      </div>
      <div className="text-[10px] sm:text-xs uppercase tracking-wide text-gray-500 mt-1">
        {label}
      </div>
    </div>
  )
}

function RecordStat({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-500 font-medium">
        {label}
      </div>
      <div className="text-2xl sm:text-3xl font-bold text-gray-900 leading-none mt-1 tabular-nums">
        {value}
      </div>
    </div>
  )
}

/**
 * Unified game card. Renders one game with:
 *  - Date + time, vs/at opponent
 *  - Event context (when game belongs to one) or game-type badge (when standalone)
 *  - Result badge for past games with score recorded
 *  - Action button: Live Tracker (open game in an event), or Summary (closed/past)
 */
function GameCard({
  game,
  teamSlug,
  teamName,
  isPast,
  formatDate,
  formatTime,
  videos = [],
}) {
  const [videosExpanded, setVideosExpanded] = useState(false)
  const r = gameResult(game)
  const eventSlug = game.events?.slug
  const eventName = game.events?.event_name
  const isClosed = game.is_closed
  const inEvent = !!eventSlug

  // Action button:
  // - Past or closed game with attendance: Summary
  // - Upcoming open game in an event: Live Tracker
  // - Anything else (standalone game): no button (not trackable yet)
  let action = null
  if (inEvent) {
    if (isPast || isClosed) {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}/summary`}
          className="text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 px-4 py-2.5 rounded-lg text-center min-w-[110px] block"
        >
          Event Summary
        </Link>
      )
    } else {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}`}
          className="text-sm font-medium bg-cyan-100 text-cyan-700 hover:bg-cyan-200 active:bg-cyan-300 px-4 py-2.5 rounded-lg text-center min-w-[110px] block"
        >
          Live Tracker
        </Link>
      )
    }
  }

  return (
    <div>
      <div className="p-4 flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          {/* Line 1: Date + result/closed badges + video badge */}
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
            <VideoBadge
              count={videos.length}
              expanded={videosExpanded}
              onClick={() => setVideosExpanded((e) => !e)}
            />
          </div>
          {/* Line 2: time + vs/at opponent */}
          <div className="text-sm text-gray-700 mt-0.5">
            {game.game_time && <>{formatTime(game.game_time)} · </>}
            {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}
          </div>
          {/* Line 3: event context (or game type for standalone) */}
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
        {action && <div className="flex-shrink-0">{action}</div>}
      </div>
      {videosExpanded && videos.length > 0 && (
        <GameVideosPanel videos={videos} game={game} teamName={teamName} />
      )}
    </div>
  )
}
