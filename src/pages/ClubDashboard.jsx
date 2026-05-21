import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ErrorMessage } from '../components/LoadingStates'
import OPLogo from '../components/OPLogo'
import FeedbackButton from '../components/FeedbackButton'
import { getActiveSeasonId, getActiveSeason } from '../lib/season'
import { computeRecord } from '../components/ScoreInput'

/**
 * Club Dashboard — team-first home page.
 *
 * The new mental model:
 *  - Teams are the primary unit (each team is identity + season schedule)
 *  - Events are a secondary view ("happening now", "upcoming")
 *  - Past events tucked into an archive
 *
 * Filter/sort controls let the user pick how to organize the team list.
 */
export default function ClubDashboard() {
  const [season, setSeason] = useState(null)
  const [teams, setTeams] = useState([])
  const [teamStats, setTeamStats] = useState({}) // teamId -> { games, schools, hasActiveEvent }
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter/sort state
  const [groupBy, setGroupBy] = useState('age') // 'age' | 'program' | 'none'
  const [filterProgram, setFilterProgram] = useState('all')
  const [filterGender, setFilterGender] = useState('all')
  const [showPast, setShowPast] = useState(false)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      setLoading(true)
      setError(null)

      const [activeSeason, activeSeasonId] = await Promise.all([
        getActiveSeason(),
        getActiveSeasonId(),
      ])
      setSeason(activeSeason)
      if (!activeSeasonId) {
        setError('No active season configured.')
        setLoading(false)
        return
      }

      // Teams in active season
      const { data: teamsData, error: teamsErr } = await supabase
        .from('teams')
        .select(
          '*, age_groups(id, name, sort_order), programs(id, name, sort_order)'
        )
        .eq('season_id', activeSeasonId)
        .eq('active', true)
      if (teamsErr) throw teamsErr
      const teamList = (teamsData || []).sort((a, b) => a.name.localeCompare(b.name))
      setTeams(teamList)

      // Events in active season
      const { data: eventsData } = await supabase
        .from('events')
        .select('*')
        .eq('season_id', activeSeasonId)
        .order('start_date', { ascending: false })
      setEvents(eventsData || [])

      // Per-team aggregate stats (games count + schools count + active event flag)
      if (teamList.length > 0) {
        const teamIds = teamList.map((t) => t.id)
        const { data: games } = await supabase
          .from('games')
          .select('id, team_id, event_id, is_closed, our_score, opponent_score')
          .in('team_id', teamIds)

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const activeEventIds = new Set(
          (eventsData || [])
            .filter((ev) => {
              const start = parseDate(ev.start_date)
              const end = ev.end_date ? parseDate(ev.end_date) : start
              const endInc = new Date(end)
              endInc.setDate(endInc.getDate() + 1)
              return today >= start && today < endInc
            })
            .map((ev) => ev.id)
        )

        const teamGames = new Map() // teamId -> [full game]
        const teamActiveFlag = new Map()
        ;(games || []).forEach((g) => {
          if (!teamGames.has(g.team_id)) teamGames.set(g.team_id, [])
          teamGames.get(g.team_id).push(g)
          if (g.event_id && activeEventIds.has(g.event_id) && !g.is_closed) {
            teamActiveFlag.set(g.team_id, true)
          }
        })

        const allGameIds = (games || []).map((g) => g.id)
        let attRows = []
        if (allGameIds.length > 0) {
          const { data: att } = await supabase
            .from('attendance')
            .select('game_id, coaches(school_id)')
            .in('game_id', allGameIds)
          attRows = att || []
        }

        // Build schools-per-team from attendance
        const gameToSchools = new Map() // gameId -> Set<schoolId>
        attRows.forEach((a) => {
          const sid = a.coaches?.school_id
          if (!sid) return
          if (!gameToSchools.has(a.game_id)) gameToSchools.set(a.game_id, new Set())
          gameToSchools.get(a.game_id).add(sid)
        })

        const stats = {}
        teamList.forEach((t) => {
          const teamGamesList = teamGames.get(t.id) || []
          const ids = teamGamesList.map((g) => g.id)
          const allSchools = new Set()
          ids.forEach((gid) => {
            const s = gameToSchools.get(gid)
            if (s) s.forEach((sid) => allSchools.add(sid))
          })
          const record = computeRecord(teamGamesList)
          stats[t.id] = {
            games: ids.length,
            schools: allSchools.size,
            hasActiveEvent: !!teamActiveFlag.get(t.id),
            record,
          }
        })
        setTeamStats(stats)
      }
    } catch (err) {
      console.error('Error loading dashboard:', err)
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  // Filtered teams
  const filteredTeams = useMemo(() => {
    return teams.filter((t) => {
      if (filterProgram !== 'all' && String(t.program_id) !== filterProgram) return false
      if (filterGender !== 'all' && t.gender !== filterGender) return false
      return true
    })
  }, [teams, filterProgram, filterGender])

  // Group teams
  const groupedTeams = useMemo(() => {
    if (groupBy === 'none') {
      return [{ label: null, teams: filteredTeams }]
    }
    const groups = new Map()
    filteredTeams.forEach((t) => {
      const key =
        groupBy === 'age'
          ? t.age_groups?.name || 'Other'
          : t.programs?.name || 'Other'
      const sortKey =
        groupBy === 'age'
          ? t.age_groups?.sort_order ?? 999
          : t.programs?.sort_order ?? 999
      if (!groups.has(key)) groups.set(key, { sortKey, teams: [] })
      groups.get(key).teams.push(t)
    })
    return Array.from(groups.entries())
      .sort((a, b) => a[1].sortKey - b[1].sortKey)
      .map(([label, v]) => ({ label, teams: v.teams }))
  }, [filteredTeams, groupBy])

  // Categorized events
  const { active: activeEvents, upcoming, past } = useMemo(
    () => categorizeEvents(events),
    [events]
  )

  // Unique programs/genders in current teams for filter options
  const availablePrograms = useMemo(() => {
    const m = new Map()
    teams.forEach((t) => {
      if (t.programs?.id && !m.has(t.programs.id))
        m.set(t.programs.id, t.programs)
    })
    return Array.from(m.values()).sort(
      (a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0)
    )
  }, [teams])
  const availableGenders = useMemo(() => {
    const s = new Set()
    teams.forEach((t) => s.add(t.gender))
    return Array.from(s)
  }, [teams])

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-slate-900 text-white">
        <div className="max-w-6xl mx-auto px-4 py-4 flex items-center justify-between gap-3">
          <Link to="/home" className="flex items-center gap-3 hover:opacity-80">
            <OPLogo className="h-10 w-10" />
            <div>
              <div className="font-semibold">Ohio Premier Soccer</div>
              <div className="text-xs text-cyan-300">PitchSide</div>
            </div>
          </Link>
          <div className="flex items-center gap-2 text-sm">
            <Link
              to="/directory"
              className="text-gray-300 hover:text-white px-2 py-1"
            >
              Coach Directory
            </Link>
            <Link
              to="/help?context=parent"
              className="text-gray-300 hover:text-white px-2 py-1"
            >
              Help
            </Link>
            <Link
              to="/admin"
              className="text-gray-400 hover:text-white px-2 py-1"
            >
              Admin
            </Link>
          </div>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={load} />
        ) : (
          <>
            {/* Active event banner */}
            {activeEvents.length > 0 && (
              <section className="mb-6">
                {activeEvents.map((ev) => (
                  <div
                    key={ev.id}
                    className="bg-gradient-to-r from-emerald-500 to-cyan-600 text-white rounded-lg shadow-lg p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                  >
                    <div>
                      <div className="flex items-center gap-2 text-xs uppercase tracking-wider opacity-90">
                        <span className="h-2 w-2 rounded-full bg-white animate-pulse"></span>
                        Happening Now
                      </div>
                      <h2 className="text-xl font-bold mt-1">{ev.event_name}</h2>
                      <p className="text-sm opacity-90 mt-0.5">
                        {formatDateRange(ev.start_date, ev.end_date)}
                        {ev.location ? ` · ${ev.location}` : ''}
                      </p>
                    </div>
                    <Link
                      to={`/e/${ev.slug}`}
                      className="bg-white text-emerald-700 font-semibold px-4 py-2 rounded-lg hover:bg-gray-100 self-start sm:self-auto"
                    >
                      Open Event →
                    </Link>
                  </div>
                ))}
              </section>
            )}

            {/* Teams section */}
            <section className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">Our Teams</h2>
                  {season && (
                    <p className="text-sm text-gray-500">
                      {season.name} Season
                    </p>
                  )}
                </div>
              </div>

              {/* Filter/sort controls */}
              <div className="bg-white rounded-lg shadow-sm p-3 mb-4 flex flex-wrap gap-3 items-center">
                <ControlGroup label="Group by">
                  <select
                    value={groupBy}
                    onChange={(e) => setGroupBy(e.target.value)}
                    className="px-2 py-1 border border-gray-300 rounded text-sm"
                  >
                    <option value="age">Age Group</option>
                    <option value="program">Program</option>
                    <option value="none">None (flat list)</option>
                  </select>
                </ControlGroup>
                {availablePrograms.length > 1 && (
                  <ControlGroup label="Program">
                    <select
                      value={filterProgram}
                      onChange={(e) => setFilterProgram(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="all">All</option>
                      {availablePrograms.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                        </option>
                      ))}
                    </select>
                  </ControlGroup>
                )}
                {availableGenders.length > 1 && (
                  <ControlGroup label="Gender">
                    <select
                      value={filterGender}
                      onChange={(e) => setFilterGender(e.target.value)}
                      className="px-2 py-1 border border-gray-300 rounded text-sm"
                    >
                      <option value="all">All</option>
                      {availableGenders.map((g) => (
                        <option key={g} value={g}>
                          {g}
                        </option>
                      ))}
                    </select>
                  </ControlGroup>
                )}
                {(filterProgram !== 'all' || filterGender !== 'all') && (
                  <button
                    onClick={() => {
                      setFilterProgram('all')
                      setFilterGender('all')
                    }}
                    className="text-xs text-blue-600 hover:underline ml-auto"
                  >
                    Clear filters
                  </button>
                )}
              </div>

              {filteredTeams.length === 0 ? (
                <div className="bg-white rounded-lg shadow-sm p-8 text-center text-gray-500">
                  No teams match the current filters.
                </div>
              ) : (
                <div className="space-y-5">
                  {groupedTeams.map((group) => (
                    <div key={group.label || 'flat'}>
                      {group.label && (
                        <h3 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2 px-1">
                          {group.label}
                        </h3>
                      )}
                      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                        {group.teams.map((t) => (
                          <TeamCard
                            key={t.id}
                            team={t}
                            stats={teamStats[t.id]}
                          />
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Upcoming events */}
            {upcoming.length > 0 && (
              <section className="mb-6">
                <h2 className="text-lg font-semibold text-gray-800 mb-3">
                  Upcoming Events
                </h2>
                <div className="space-y-2">
                  {upcoming.map((ev) => (
                    <EventCard key={ev.id} event={ev} />
                  ))}
                </div>
              </section>
            )}

            {/* Past events (collapsed) */}
            {past.length > 0 && (
              <section className="mb-6">
                <button
                  onClick={() => setShowPast((s) => !s)}
                  className="text-sm text-gray-600 hover:text-gray-800 flex items-center gap-1"
                >
                  <span>{showPast ? '▾' : '▸'}</span>
                  Past Events ({past.length})
                </button>
                {showPast && (
                  <div className="mt-3 space-y-2">
                    {past.map((ev) => (
                      <EventCard key={ev.id} event={ev} compact />
                    ))}
                  </div>
                )}
              </section>
            )}
          </>
        )}
      </main>

      <FeedbackButton pageContext="club-dashboard" />
    </div>
  )
}

function ControlGroup({ label, children }) {
  return (
    <label className="flex items-center gap-2 text-sm text-gray-600">
      <span>{label}:</span>
      {children}
    </label>
  )
}

function TeamCard({ team, stats }) {
  const r = stats?.record
  return (
    <Link
      to={`/t/${team.slug}`}
      className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 block border border-gray-100"
    >
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">
            {team.name}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {team.age_groups?.name} · {team.gender} · {team.programs?.name}
          </div>
        </div>
        {stats?.hasActiveEvent && (
          <span className="text-xs bg-emerald-100 text-emerald-700 px-2 py-0.5 rounded flex-shrink-0 flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
            Live
          </span>
        )}
      </div>
      <div className="grid grid-cols-5 gap-1 pt-3 border-t border-gray-100">
        <MiniStat value={r?.played ?? 0} label="GP" />
        <MiniStat value={r?.wins ?? 0} label="W" />
        <MiniStat value={r?.losses ?? 0} label="L" />
        <MiniStat value={r?.ties ?? 0} label="D" />
        <MiniStat value={stats?.schools ?? 0} label="Schools" />
      </div>
    </Link>
  )
}

function MiniStat({ value, label }) {
  return (
    <div className="text-center">
      <div className="text-[10px] uppercase tracking-wider text-gray-500 font-medium">
        {label}
      </div>
      <div className="text-lg font-bold text-gray-900 leading-none mt-1 tabular-nums">
        {value}
      </div>
    </div>
  )
}

function EventCard({ event, compact }) {
  return (
    <Link
      to={`/e/${event.slug}`}
      className={`block bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow ${
        compact ? 'p-3' : 'p-4'
      } border border-gray-100`}
    >
      <div className="flex justify-between items-start gap-3">
        <div>
          <div className="font-medium text-gray-900">{event.event_name}</div>
          <div className="text-xs text-gray-500 mt-0.5">
            {formatDateRange(event.start_date, event.end_date)}
            {event.location ? ` · ${event.location}` : ''}
          </div>
        </div>
        <span className="text-sm text-blue-600">→</span>
      </div>
    </Link>
  )
}

function categorizeEvents(events) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const active = []
  const upcoming = []
  const past = []
  events.forEach((ev) => {
    const start = parseDate(ev.start_date)
    const end = ev.end_date ? parseDate(ev.end_date) : start
    const endInc = new Date(end)
    endInc.setDate(endInc.getDate() + 1)
    if (today >= start && today < endInc) active.push(ev)
    else if (start > today) upcoming.push(ev)
    else past.push(ev)
  })
  upcoming.sort((a, b) => parseDate(a.start_date) - parseDate(b.start_date))
  return { active, upcoming, past }
}

function parseDate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d)
}

function formatDateRange(start, end) {
  const s = parseDate(start)
  const e = end ? parseDate(end) : s
  const opts = { month: 'short', day: 'numeric' }
  const startStr = s.toLocaleDateString('en-US', opts)
  if (!end || end === start) return startStr
  const endStr = e.toLocaleDateString('en-US', opts)
  return `${startStr} – ${endStr}`
}
