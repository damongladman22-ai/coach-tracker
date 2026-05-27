import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { getActiveSeasonId } from '../lib/season'
import { computeRecord, gameResult } from '../components/ScoreInput'
import OPLogo from '../components/OPLogo'
import VideoThumbnail from '../components/VideoThumbnail'
import GameVideosPanel from '../components/GameVideosPanel'
import FeedbackButton from '../components/FeedbackButton'
import HamburgerMenu from '../components/HamburgerMenu'
import PullToRefresh from '../components/PullToRefresh'
import { useRealtimeVideos } from '../hooks/useRealtimeVideos'
import { useFavorite } from '../hooks/useFavorite'

/**
 * Public Team Page at /t/:teamSlug
 *
 * The "team identity" hub for parents/players. Layout:
 *  - Team header card (name, age/gender/program, season, favorite star)
 *  - Metric cards row: Record · GD · Conference standing · Head coach
 *    (Record + GD always shown; Conference + Head Coach conditional on data)
 *  - Recruiting hero panel (College Coach Tracker elevation — second hero)
 *  - Tab strip: Games | Events | Roster | Staff
 *    (Roster + Staff only appear when AthleteOne ingest has populated them)
 *  - Top colleges that have watched this team
 *
 * Defaults to the team in the active season for the given slug.
 *
 * Sprint 2 changes (May 24):
 *  - Old Upcoming/Past split replaced with Games + Events tabs
 *  - Game rows show prominent video thumbnails (replacing the small VideoBadge pill)
 *  - Subtle "N colleges" indicator on game rows where coaches have logged attendance
 *  - Events tab gives a per-event scorecard view, drilling into the existing
 *    /e/:eventSlug/:teamSlug page for game-day flows
 *
 * Sprint 2 changes (May 25):
 *  - Roster tab: 1-column list of players (circular photo, name, jersey/
 *    position/grad year subtitle). Sourced from team_players, populated by
 *    AthleteOne ingest at /api/ingest-athleteone.
 *  - Staff tab: 1-column list of coaching staff (photo, name, title, email).
 *    Sourced from team_staff.
 *  - Roster and Staff share the same row layout for visual consistency.
 *
 * Team Hub redesign (May 27):
 *  - Replaced the 7-stat row (GP/W/L/D/GF/GA/GD inside the team header) and
 *    the "🏆 1st in conference" tagline with a row of 4 metric cards:
 *      • Record — "W-L-D" e.g. "8-4-2" (always shown; "—" before any games)
 *      • Goal diff — "+12" / "-5" / "0" with green/red/neutral color
 *      • Conference — "1st in conference" — shown when standings_position
 *        is populated in teams.athleteone_metadata
 *      • Head coach — name pulled from team_staff where title starts with
 *        "Head Coach" (case-insensitive); hidden when no head coach found
 *    Grid is 2-col on mobile, expands to N-col on sm+ where N is the count
 *    of visible cards (2/3/4). Static class strings so Tailwind JIT picks
 *    them up. Cards visually anchor the team performance story before the
 *    recruiting hero panel.
 *  - Added RecruitingHeroPanel between the metric cards and the tab strip.
 *    Three visual blocks: a coach/school summary line with division
 *    breakdown, an active-or-upcoming event card (active gets the LIVE
 *    tracker CTA with green-to-cyan gradient matching the home page card),
 *    and a row of top-interest school pills. The panel hides entirely when
 *    there's no recruiting story yet (zero attendance AND no upcoming
 *    event), so the page falls back to its prior layout for off-season
 *    teams without breaking flow.
 *  - Event cards in the Events tab get stronger visual differentiation by
 *    game type: a 4px left border (cyan for recruiting-flavored types
 *    like Showcase / Tournament / ECNL / NPL; gray for league or friendly
 *    play) plus a 🎓 icon on recruiting events, plus a tinted badge
 *    matching the border color. Heuristic is intentionally brittle — see
 *    isRecruitingType() — and can be replaced with an explicit
 *    is_recruiting flag on game_types when that data model gets cleaned up.
 *  - "Colleges Watching This Team" table below the tabs is preserved as a
 *    complementary detail view — the hero pills are a teaser, the table is
 *    the full list with division/conference/games.
 */
export default function PublicTeamPage() {
  const { teamSlug } = useParams()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [attendance, setAttendance] = useState([])
  const [players, setPlayers] = useState([])
  const [staff, setStaff] = useState([])
  const [activeTab, setActiveTab] = useState('games') // 'games' | 'events' | 'roster' | 'staff'
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

    // Roster + Staff from AthleteOne sync (only active rows).
    // Parallel with attendance below to keep load() snappy.
    const rosterPromise = supabase
      .from('team_players')
      .select('*')
      .eq('team_id', teamData.id)
      .eq('active', true)
      .order('jersey_number', { ascending: true, nullsFirst: false })
    const staffPromise = supabase
      .from('team_staff')
      .select('*')
      .eq('team_id', teamData.id)
      .eq('active', true)
      .order('athleteone_staff_id', { ascending: true, nullsFirst: false })

    // All attendance for those games
    let attendancePromise = Promise.resolve({ data: [] })
    if (gamesData && gamesData.length > 0) {
      const gameIds = gamesData.map((g) => g.id)
      attendancePromise = supabase
        .from('attendance')
        .select(
          'id, game_id, coach_id, coaches(id, first_name, last_name, schools(id, school, city, state, division, conference))'
        )
        .in('game_id', gameIds)
    }

    const [
      { data: playersData },
      { data: staffData },
      { data: attData },
    ] = await Promise.all([rosterPromise, staffPromise, attendancePromise])

    setPlayers(playersData || [])
    setStaff(staffData || [])
    setAttendance(attData || [])

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

  // Distinct schools per division — feeds the "D1: 4 · D2: 3 · D3: 6"
  // breakdown line in the recruiting hero panel. Counts UNIQUE schools per
  // division (not coaches), since the hero summarizes program-level
  // interest rather than headcount.
  const divisionBreakdown = useMemo(() => {
    const seen = new Set()
    const counts = new Map()
    attendance.forEach((a) => {
      const school = a.coaches?.schools
      if (!school || seen.has(school.id)) return
      seen.add(school.id)
      const div = school.division || 'Other'
      counts.set(div, (counts.get(div) || 0) + 1)
    })
    return counts
  }, [attendance])

  // Featured event for the hero panel. Today-active beats upcoming; upcoming
  // is the soonest future event by start_date. Returns null when there's
  // nothing to surface (off-season, no upcoming events scheduled). String
  // comparison on yyyy-mm-dd ISO dates is safe and avoids timezone drift.
  const featuredEvent = useMemo(() => {
    const todayStr = todayISO()

    const active = eventGroups.find((g) => {
      const start = g.event.start_date
      const end = g.event.end_date || start
      return start <= todayStr && todayStr <= end
    })
    if (active) return { ...active, status: 'active' }

    const upcoming = eventGroups
      .filter((g) => g.event.start_date > todayStr)
      .sort(
        (a, b) =>
          parseGameDate(a.event.start_date) - parseGameDate(b.event.start_date)
      )[0]
    if (upcoming) return { ...upcoming, status: 'upcoming' }

    return null
  }, [eventGroups])

  // Head coach pulled from team_staff. Matches title starting with "head
  // coach" (case-insensitive) — catches "Head Coach", "Head Coach (Boys)",
  // "Head Coach - U16" without picking up "Assistant Head Coach" (which
  // starts with "assistant"). Null when no match found, which hides the
  // head coach metric card without breaking layout.
  const headCoach = useMemo(() => {
    if (!staff || staff.length === 0) return null
    return (
      staff.find((s) => {
        const t = (s.title || '').toLowerCase().trim()
        return t.startsWith('head coach')
      }) || null
    )
  }, [staff])

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

  // Standings position pulled from AthleteOne ingest. Stored as a number
  // (1, 2, 3, ...) in the JSONB metadata column. Rendered as ordinal in
  // the Conference metric card.
  const standingsPosition = team?.athleteone_metadata?.standings_position

  // Only show Roster/Staff tabs when we actually have data — non-AthleteOne
  // teams (or teams not yet synced) won't see empty tabs.
  const hasRoster = players.length > 0
  const hasStaff = staff.length > 0

  // Hero panel visibility — show when there's any recruiting story to tell.
  // Either logged attendance OR an active/upcoming event. Off-season teams
  // with neither see the original layout (no empty hero shell).
  const showRecruitingHero = stats.coaches > 0 || featuredEvent != null

  return (
    <PullToRefresh onRefresh={async () => { await load() }}>
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
            {/* Team identity card — name, age/gender/program, season, and
                favorite star. The 7-stat row and standings tagline that used
                to live here moved into the metric cards row below. */}
            <div className="bg-white rounded-lg shadow-md p-4 sm:p-5 mb-3">
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
            </div>

            {/* Metric cards row — Record, GD, Conference, Head coach.
                Record and GD always show ("—" before any games are played);
                Conference and Head coach are conditional on data being
                present. Grid columns scale to the actual card count. */}
            <MetricCardsRow
              record={computeRecord(games)}
              standingsPosition={standingsPosition}
              headCoach={headCoach}
            />

            {/* Recruiting hero panel — the "second hero" of the page,
                elevating the College Coach Tracker story above the tabs.
                Hides entirely when there's no story to tell (zero
                attendance + no active/upcoming event). */}
            {showRecruitingHero && (
              <RecruitingHeroPanel
                stats={stats}
                divisionBreakdown={divisionBreakdown}
                featuredEvent={featuredEvent}
                topColleges={topColleges}
                teamSlug={teamSlug}
              />
            )}

            {/* Tab strip. Games + Events are always present; Roster + Staff
                appear only when their data has been ingested from AthleteOne.
                overflow-x-auto handles narrow screens with all four tabs. */}
            <div className="mb-4 border-b border-gray-200 flex gap-1 overflow-x-auto">
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
              {hasRoster && (
                <TabButton
                  active={activeTab === 'roster'}
                  onClick={() => setActiveTab('roster')}
                >
                  Roster <span className="text-gray-400 ml-1">({players.length})</span>
                </TabButton>
              )}
              {hasStaff && (
                <TabButton
                  active={activeTab === 'staff'}
                  onClick={() => setActiveTab('staff')}
                >
                  Staff <span className="text-gray-400 ml-1">({staff.length})</span>
                </TabButton>
              )}
            </div>

            {/* Tab content. Each tab handles its own empty state. */}
            {activeTab === 'games' && (
              games.length === 0 ? (
                <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500 mb-8">
                  No games scheduled yet.
                </div>
              ) : (
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
              )
            )}

            {activeTab === 'events' && (
              eventGroups.length === 0 ? (
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
              )
            )}

            {activeTab === 'roster' && hasRoster && (
              <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100 mb-8">
                {players.map((p) => (
                  <PlayerRow key={p.id} player={p} />
                ))}
              </div>
            )}

            {activeTab === 'staff' && hasStaff && (
              <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100 mb-8">
                {staff.map((s) => (
                  <StaffRow key={s.id} person={s} />
                ))}
              </div>
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
                    {stats.schools === 1 ? 'college' : 'colleges'} ·{' '}
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
    </PullToRefresh>
  )
}

/**
 * MetricCardsRow — 2-to-4 card grid showing key team metrics.
 *
 * Layout:
 *   Mobile: 2 columns regardless of card count (cards wrap to a second row
 *           if there are 3 or 4)
 *   sm+:    columns scale to actual card count (2/3/4)
 *
 * Tailwind needs static class strings for JIT, so the grid-cols class is
 * picked from a map keyed by count rather than interpolated.
 *
 * Card content:
 *   Record   — "8-4-2" (W-L-D); "—" before any games played
 *   GD       — "+12" / "-5" / "0" with emerald/rose/gray color; "—" before
 *              any games
 *   Conf     — ordinal of standingsPosition; hidden when null
 *   Head Coach — full name; hidden when no staff member matches "head coach"
 */
function MetricCardsRow({ record, standingsPosition, headCoach }) {
  const cards = []

  // Record always shown — "—" placeholder before any games are played so
  // the card grid has visual weight even on a fresh team.
  cards.push({
    key: 'record',
    primary: record.played > 0
      ? `${record.wins}-${record.losses}-${record.ties}`
      : '—',
    label: 'Record',
    color: 'text-gray-900',
  })

  // GD always shown. Color reflects sign: emerald for positive, rose for
  // negative, gray-700 for zero. Pre-season placeholder is "—".
  let gdDisplay
  let gdColor
  if (record.played === 0) {
    gdDisplay = '—'
    gdColor = 'text-gray-400'
  } else if (record.gd > 0) {
    gdDisplay = `+${record.gd}`
    gdColor = 'text-emerald-700'
  } else if (record.gd < 0) {
    gdDisplay = `${record.gd}`
    gdColor = 'text-rose-700'
  } else {
    gdDisplay = '0'
    gdColor = 'text-gray-700'
  }
  cards.push({
    key: 'gd',
    primary: gdDisplay,
    label: 'Goal diff',
    color: gdColor,
  })

  if (standingsPosition != null) {
    cards.push({
      key: 'standing',
      primary: ordinal(standingsPosition),
      label: 'In conference',
      color: 'text-amber-700',
      prefixIcon: '🏆',
    })
  }

  if (headCoach) {
    const name = `${headCoach.first_name || ''} ${headCoach.last_name || ''}`.trim() || '—'
    cards.push({
      key: 'coach',
      primary: name,
      label: 'Head coach',
      color: 'text-gray-900',
      // Smaller font for names since they're wider than "8-4-2" / "+12"
      compact: true,
    })
  }

  if (cards.length === 0) return null

  // Static class map so Tailwind JIT picks up every variant
  const gridClass = {
    2: 'grid grid-cols-2 gap-2 sm:gap-3 mb-5',
    3: 'grid grid-cols-2 sm:grid-cols-3 gap-2 sm:gap-3 mb-5',
    4: 'grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5',
  }[cards.length] || 'grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3 mb-5'

  return (
    <div className={gridClass}>
      {cards.map((c) => (
        <div
          key={c.key}
          className="bg-white rounded-lg shadow-sm p-3 sm:p-4"
        >
          <div
            className={`${
              c.compact
                ? 'text-base sm:text-lg'
                : 'text-xl sm:text-2xl'
            } font-bold leading-tight tabular-nums truncate ${c.color}`}
            title={c.primary}
          >
            {c.prefixIcon && (
              <span className="mr-1" aria-hidden="true">{c.prefixIcon}</span>
            )}
            {c.primary}
          </div>
          <div className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-500 font-medium mt-1 truncate">
            {c.label}
          </div>
        </div>
      ))}
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
 * Tab button used in the Games | Events | Roster | Staff tab strip.
 * Sized for mobile tap targets (44px+ via py-3 + line-height).
 */
function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative px-4 py-3 text-sm font-medium transition-colors whitespace-nowrap ${
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
 * PlayerRow — one row in the Roster list.
 *
 * Layout mirrors StaffRow for visual consistency between the two tabs:
 *   - Circular photo (or initials fallback) on the left
 *   - Name on the right, with a subtitle of "#NN · Position · 'YY"
 *
 * Jersey/position/grad year segments are each conditional, joined by · only
 * when present. Photo URLs come from AthleteOne and are public CDN assets,
 * so we just <img src> them directly with lazy loading.
 */
function PlayerRow({ player }) {
  const initials =
    ((player.first_name || '').charAt(0) +
      (player.last_name || '').charAt(0)).toUpperCase() || '?'
  const fullName = `${player.first_name || ''} ${player.last_name || ''}`.trim()

  // Build subtitle parts, dropping any that are empty so we don't end up
  // with leading/trailing/double separators.
  const parts = []
  if (player.jersey_number != null && player.jersey_number !== '') {
    parts.push(`#${player.jersey_number}`)
  }
  if (player.position) parts.push(player.position)
  if (player.grad_year) parts.push(`'${String(player.grad_year).slice(-2)}`)
  const subtitle = parts.join(' · ') || '—'

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
        {player.photo_url ? (
          <img
            src={player.photo_url}
            alt={fullName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-gray-400">{initials}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm text-gray-900 truncate">
          {player.first_name} {player.last_name}
        </div>
        <div className="text-xs text-gray-500 truncate">{subtitle}</div>
      </div>
    </div>
  )
}

/**
 * StaffRow — one row in the Staff list.
 *
 * Photo (or initials) on the left, name + title stacked on the right.
 * If an email is available it surfaces as a mailto link beneath the title.
 */
function StaffRow({ person }) {
  const initials =
    ((person.first_name || '').charAt(0) +
      (person.last_name || '').charAt(0)).toUpperCase() || '?'
  const fullName = `${person.first_name || ''} ${person.last_name || ''}`.trim()

  return (
    <div className="flex items-center gap-3 p-3">
      <div className="flex-shrink-0 w-12 h-12 rounded-full overflow-hidden bg-gray-100 flex items-center justify-center">
        {person.photo_url ? (
          <img
            src={person.photo_url}
            alt={fullName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-gray-400">{initials}</span>
        )}
      </div>
      <div className="min-w-0 flex-1">
        <div className="font-semibold text-sm text-gray-900 truncate">
          {person.first_name} {person.last_name}
        </div>
        <div className="text-xs text-gray-500 truncate">
          {person.title || '—'}
        </div>
        {person.email && (
          <a
            href={`mailto:${person.email}`}
            className="text-xs text-cyan-700 hover:underline truncate block"
          >
            {person.email}
          </a>
        )}
      </div>
    </div>
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
 * RecruitingHeroPanel — the "second hero" of the team page.
 *
 * Elevates the College Coach Tracker story above the tabs. Three blocks
 * (each independently conditional so the panel adapts to wherever the
 * team is in its season):
 *
 *   1. Summary line — "12 coaches · 8 schools" with a "D1: 4 · D2: 3 · ..."
 *      division breakdown beneath. Shown when any attendance exists; when
 *      there's no attendance yet but an active/upcoming event is queued,
 *      this is replaced by a one-liner inviting parents to start logging.
 *
 *   2. Featured event card — when an event is currently active (today
 *      falls within the date range), the card shows a green pulsing "Active
 *      now" badge plus a green-to-cyan gradient "Live Tracker" button
 *      matching the home page TeamCard for visual consistency. When the
 *      next event is upcoming (future), the card is informational only
 *      ("Up next" gray badge + dates).
 *
 *   3. Top interest pills — top 5 schools by attendance count, each
 *      showing "School Name · N" (games attended). Non-interactive pills
 *      for now; tapping behavior can be wired later once the Coach
 *      Directory has a school-filter parameter to deep-link to.
 *
 * The parent component is responsible for hiding the panel entirely when
 * there's nothing to show (zero attendance AND no featuredEvent) so this
 * component can assume one or the other is present.
 */
function RecruitingHeroPanel({
  stats,
  divisionBreakdown,
  featuredEvent,
  topColleges,
  teamSlug,
}) {
  // Canonical division ordering for the breakdown line. Anything not in
  // this list is dropped (e.g. "Other" rolls up to nothing rather than
  // crowding the line). NJCAA and JC are kept separate in case the data
  // distinguishes them, but they typically render side by side.
  const divOrder = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'NJCAA', 'JC']
  const divisionItems = divOrder
    .map((d) => [d, divisionBreakdown.get(d) || 0])
    .filter(([, n]) => n > 0)

  const hasAttendance = stats.coaches > 0

  return (
    <div className="bg-gradient-to-br from-cyan-50 to-blue-50 border border-cyan-200 rounded-lg shadow-sm p-4 sm:p-5 mb-5">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-lg" aria-hidden="true">🎓</span>
        <h2 className="text-base font-semibold text-cyan-900">
          College recruiting
        </h2>
      </div>

      {hasAttendance ? (
        <>
          <p className="text-xl sm:text-2xl font-bold text-cyan-900 leading-tight">
            {stats.coaches} {stats.coaches === 1 ? 'coach' : 'coaches'}
            <span className="text-cyan-700 font-medium"> · </span>
            {stats.schools} {stats.schools === 1 ? 'school' : 'schools'}
          </p>
          {divisionItems.length > 0 && (
            <p className="text-xs sm:text-sm text-cyan-700 mt-1 mb-3">
              {divisionItems.map(([d, n]) => `${d}: ${n}`).join(' · ')}
            </p>
          )}
        </>
      ) : (
        <p className="text-sm text-cyan-800 mb-3">
          Track which college coaches attend this team's games. Logs from
          parents/players will appear here.
        </p>
      )}

      {featuredEvent && (
        <FeaturedEventCard group={featuredEvent} teamSlug={teamSlug} />
      )}

      {topColleges.length > 0 && (
        <div className={featuredEvent ? 'mt-3' : ''}>
          <p className="text-[10px] uppercase tracking-wide font-medium text-cyan-700 mb-1.5">
            Top interest
          </p>
          <div className="flex flex-wrap gap-1.5">
            {topColleges.slice(0, 5).map((s) => (
              <span
                key={s.id}
                className="text-xs px-2.5 py-1 bg-white border border-cyan-200 text-cyan-900 rounded-full whitespace-nowrap"
              >
                {s.school}
                <span className="text-cyan-600 font-medium ml-1">
                  · {s.games}
                </span>
              </span>
            ))}
            {topColleges.length > 5 && (
              <span className="text-xs px-2.5 py-1 text-cyan-700 font-medium">
                +{topColleges.length - 5} more
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * FeaturedEventCard — small card inside the RecruitingHeroPanel showing
 * the active or upcoming event.
 *
 *  - Active (today within date range): green pulsing "Active now" badge
 *    + green-to-cyan "Live Tracker" gradient CTA. Also surfaces "N
 *    schools logged" inline with the date so parents see momentum.
 *  - Upcoming (future start_date): gray "Up next" badge, date range, no
 *    CTA — purely informational so the page doesn't push parents toward
 *    a tracker that isn't open yet.
 */
function FeaturedEventCard({ group, teamSlug }) {
  const { event, attendance, status } = group
  const isActive = status === 'active'

  // Distinct schools logged at this event so far — only surfaced when the
  // event is active so parents can see "3 schools logged" as the recruiting
  // momentum builds. For upcoming events there's no attendance yet to count.
  let activeSchoolsCount = 0
  if (isActive) {
    const schoolIds = new Set()
    attendance.forEach((a) => {
      if (a.coaches?.schools?.id) schoolIds.add(a.coaches.schools.id)
    })
    activeSchoolsCount = schoolIds.size
  }

  return (
    <div className="bg-white rounded-md p-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <span
          className={
            isActive
              ? 'text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 inline-flex items-center gap-1'
              : 'text-[10px] uppercase tracking-wide font-semibold px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 inline-flex items-center gap-1'
          }
        >
          {isActive && (
            <span
              className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse"
              aria-hidden="true"
            />
          )}
          {isActive ? 'Active now' : 'Up next'}
        </span>
        <p className="text-sm font-semibold text-gray-900 truncate mt-1">
          {event.event_name}
        </p>
        <p className="text-xs text-gray-600 truncate">
          {formatEventDate(event.start_date, event.end_date)}
          {isActive && activeSchoolsCount > 0 && (
            <>
              <span className="text-gray-400"> · </span>
              <span className="text-purple-700 font-medium">
                {activeSchoolsCount}{' '}
                {activeSchoolsCount === 1 ? 'school' : 'schools'} logged
              </span>
            </>
          )}
        </p>
      </div>
      {isActive && (
        <Link
          to={`/e/${event.slug}/${teamSlug}`}
          className="bg-gradient-to-r from-emerald-500 to-cyan-600 text-white text-xs font-semibold rounded-md px-3 py-2 flex-shrink-0 hover:opacity-95 active:opacity-90 whitespace-nowrap"
        >
          Live Tracker →
        </Link>
      )}
    </div>
  )
}

/**
 * EventCard — one entry in the Events tab.
 *
 * Self-contained scorecard for the team at one event. Shows event name,
 * date range, location, and a row of stat pills (GP · W-L-D · GF·GA) along
 * with an optional coach-attendance pill.
 *
 * Visual differentiation by game type:
 *   - Recruiting events (Showcase / Tournament / ECNL / NPL by name match):
 *     4px cyan left border, 🎓 icon before the event name, cyan-tinted
 *     game-type badge
 *   - League / friendly events: 4px gray left border, no icon, gray badge
 *
 * The heuristic in isRecruitingType() is intentionally brittle — substring
 * match on game_types.name. When the data model gains an explicit
 * is_recruiting boolean on game_types, swap that in.
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

  // Dominant game type across the event's games — drives the visual
  // differentiation (border, icon, badge). Skipped when no game has a
  // game_type set; falls through to neutral styling.
  const eventGameType = (() => {
    const counts = new Map()
    games.forEach((g) => {
      const name = g.game_types?.name
      if (!name) return
      counts.set(name, (counts.get(name) || 0) + 1)
    })
    if (counts.size === 0) return null
    return Array.from(counts.entries()).sort((a, b) => b[1] - a[1])[0][0]
  })()

  const isRecruiting = isRecruitingType(eventGameType)

  const allClosed = games.length > 0 && games.every((g) => g.is_closed)
  const destHref = allClosed
    ? `/e/${event.slug}/${teamSlug}/summary`
    : `/e/${event.slug}/${teamSlug}`

  return (
    <Link
      to={destHref}
      className={`block bg-white rounded-lg shadow-md hover:shadow-lg transition-shadow p-4 border-l-4 ${
        isRecruiting ? 'border-l-cyan-500' : 'border-l-gray-300'
      }`}
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            {isRecruiting && (
              <span className="text-base flex-shrink-0" aria-hidden="true">
                🎓
              </span>
            )}
            <h3 className="font-semibold text-gray-900 truncate">
              {event.event_name}
            </h3>
            {eventGameType && (
              <span
                className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                  isRecruiting
                    ? 'bg-cyan-100 text-cyan-800 border border-cyan-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                {eventGameType}
              </span>
            )}
          </div>
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

/**
 * todayISO — today's date as yyyy-mm-dd in local time. Safe to
 * string-compare against event.start_date / end_date which are stored as
 * date-only ISO strings (no time component, no timezone). Using
 * toISOString() would shift across midnight in non-UTC timezones.
 */
function todayISO() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * isRecruitingType — substring-match heuristic for whether a game_types
 * name represents a recruiting-flavored event (Showcase / Tournament /
 * ECNL / NPL / "recruit" in the name) vs regular league or friendly play.
 *
 * Drives the cyan vs gray visual differentiation on EventCard. Brittle by
 * design — if Damon adds new game types, this list may need extending.
 * The clean fix is an explicit is_recruiting boolean on the game_types
 * table; this heuristic is the bridge until that exists.
 */
function isRecruitingType(name) {
  if (!name) return false
  const n = name.toLowerCase()
  return (
    n.includes('showcase') ||
    n.includes('tournament') ||
    n.includes('ecnl') ||
    n.includes('npl') ||
    n.includes('recruit')
  )
}

/**
 * ordinal — turns a number into "1st", "2nd", "3rd", "4th", etc.
 * Handles teens correctly (11th, 12th, 13th).
 */
function ordinal(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = num % 100
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]
  return `${num}${suffix}`
}
