import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getActiveSeasonId } from '../lib/season'
import { computeRecord, gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'

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

  // Group games
  const grouped = (() => {
    const byEvent = new Map()
    const standalone = []
    games.forEach((g) => {
      if (g.event_id && g.events) {
        if (!byEvent.has(g.event_id)) {
          byEvent.set(g.event_id, { event: g.events, games: [] })
        }
        byEvent.get(g.event_id).games.push(g)
      } else {
        standalone.push(g)
      }
    })
    const eventGroups = Array.from(byEvent.values()).sort(
      (a, b) => new Date(a.event.start_date) - new Date(b.event.start_date)
    )
    return { eventGroups, standalone }
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
        <div className="max-w-5xl mx-auto px-4 py-4 flex items-center gap-3">
          <Link to="/home" className="flex items-center gap-3 hover:opacity-80">
            <OPLogo className="h-10 w-10" />
            <div>
              <div className="font-semibold">Ohio Premier Soccer</div>
              <div className="text-xs text-cyan-300">College Coach Tracker</div>
            </div>
          </Link>
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
                  <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">
                    Season Record
                  </div>
                  <div className="flex flex-wrap items-baseline gap-4">
                    <div className="text-3xl font-bold text-gray-900">
                      {r.wins}–{r.losses}–{r.ties}
                    </div>
                    <div className="text-sm text-gray-600">
                      {r.played} game{r.played === 1 ? '' : 's'} · {r.percent}%
                    </div>
                    <div className="text-sm text-gray-600">
                      Goals for{' '}
                      <span className="font-semibold text-gray-900">{r.gf}</span>
                      , against{' '}
                      <span className="font-semibold text-gray-900">{r.ga}</span>
                      {r.gd !== 0 && (
                        <span className="text-gray-500">
                          {' '}
                          ({r.gd > 0 ? '+' : ''}
                          {r.gd})
                        </span>
                      )}
                    </div>
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
            <h2 className="text-xl font-semibold text-gray-800 mb-3">
              Season Schedule
            </h2>
            {games.length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
                No games scheduled yet.
              </div>
            ) : (
              <div className="space-y-5 mb-8">
                {grouped.eventGroups.map(({ event, games: eGames }) => (
                  <EventScheduleCard
                    key={event.id}
                    event={event}
                    games={eGames}
                    teamSlug={teamSlug}
                    formatDate={formatDate}
                    formatTime={formatTime}
                  />
                ))}
                {grouped.standalone.length > 0 && (
                  <div className="bg-white rounded-lg shadow-md p-5">
                    <h3 className="text-lg font-semibold mb-1">Other Games</h3>
                    <p className="text-xs text-gray-500 mb-3">
                      League fixtures and friendlies not tied to a showcase event
                    </p>
                    <div className="divide-y divide-gray-100">
                      {grouped.standalone.map((g) => (
                        <StandaloneGameRow
                          key={g.id}
                          game={g}
                          formatDate={formatDate}
                          formatTime={formatTime}
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
    <div className="bg-white rounded-lg shadow-md p-4 text-center">
      <div className="text-3xl font-bold text-gray-900">{value}</div>
      <div className="text-xs uppercase tracking-wide text-gray-500 mt-1">
        {label}
      </div>
    </div>
  )
}

function EventScheduleCard({ event, games, teamSlug, formatDate, formatTime }) {
  const hasOpenGames = games.some((g) => !g.is_closed)
  return (
    <div className="bg-white rounded-lg shadow-md p-5">
      <div className="flex justify-between items-start gap-3 mb-3">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">
            {event.event_name}
          </h3>
          <p className="text-xs text-gray-500">
            {formatDate(event.start_date)} – {formatDate(event.end_date)}
          </p>
          {event.location && (
            <p className="text-xs text-gray-500">📍 {event.location}</p>
          )}
        </div>
        <div className="flex flex-col gap-1 flex-shrink-0">
          {hasOpenGames && (
            <Link
              to={`/e/${event.slug}/${teamSlug}`}
              className="text-sm bg-cyan-100 text-cyan-700 hover:bg-cyan-200 px-3 py-2 rounded-lg text-center"
            >
              Live Tracker
            </Link>
          )}
          <Link
            to={`/e/${event.slug}/${teamSlug}/summary`}
            className="text-sm bg-gray-100 text-gray-700 hover:bg-gray-200 px-3 py-2 rounded-lg text-center"
          >
            Summary
          </Link>
        </div>
      </div>
      <div className="divide-y divide-gray-100">
        {games.map((g) => {
          const r = gameResult(g)
          return (
            <div key={g.id} className="py-2 text-sm flex flex-wrap items-center gap-2">
              <span className="font-medium">{formatDate(g.game_date)}</span>
              {g.game_time && (
                <span className="text-gray-500">@ {formatTime(g.game_time)}</span>
              )}
              <span className="text-gray-600">
                {g.is_home ? 'vs' : '@'} {g.opponent || 'TBD'}
              </span>
              {r.label && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.color}`}>
                  {r.label} {r.score}
                </span>
              )}
              {g.is_closed && (
                <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                  Closed
                </span>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function StandaloneGameRow({ game, formatDate, formatTime }) {
  const r = gameResult(game)
  return (
    <div className="py-2 text-sm flex flex-wrap items-center gap-2">
      <span className="font-medium">{formatDate(game.game_date)}</span>
      {game.game_time && (
        <span className="text-gray-500">@ {formatTime(game.game_time)}</span>
      )}
      <span className="text-gray-600">
        {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}
      </span>
      {r.label && (
        <span className={`text-xs font-bold px-2 py-0.5 rounded ${r.color}`}>
          {r.label} {r.score}
        </span>
      )}
      {game.game_types?.name && (
        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
          {game.game_types.name}
        </span>
      )}
      {game.location && (
        <span className="text-gray-400 text-xs">📍 {game.location}</span>
      )}
    </div>
  )
}
