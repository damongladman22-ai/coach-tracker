import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { ErrorMessage } from '../components/LoadingStates'
import OPLogo from '../components/OPLogo'
import FeedbackButton from '../components/FeedbackButton'
import SeasonSelector from '../components/SeasonSelector'
import HamburgerMenu from '../components/HamburgerMenu'
import { computeRecord } from '../components/ScoreInput'
import { useFavorite, useFavorites } from '../hooks/useFavorite'

/**
 * Club Dashboard — team-first home page.
 *
 * The mental model:
 *  - Teams are the primary unit; each team card surfaces its own state
 *    (record, next game, live status)
 *  - Parents pick a season via the SeasonSelector at the top — teams
 *    filter to whichever year is selected. Defaults to the DB-active
 *    season on first visit.
 *  - Favorited teams pin to a "My Teams" section above the grouped lists
 *
 * Sprint 3 additions to the team card:
 *  - Favorite star (top-right) — toggles localStorage-backed favorites
 *  - LIVE TRACKER button when the team has games in progress, with smart
 *    routing: one live game → direct to that game; multiple → event-team page
 *  - Next-game one-liner ("Plays Sat 2pm · vs ABC") when there's an upcoming
 *    game and no live one
 */
export default function ClubDashboard() {
  const [selectedSeason, setSelectedSeason] = useState(null)
  const [teams, setTeams] = useState([])
  const [teamStats, setTeamStats] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  // Filter/sort state
  const [groupBy, setGroupBy] = useState('age')
  const [filterProgram, setFilterProgram] = useState('all')
  const [filterGender, setFilterGender] = useState('all')

  const favorites = useFavorites()

  useEffect(() => {
    if (selectedSeason?.id) {
      load(selectedSeason.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSeason?.id])

  const load = async (seasonId) => {
    try {
      setLoading(true)
      setError(null)

      // Teams in selected season
      const { data: teamsData, error: teamsErr } = await supabase
        .from('teams')
        .select(
          '*, age_groups(id, name, sort_order), programs(id, name, sort_order)'
        )
        .eq('season_id', seasonId)
        .eq('active', true)
      if (teamsErr) throw teamsErr
      const teamList = (teamsData || []).sort((a, b) =>
        a.name.localeCompare(b.name)
      )
      setTeams(teamList)

      // Events in selected season (needed for live-game detection)
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, start_date, end_date, slug, event_name')
        .eq('season_id', seasonId)

      if (teamList.length > 0) {
        const teamIds = teamList.map((t) => t.id)

        // Games — extended select with date/time/opponent/event-slug so we
        // can drive the LIVE button + next-game line on each card.
        const { data: games } = await supabase
          .from('games')
          .select(
            'id, team_id, event_id, is_closed, our_score, opponent_score, game_date, game_time, opponent, is_home, events(id, slug, event_name)'
          )
          .in('team_id', teamIds)

        const today = new Date()
        today.setHours(0, 0, 0, 0)
        const todayStr = isoDate(today)
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

        // Per-team derived data:
        //   - all games (for record + games count)
        //   - live games (today's date + event active + not closed)
        //   - next game (date >= today, not closed, soonest)
        const teamGames = new Map()
        const teamLive = new Map()
        const teamNext = new Map()
        ;(games || []).forEach((g) => {
          if (!teamGames.has(g.team_id)) teamGames.set(g.team_id, [])
          teamGames.get(g.team_id).push(g)

          // Live game check
          if (
            g.game_date === todayStr &&
            !g.is_closed &&
            g.event_id &&
            activeEventIds.has(g.event_id) &&
            g.events?.slug
          ) {
            if (!teamLive.has(g.team_id)) teamLive.set(g.team_id, [])
            teamLive.get(g.team_id).push({
              gameId: g.id,
              eventSlug: g.events.slug,
              eventName: g.events.event_name,
            })
          }

          // Next-game candidate
          if (g.game_date >= todayStr && !g.is_closed) {
            const existing = teamNext.get(g.team_id)
            if (!existing || g.game_date < existing.gameDate) {
              teamNext.set(g.team_id, {
                gameDate: g.game_date,
                gameTime: g.game_time,
                opponent: g.opponent,
                isHome: g.is_home,
              })
            }
          }
        })

        // Schools-per-team (existing attendance aggregation)
        const allGameIds = (games || []).map((g) => g.id)
        let attRows = []
        if (allGameIds.length > 0) {
          const { data: att } = await supabase
            .from('attendance')
            .select('game_id, coaches(school_id)')
            .in('game_id', allGameIds)
          attRows = att || []
        }
        const gameToSchools = new Map()
        attRows.forEach((a) => {
          const sid = a.coaches?.school_id
          if (!sid) return
          if (!gameToSchools.has(a.game_id))
            gameToSchools.set(a.game_id, new Set())
          gameToSchools.get(a.game_id).add(sid)
        })

        const stats = {}
        teamList.forEach((t) => {
          const list = teamGames.get(t.id) || []
          const ids = list.map((g) => g.id)
          const allSchools = new Set()
          ids.forEach((gid) => {
            const s = gameToSchools.get(gid)
            if (s) s.forEach((sid) => allSchools.add(sid))
          })
          stats[t.id] = {
            games: ids.length,
            schools: allSchools.size,
            record: computeRecord(list),
            liveGames: teamLive.get(t.id) || [],
            nextGame: teamNext.get(t.id) || null,
          }
        })
        setTeamStats(stats)
      } else {
        setTeamStats({})
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
      if (filterProgram !== 'all' && String(t.program_id) !== filterProgram)
        return false
      if (filterGender !== 'all' && t.gender !== filterGender) return false
      return true
    })
  }, [teams, filterProgram, filterGender])

  // Favorited teams (subset of filtered teams) — drives "My Teams" section
  const favoriteTeams = useMemo(() => {
    if (favorites.length === 0) return []
    const favSet = new Set(favorites)
    return filteredTeams.filter((t) => favSet.has(t.id))
  }, [filteredTeams, favorites])

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
          <HamburgerMenu />
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-6">
        {/* Season selector */}
        <div className="mb-5">
          <SeasonSelector
            value={selectedSeason}
            onChange={setSelectedSeason}
            variant="parent"
          />
        </div>

        {!selectedSeason || loading ? (
          <div className="text-center py-12 text-gray-500">Loading...</div>
        ) : error ? (
          <ErrorMessage error={error} onRetry={() => load(selectedSeason.id)} />
        ) : (
          <>
            {/* My Teams (favorites) — pinned above the grouped lists */}
            {favoriteTeams.length > 0 && (
              <section className="mb-6">
                <h2 className="text-sm font-medium text-gray-500 uppercase tracking-wider mb-2 px-1 flex items-center gap-2">
                  <StarIcon filled small />
                  My Teams
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                  {favoriteTeams.map((t) => (
                    <TeamCard
                      key={`fav-${t.id}`}
                      team={t}
                      stats={teamStats[t.id]}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* All teams grouped */}
            <section className="mb-8">
              <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-2xl font-bold text-gray-900">
                    Our Teams
                  </h2>
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
                  {teams.length === 0
                    ? `No teams in ${selectedSeason.name} yet.`
                    : 'No teams match the current filters.'}
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

/**
 * TeamCard — single team summary on /home.
 *
 * Tap zones:
 *   - Card body → /t/:teamSlug (team page)
 *   - Star button → toggle favorite
 *   - LIVE TRACKER button → smart-routed to live game or event-team page
 *
 * Using a div+onClick (not <Link>) because we have nested actionable elements
 * (star, LIVE button), and nested <Link>s are invalid HTML.
 */
function TeamCard({ team, stats }) {
  const navigate = useNavigate()
  const [isFavorite, setFavorite] = useFavorite(team.id)
  const r = stats?.record
  const liveGames = stats?.liveGames || []
  const hasLive = liveGames.length > 0
  const nextGame = stats?.nextGame

  // Smart routing for LIVE button
  let liveHref = null
  if (hasLive) {
    if (liveGames.length === 1) {
      // Single live game — go straight to it
      liveHref = `/e/${liveGames[0].eventSlug}/${team.slug}/game/${liveGames[0].gameId}`
    } else {
      // Multiple live games (same day, possibly same event) — go to event-team
      // landing so they can pick. Use the first one's event slug.
      liveHref = `/e/${liveGames[0].eventSlug}/${team.slug}`
    }
  }

  const goToTeam = () => navigate(`/t/${team.slug}`)
  const handleKey = (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      goToTeam()
    }
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={goToTeam}
      onKeyDown={handleKey}
      className="bg-white rounded-lg shadow-sm hover:shadow-md transition-shadow p-4 border border-gray-100 cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-500"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="font-semibold text-gray-900 truncate">
            {team.name}
          </div>
          <div className="text-xs text-gray-500 mt-0.5">
            {team.age_groups?.name} · {team.gender} · {team.programs?.name}
          </div>
        </div>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            setFavorite(!isFavorite)
          }}
          aria-label={
            isFavorite ? 'Remove from My Teams' : 'Add to My Teams'
          }
          aria-pressed={isFavorite}
          className="flex-shrink-0 p-1.5 -m-1.5 rounded-full hover:bg-gray-100 active:bg-gray-200"
        >
          <StarIcon filled={isFavorite} />
        </button>
      </div>

      {/* Next game line (only when no live game; otherwise LIVE button covers it) */}
      {!hasLive && nextGame && (
        <div className="text-xs text-gray-600 mt-2 truncate">
          {formatNextGame(nextGame)}
        </div>
      )}

      {/* Mini stat row */}
      <div className="grid grid-cols-5 gap-1 pt-3 mt-3 border-t border-gray-100">
        <MiniStat value={r?.played ?? 0} label="GP" />
        <MiniStat value={r?.wins ?? 0} label="W" />
        <MiniStat value={r?.losses ?? 0} label="L" />
        <MiniStat value={r?.ties ?? 0} label="D" />
        <MiniStat value={stats?.schools ?? 0} label="Colleges" />
      </div>

      {/* LIVE TRACKER button — replaces the old static badge */}
      {hasLive && liveHref && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation()
            navigate(liveHref)
          }}
          className="mt-3 w-full bg-gradient-to-r from-emerald-500 to-cyan-600 text-white text-sm font-semibold rounded-lg py-2.5 px-3 flex items-center justify-center gap-2 shadow-sm hover:opacity-95 active:opacity-90"
        >
          <span
            className="h-2 w-2 rounded-full bg-white animate-pulse"
            aria-hidden="true"
          />
          <span>LIVE TRACKER</span>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M8 5v14l11-7z" />
          </svg>
        </button>
      )}
    </div>
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

function StarIcon({ filled, small = false }) {
  const size = small ? 14 : 20
  if (filled) {
    return (
      <svg
        width={size}
        height={size}
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
      width={size}
      height={size}
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
 * formatNextGame — produces a short one-liner for the team card.
 *   "Plays today 2pm · vs ABC"
 *   "Plays tomorrow · @ XYZ"
 *   "Plays Sat 2pm · vs ABC"
 *   "Plays Oct 5 · vs ABC"
 *
 * Relative day labels for today/tomorrow and within-week dates; absolute
 * month/day beyond a week.
 */
function formatNextGame(next) {
  if (!next || !next.gameDate) return ''
  const date = parseDate(next.gameDate)
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const diffDays = Math.round((date - today) / (1000 * 60 * 60 * 24))

  let dayLabel
  if (diffDays === 0) dayLabel = 'today'
  else if (diffDays === 1) dayLabel = 'tomorrow'
  else if (diffDays > 1 && diffDays < 7)
    dayLabel = date.toLocaleDateString('en-US', { weekday: 'short' })
  else
    dayLabel = date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
    })

  const timeLabel = formatTime(next.gameTime)
  const versus = next.isHome ? 'vs' : '@'
  const opponent = next.opponent || 'TBD'

  const dayAndTime = timeLabel ? `${dayLabel} ${timeLabel}` : dayLabel
  return `Plays ${dayAndTime} · ${versus} ${opponent}`
}

function formatTime(t) {
  if (!t) return ''
  const [h, m] = t.split(':').map(Number)
  const ampm = h >= 12 ? 'pm' : 'am'
  const h12 = h % 12 || 12
  // Drop ":00" for top-of-hour times to keep the line compact: "2pm" vs "2:00pm"
  return m === 0 ? `${h12}${ampm}` : `${h12}:${String(m).padStart(2, '0')}${ampm}`
}

function parseDate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d)
}

function isoDate(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
