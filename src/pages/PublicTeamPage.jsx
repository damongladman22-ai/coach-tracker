import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link } from 'react-router-dom'
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
 *  - Roster section: horizontal-scrollable player cards with "View all"
 *  - Video section: thumbnail gallery with inline player below
 *  - Tab strip: Games | Events | Staff
 *    (Staff only appears when AthleteOne ingest has populated it)
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
 *    them up.
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
 *  - Roster moved out of the tab strip into its own prominent section
 *    above the tabs (RosterSection). Horizontal-scrollable preview of 6
 *    player cards on phones, "View all" expands to a full grid. Photos
 *    from team_players.photo_url; initials fallback in cyan-tinted circle.
 *  - Video gallery added as its own section above the tab strip
 *    (VideoSection). Manual uploads only (not from AthleteOne). 3-thumb
 *    preview with "View all" expanding to a full grid. Tap any thumbnail
 *    to play inline below the gallery — a single shared player slot, not
 *    stacked per-thumbnail panels, so video real estate stays generous.
 *  - "Colleges Watching This Team" table below the tabs is preserved as a
 *    complementary detail view — the hero pills are a teaser, the table is
 *    the full list with division/conference/games.
 */
export default function PublicTeamPage() {
  const { teamSlug } = useParams()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [attendance, setAttendance] = useState([])
  const [players, setPlayers] = useState([])
  const [staff, setStaff] = useState([])
  const [activeTab, setActiveTab] = useState('games') // 'games' | 'events' | 'staff'
  // Sprint 2: videos became a prominent section above the tab strip with
  // a preview/expand toggle for cases where a team has lots of uploads.
  // Roster became a section too but uses a simpler always-scroll model
  // (horizontal scroll on all viewports — no expand state). playingVideoId
  // tracks which video the inline player below the gallery is showing;
  // single shared player avoids stacking N panels for N thumbnails.
  const [videosExpanded, setVideosExpanded] = useState(false)
  const [playingVideoId, setPlayingVideoId] = useState(null)
  // Sprint 4.5: full conference standings table opens in a modal when
  // the user taps the Conference metric card. Only rendered when the
  // AthleteOne ingest has populated team.athleteone_metadata.conference_standings.
  const [showStandingsModal, setShowStandingsModal] = useState(false)
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
  //
  // Filters out season-long events (>30 days) — they shouldn't hijack the
  // hero panel as "Active now" just because we're partway through the
  // conference season. The hero is reserved for discrete, time-bounded
  // events where "Log attendance" actually makes sense as a call to action.
  const featuredEvent = useMemo(() => {
    const todayStr = todayISO()

    const discreteEvents = eventGroups.filter((g) => {
      const days = getEventDurationDays(g.event.start_date, g.event.end_date)
      return days <= 30
    })

    const active = discreteEvents.find((g) => {
      const start = g.event.start_date
      const end = g.event.end_date || start
      return start <= todayStr && todayStr <= end
    })
    if (active) return { ...active, status: 'active' }

    const upcoming = discreteEvents
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

  // Flat list of videos across all games for the Videos section. Each entry
  // carries a back-reference to its game so the gallery can show "vs
  // Opponent · May 24" beneath the thumbnail and route the inline player
  // when one is tapped. Sorted newest game first; within a game the order
  // is whatever videosByGame supplied (most recent upload first via the
  // realtime hook). Recomputes whenever games or videosByGame changes.
  const allVideos = useMemo(() => {
    if (!games.length) return []
    const flat = []
    games.forEach((g) => {
      const vids = videosByGame[g.id] || []
      vids.forEach((v) => flat.push({ ...v, game: g }))
    })
    return flat.sort((a, b) => {
      const aDate = parseGameDate(a.game.game_date)
      const bDate = parseGameDate(b.game.game_date)
      return bDate - aDate
    })
  }, [games, videosByGame])

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

  // Sprint 4.5: full conference standings table for the modal. Populated
  // by the ingest call to AthleteOne's get-conference-standings endpoint.
  // Array of { place, team_id, team_name, qualification, gp, wins, losses,
  // draws, gf, ga, gd, ppg, pts }. Empty/missing when ingest hasn't run
  // yet — Conference card stays non-tappable in that case.
  const conferenceStandings =
    team?.athleteone_metadata?.conference_standings || []
  const conferenceSyncedAt = team?.athleteone_metadata?.conference_synced_at
  const ourAthleteOneTeamId = team?.athleteone_team_id || null
  const hasConferenceData = conferenceStandings.length > 0

  // Roster is its own prominent section now (Sprint 2), not a tab. Staff
  // stays as a tab — lower-traffic and the email-on-tap workflow already
  // works well there. Both still gate on data being present so teams with
  // no AthleteOne sync don't see empty containers.
  const hasRoster = players.length > 0
  const hasStaff = staff.length > 0
  const hasVideos = allVideos.length > 0

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
                present. Grid columns scale to the actual card count.
                When conference standings data is populated (Sprint 4.5),
                the Conference card becomes tappable and opens a modal
                showing the full league table. */}
            <MetricCardsRow
              record={computeRecord(games)}
              standingsPosition={standingsPosition}
              headCoach={headCoach}
              onConferenceClick={
                hasConferenceData
                  ? () => setShowStandingsModal(true)
                  : null
              }
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

            {/* Roster preview section (Sprint 2). Horizontal-scrollable
                strip of all player cards. Tap a card to learn more about
                the player (future). Hides entirely when no roster has
                been ingested. */}
            {hasRoster && <RosterSection players={players} />}

            {/* Video gallery section (Sprint 2). Recent game videos
                (manually uploaded — NOT from AthleteOne) across all this
                team's games. Tap a thumbnail to play it inline below the
                gallery; one shared player slot rather than stacking per
                thumbnail. "View all N" expands to a full grid. */}
            {hasVideos && (
              <VideoSection
                videos={allVideos}
                expanded={videosExpanded}
                onToggle={() => setVideosExpanded((e) => !e)}
                playingVideoId={playingVideoId}
                onPlay={(vid) => setPlayingVideoId(vid)}
                onClose={() => setPlayingVideoId(null)}
                teamName={team?.name}
              />
            )}

            {/* Tab strip. Games + Events are always present; Staff appears
                only when AthleteOne has populated it. Roster moved out to
                its own section above (Sprint 2). overflow-x-auto handles
                narrow screens when all three tabs are present. */}
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

            {activeTab === 'staff' && hasStaff && (
              <div className="bg-white rounded-lg shadow-md divide-y divide-gray-100 mb-8">
                {staff.map((s) => (
                  <StaffRow key={s.id} person={s} />
                ))}
              </div>
            )}

            {/* Top colleges */}
            {topColleges.length > 0 && (
              <div id="colleges-watching" className="scroll-mt-20">
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
                      {topColleges.map((s) => {
                        const href = teamCollegeHref(teamSlug, s.id)
                        const go = () => navigate(href)
                        return (
                          <tr
                            key={s.id}
                            role="link"
                            tabIndex={0}
                            onClick={go}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                go()
                              }
                            }}
                            className="cursor-pointer hover:bg-cyan-50 transition-colors focus:outline-none focus:bg-cyan-50"
                            title={`See ${s.school} coaches who watched our games`}
                          >
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
                        )
                      })}
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
              </div>
            )}
          </>
        )}
      </main>
        <FeedbackButton />
        {/* Conference standings modal (Sprint 4.5). Mounted at the page
            root so its fixed-position overlay sits above all content.
            Render-gated on conferenceStandings being populated AND the
            user having opened it — keeps the DOM clean otherwise. */}
        {showStandingsModal && hasConferenceData && (
          <ConferenceStandingsModal
            standings={conferenceStandings}
            ourTeamId={ourAthleteOneTeamId}
            syncedAt={conferenceSyncedAt}
            teamName={team?.name}
            ageGroupName={team?.age_groups?.name}
            onClose={() => setShowStandingsModal(false)}
          />
        )}
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
function MetricCardsRow({ record, standingsPosition, headCoach, onConferenceClick }) {
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
    // Sprint 4.5: Conference card becomes interactive when the full
    // standings table is available (onConferenceClick passed from parent).
    // Otherwise renders as a plain card. Affordance is a subtle "View
    // table" hint + cursor change so the tap behaviour is discoverable
    // without shouting.
    cards.push({
      key: 'standing',
      primary: ordinal(standingsPosition),
      label: onConferenceClick ? 'View league →' : 'In conference',
      color: 'text-amber-700',
      prefixIcon: '🏆',
      onClick: onConferenceClick || null,
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
      {cards.map((c) => {
        // Choose the wrapper element: button for interactive cards
        // (Conference when standings modal is available), plain div
        // otherwise. Button gets hover/active states and a focus ring
        // for keyboard users.
        const Wrapper = c.onClick ? 'button' : 'div'
        const wrapperProps = c.onClick
          ? {
              type: 'button',
              onClick: c.onClick,
              className:
                'text-left bg-white rounded-lg shadow-sm p-3 sm:p-4 hover:bg-gray-50 active:bg-gray-100 transition-colors cursor-pointer focus:outline-none focus:ring-2 focus:ring-cyan-400',
              'aria-label': `${c.label}, ${c.primary}. Opens conference standings table.`,
            }
          : {
              className: 'bg-white rounded-lg shadow-sm p-3 sm:p-4',
            }
        return (
          <Wrapper key={c.key} {...wrapperProps}>
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
            <div
              className={`text-[10px] sm:text-xs uppercase tracking-wider font-medium mt-1 truncate ${
                c.onClick ? 'text-cyan-700' : 'text-gray-500'
              }`}
            >
              {c.label}
            </div>
          </Wrapper>
        )
      })}
    </div>
  )
}

/**
 * ConferenceStandingsModal — full-screen overlay showing the complete
 * league table fetched from AthleteOne's get-conference-standings endpoint.
 *
 * Triggered from the Conference metric card on PublicTeamPage when the
 * ingest function has populated team.athleteone_metadata.conference_standings.
 *
 * Layout:
 *   Header: title + age group context + close X
 *   Table:  POS | TEAMS | GP | W-L-T | GF-GA | GD | PPG | PTS
 *           — POS/Team/W-L-T/Pts always visible
 *           — secondary columns (GP/GF-GA/GD/PPG) hide on narrow viewports
 *           — our team's row highlighted with cyan background + left border
 *   Footer: "Last updated" timestamp + source note
 *
 * Dismissal:
 *   - Close X button (top-right)
 *   - Backdrop click (the dark area outside the card)
 *   - Escape key (handler attached on mount)
 *
 * Scroll behaviour: the table itself scrolls within the modal card so
 * the header/footer stay fixed. On mobile the whole modal can scroll if
 * the table is tall enough (max-h on the wrapper, not on the table).
 */
function ConferenceStandingsModal({
  standings,
  ourTeamId,
  syncedAt,
  teamName,
  ageGroupName,
  onClose,
}) {
  // Escape key closes the modal. Cleanup on unmount so we don't leak
  // listeners across re-renders.
  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  // Body scroll lock while modal is open — without this, scrolling the
  // table on mobile bleeds through to the underlying page.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [])

  // Find our team's row to surface qualification status in the header
  // sub-line ("8th · North American Cup"). Falls back gracefully when
  // ourTeamId isn't in the standings array (e.g. mid-season team move).
  const ourRow = ourTeamId
    ? standings.find((r) => r.team_id === ourTeamId)
    : null

  // Group rows by division. For single-division conferences every row has
  // division=null and we get one anonymous group (no section header).
  // For multi-division (Ohio Valley G2010 → North/South) we get one
  // group per division, preserving the response order so North stays
  // before South. The UI renders a small uppercase row inside the tbody
  // ahead of each named group — sticky table head stays put across them.
  const groups = useMemo(() => {
    const map = new Map()
    for (const row of standings) {
      if (!row) continue
      const key = row.division || ''
      if (!map.has(key)) {
        map.set(key, { name: row.division || null, rows: [] })
      }
      map.get(key).rows.push(row)
    }
    return Array.from(map.values())
  }, [standings])

  const hasNamedDivisions = groups.some((g) => g.name)

  // Friendly relative time for the "Last updated" footer. AthleteOne
  // standings typically refresh within hours of league results being
  // entered, so we show absolute date for older syncs.
  const lastUpdated = useMemo(() => {
    if (!syncedAt) return null
    try {
      const dt = new Date(syncedAt)
      const diffMs = Date.now() - dt.getTime()
      const diffHours = Math.round(diffMs / (1000 * 60 * 60))
      if (diffHours < 1) return 'Updated just now'
      if (diffHours < 24) return `Updated ${diffHours}h ago`
      const diffDays = Math.round(diffHours / 24)
      if (diffDays < 7) return `Updated ${diffDays}d ago`
      return `Updated ${dt.toLocaleDateString()}`
    } catch {
      return null
    }
  }, [syncedAt])

  // Backdrop click closes the modal. Clicks on the card itself shouldn't
  // bubble up to the backdrop, so we stopPropagation on the inner div.
  const onBackdropClick = (e) => {
    if (e.target === e.currentTarget) onClose()
  }

  // Render through a portal to document.body so the modal escapes any
  // parent stacking context (PullToRefresh wraps the page in a transform
  // that creates one, which can sink fixed children below sibling
  // backdrops). Inline styles for max-height bypass any Tailwind
  // arbitrary-value JIT compilation concerns.
  const modal = (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="standings-modal-title"
      onClick={onBackdropClick}
      style={{ zIndex: 9999 }}
      className="fixed inset-0 flex items-center justify-center bg-black/60 p-3 sm:p-6"
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{ maxHeight: '90vh', minHeight: '240px' }}
        className="bg-white rounded-xl shadow-2xl w-full max-w-3xl flex flex-col overflow-hidden"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-3 p-4 sm:p-5 border-b border-gray-200 flex-shrink-0">
          <div className="min-w-0 flex-1">
            <h2
              id="standings-modal-title"
              className="text-lg sm:text-xl font-bold text-gray-900"
            >
              Conference Standings
            </h2>
            {(ageGroupName || ourRow) && (
              <p className="text-xs sm:text-sm text-gray-600 mt-0.5 truncate">
                {ageGroupName && <span>{ageGroupName}</span>}
                {ageGroupName && ourRow && <span> · </span>}
                {ourRow && (
                  <span>
                    {ourRow.division && `${ourRow.division} · `}
                    {ordinal(ourRow.place)}
                    {ourRow.division ? ' in division' : ' place'}
                    {ourRow.ppg != null && ` · ${ourRow.ppg.toFixed(2)} PPG`}
                    {ourRow.qualification && ` · ${ourRow.qualification}`}
                  </span>
                )}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close standings"
            className="flex-shrink-0 p-2 -m-1 rounded-full hover:bg-gray-100 active:bg-gray-200 focus:outline-none focus:ring-2 focus:ring-cyan-400"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              aria-hidden="true"
            >
              <path
                d="M5 5l10 10M15 5L5 15"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
              />
            </svg>
          </button>
        </div>

        {/* Table — scrollable when content overflows the modal */}
        <div className="flex-1 overflow-y-auto min-h-0">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 border-b border-gray-200 z-10">
              <tr className="text-[11px] uppercase tracking-wider text-gray-600">
                <th className="text-center px-2 sm:px-3 py-2 font-semibold w-10">
                  #
                </th>
                <th className="text-left px-2 py-2 font-semibold">Team</th>
                <th className="hidden sm:table-cell text-center px-2 py-2 font-semibold">
                  GP
                </th>
                <th className="text-center px-2 py-2 font-semibold">W-L-T</th>
                <th className="hidden md:table-cell text-center px-2 py-2 font-semibold">
                  GF-GA
                </th>
                <th className="hidden sm:table-cell text-center px-2 py-2 font-semibold">
                  GD
                </th>
                {/* PPG is the primary ranking metric in ECNL — it
                    normalizes for uneven games-played across teams
                    (weather cancellations, schedule asymmetries). Always
                    visible, bold-weighted to match the Pts column it
                    sits beside. */}
                <th className="text-center px-2 py-2 font-semibold">PPG</th>
                <th className="text-center px-2 sm:px-3 py-2 font-semibold">
                  Pts
                </th>
              </tr>
            </thead>
            <tbody>
              {groups.map((group, groupIdx) => (
                <Fragment key={group.name || `group-${groupIdx}`}>
                  {/* Section divider row — only renders when this group
                      has a division name. For single-division responses
                      every group has name=null so nothing extra appears
                      and the table looks the same as before. colSpan=8
                      to span every column at every breakpoint (hidden
                      cells simply don't contribute width). */}
                  {group.name && (
                    <tr className="bg-slate-100 border-t-2 border-b border-slate-300">
                      <td
                        colSpan={8}
                        className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-slate-700"
                      >
                        {group.name}
                      </td>
                    </tr>
                  )}
                  {group.rows.map((row, idx) => {
                    if (!row) return null
                    const isOurs =
                      ourTeamId && row.team_id === ourTeamId
                    return (
                      <tr
                        key={row.team_id || `row-${groupIdx}-${idx}`}
                        className={`border-b border-gray-100 ${
                          isOurs ? 'bg-cyan-50' : 'hover:bg-gray-50'
                        }`}
                        style={
                          isOurs
                            ? { boxShadow: 'inset 4px 0 0 0 #06b6d4' }
                            : undefined
                        }
                      >
                        <td className="text-center px-2 sm:px-3 py-2.5 tabular-nums font-semibold text-gray-700">
                          {row.place}
                        </td>
                        <td className="px-2 py-2.5">
                          <div
                            className={`truncate ${
                              isOurs
                                ? 'font-bold text-cyan-900'
                                : 'text-gray-900'
                            }`}
                            title={row.team_name}
                          >
                            {row.team_name}
                          </div>
                          {row.qualification && (
                            <div className="text-[10px] text-gray-500 truncate">
                              {row.qualification}
                            </div>
                          )}
                        </td>
                        <td className="hidden sm:table-cell text-center px-2 py-2.5 tabular-nums text-gray-700">
                          {row.gp ?? '—'}
                        </td>
                        <td className="text-center px-2 py-2.5 tabular-nums text-gray-700">
                          {row.wins ?? 0}-{row.losses ?? 0}-{row.draws ?? 0}
                        </td>
                        <td className="hidden md:table-cell text-center px-2 py-2.5 tabular-nums text-gray-700">
                          {(row.gf ?? 0)}-{(row.ga ?? 0)}
                        </td>
                        <td
                          className={`hidden sm:table-cell text-center px-2 py-2.5 tabular-nums font-medium ${
                            row.gd > 0
                              ? 'text-emerald-700'
                              : row.gd < 0
                              ? 'text-rose-700'
                              : 'text-gray-700'
                          }`}
                        >
                          {row.gd != null
                            ? row.gd > 0
                              ? `+${row.gd}`
                              : `${row.gd}`
                            : '—'}
                        </td>
                        {/* PPG — bolded to signal it's the primary
                            ranking metric. ECNL standings are PPG-sorted
                            (not Pts-sorted) precisely because games-
                            played is uneven, so this is the number
                            parents care about most when scanning. */}
                        <td className="text-center px-2 py-2.5 tabular-nums font-bold text-gray-900">
                          {row.ppg != null ? row.ppg.toFixed(2) : '—'}
                        </td>
                        <td className="text-center px-2 sm:px-3 py-2.5 tabular-nums text-gray-700">
                          {row.pts ?? 0}
                        </td>
                      </tr>
                    )
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="px-4 sm:px-5 py-3 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-3 text-[11px] sm:text-xs text-gray-500 flex-shrink-0">
          <span className="truncate">
            {standings.length} team{standings.length === 1 ? '' : 's'}
            {hasNamedDivisions &&
              ` · ${groups.length} division${groups.length === 1 ? '' : 's'}`}
            {teamName && ourRow && ` · You: ${teamName}`}
          </span>
          {lastUpdated && (
            <span className="flex-shrink-0">{lastUpdated}</span>
          )}
        </div>
      </div>
    </div>
  )

  // Portal into document.body so the modal is a top-level child of the
  // document, escaping any parent transform/filter/perspective that would
  // otherwise establish a stacking context and trap the fixed positioning.
  if (typeof document === 'undefined') return null
  return createPortal(modal, document.body)
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
 * RosterSection — Sprint 2 prominent roster preview above the tab strip.
 *
 * Always renders as a horizontal-scrollable strip of every player on the
 * roster. No expand/collapse toggle — horizontal scroll is the
 * interaction on both mobile (swipe) and desktop (trackpad/scrollbar),
 * which keeps the mental model simple and avoids a second view to
 * manage. Sorted by jersey number (with un-numbered players last) per
 * the load() query.
 *
 * Photos come from team_players.photo_url (AthleteOne CDN assets) with
 * initials as the fallback when no photo is set. Initials avatars use
 * the cyan-tinted palette to match the team's brand styling.
 */
function RosterSection({ players }) {
  return (
    <section className="mb-5">
      <h2 className="text-base font-semibold text-gray-800 mb-2">
        Roster <span className="text-gray-400 font-normal">({players.length})</span>
      </h2>
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {players.map((p) => (
          <PlayerCard key={p.id} player={p} />
        ))}
      </div>
    </section>
  )
}

/**
 * PlayerCard — single tile in the RosterSection.
 *
 * Layout:
 *   [44px circular photo or initials]
 *   #JERSEY (medium weight)
 *   First name
 *   Last name
 *   POS · 'YY (small subtitle)
 *
 * Card is fixed width (w-28, ~112px) so horizontal scroll feels natural
 * and every card aligns. First and last names render on separate lines
 * so longer names stay readable rather than truncating to a single
 * unrecognizable substring; each line still truncates individually for
 * pathological cases (hyphenated surnames longer than the card width).
 * The title attribute carries the full name for hover/long-press.
 */
function PlayerCard({ player }) {
  const initials =
    ((player.first_name || '').charAt(0) +
      (player.last_name || '').charAt(0)).toUpperCase() || '?'
  const fullName = `${player.first_name || ''} ${player.last_name || ''}`.trim()

  const subtitleParts = []
  if (player.position) subtitleParts.push(player.position)
  if (player.grad_year) subtitleParts.push(`'${String(player.grad_year).slice(-2)}`)
  const subtitle = subtitleParts.join(' · ')

  return (
    <div
      className="flex-shrink-0 w-28 bg-white border border-gray-200 rounded-md p-2.5 text-center"
      title={fullName}
    >
      <div className="w-11 h-11 mx-auto mb-1.5 rounded-full overflow-hidden bg-cyan-50 flex items-center justify-center">
        {player.photo_url ? (
          <img
            src={player.photo_url}
            alt={fullName}
            loading="lazy"
            decoding="async"
            className="w-full h-full object-cover"
          />
        ) : (
          <span className="text-sm font-bold text-cyan-700">{initials}</span>
        )}
      </div>
      {player.jersey_number != null && player.jersey_number !== '' && (
        <div className="text-sm font-semibold text-gray-900 leading-tight">
          #{player.jersey_number}
        </div>
      )}
      <div className="text-xs text-gray-900 truncate leading-tight mt-0.5">
        {player.first_name || '—'}
      </div>
      {player.last_name && (
        <div className="text-xs text-gray-900 truncate leading-tight font-medium">
          {player.last_name}
        </div>
      )}
      {subtitle && (
        <div className="text-[10px] text-gray-400 truncate mt-1">{subtitle}</div>
      )}
    </div>
  )
}

/**
 * VideoSection — Sprint 2 prominent video gallery above the tab strip.
 *
 * Collapsed: 3-thumbnail preview row showing the most recent videos
 * (across all games, newest first). A "View all N" button expands the
 * grid to show every video without leaving the page.
 *
 * Expanded: 2-col grid on phone, scaling up to 4-col on desktop.
 *
 * Tap a thumbnail to play it inline — a single GameVideosPanel-style
 * player appears beneath the gallery showing the selected video. The
 * playingVideoId state lives on the parent so the player slot persists
 * across collapsed/expanded transitions, and a close button hides it.
 *
 * Videos are MANUAL uploads — not from AthleteOne. The gallery shows the
 * opponent, date, and parent event (when present) beneath each thumbnail
 * so parents can scan "what game is this?" without playing.
 */
function VideoSection({
  videos,
  expanded,
  onToggle,
  playingVideoId,
  onPlay,
  onClose,
  teamName,
}) {
  const PREVIEW_COUNT = 3
  const visible = expanded ? videos : videos.slice(0, PREVIEW_COUNT)
  const showToggle = videos.length > PREVIEW_COUNT
  const playing = playingVideoId
    ? videos.find((v) => v.id === playingVideoId)
    : null

  // Player slot ref + scroll-into-view on playingVideoId change. Without
  // this, tapping a thumbnail on mobile updates the player below the
  // gallery silently — the player slot is below the fold so users don't
  // see anything happen. Effect-based timing (not handler-based) lets
  // React commit the new player content and the browser paint before we
  // measure, otherwise the scroll can aim at a stale position.
  const playerSlotRef = useRef(null)
  useEffect(() => {
    if (!playingVideoId) return
    const el = playerSlotRef.current
    if (!el) return
    const tid = setTimeout(() => {
      el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }, 60)
    return () => clearTimeout(tid)
  }, [playingVideoId])

  return (
    <section className="mb-5">
      <div className="flex items-baseline justify-between mb-2">
        <h2 className="text-base font-semibold text-gray-800">
          Videos <span className="text-gray-400 font-normal">({videos.length})</span>
        </h2>
        {showToggle && (
          <button
            type="button"
            onClick={onToggle}
            className="text-sm text-cyan-700 font-medium hover:underline"
          >
            {expanded ? 'Show less' : `View all ${videos.length} →`}
          </button>
        )}
      </div>
      <div
        className={
          expanded
            ? 'grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3'
            : 'grid grid-cols-1 sm:grid-cols-3 gap-3'
        }
      >
        {visible.map((v) => (
          <VideoGalleryItem
            key={v.id}
            video={v}
            game={v.game}
            onPlay={() => onPlay(v.id)}
            isPlaying={playingVideoId === v.id}
          />
        ))}
      </div>

      {/* Inline player slot — single shared area below the gallery rather
          than per-thumbnail panels, so we don't stack N players. Ref +
          effect above scrolls this into view on play so mobile users
          don't have to hunt for it below the fold. */}
      {playing && (
        <div
          ref={playerSlotRef}
          className="mt-4 bg-white rounded-lg shadow-md p-3 sm:p-4 scroll-mt-4"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-gray-900 truncate">
                {playing.game.is_home ? 'vs' : '@'}{' '}
                {playing.game.opponent || 'TBD'}
              </div>
              <div className="text-xs text-gray-500 truncate">
                {formatGameDateShort(playing.game.game_date)}
                {playing.game.events?.event_name && (
                  <> · {playing.game.events.event_name}</>
                )}
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close video"
              className="flex-shrink-0 p-1.5 -m-1.5 rounded-full hover:bg-gray-100 active:bg-gray-200 text-gray-500"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>
          <GameVideosPanel
            videos={[playing]}
            game={playing.game}
            teamName={teamName}
          />
        </div>
      )}
    </section>
  )
}

/**
 * VideoGalleryItem — single tappable thumbnail tile in the VideoSection.
 *
 * 16:9 thumbnail with a centered play overlay. Below: opponent/at-symbol
 * and a one-line date + parent event subtitle (truncated). When this
 * video is currently playing, the tile gets a cyan ring to make the
 * association with the inline player below the gallery obvious.
 */
function VideoGalleryItem({ video, game, onPlay, isPlaying }) {
  return (
    <div>
      <button
        type="button"
        onClick={onPlay}
        aria-label={`Play video from game vs ${game.opponent || 'TBD'}`}
        className={`relative w-full aspect-video rounded-md overflow-hidden block bg-slate-200 hover:opacity-90 active:opacity-80 ${
          isPlaying ? 'ring-2 ring-cyan-500' : ''
        }`}
      >
        <VideoThumbnail videoId={video.id} size="fill" />
        <div
          className="absolute inset-0 flex items-center justify-center bg-black/30 pointer-events-none"
          aria-hidden="true"
        >
          <svg width="32" height="32" viewBox="0 0 24 24" fill="white">
            <path d="M8 5v14l11-7z" />
          </svg>
        </div>
      </button>
      <div className="text-xs font-medium text-gray-900 mt-1.5 truncate">
        {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}
      </div>
      <div className="text-[11px] text-gray-500 truncate">
        {formatGameDateShort(game.game_date)}
        {game.events?.event_name && (
          <> · {game.events.event_name}</>
        )}
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
 *   [content lines]                                 [action button]
 *
 * Content lines:
 *   1. Date + result badge + status + "N colleges" indicator + video icon
 *   2. Time · vs/at opponent
 *   3. Event context (or game type) + location
 *
 * Right column: just the action button (Live Tracker / Summary) for games
 * attached to an event. Video playback used to live here as a thumbnail
 * with an expandable panel, but with the Video gallery section above the
 * tab strip handling that prominently, the inline thumbnail was duplicative
 * and made rows visually uneven. A small camera icon on line 1 now signals
 * "this game has video — find it in the Videos section above."
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
  const navigate = useNavigate()
  const r = gameResult(game)
  const eventSlug = game.events?.slug
  // "at [event]" only makes sense for discrete events (showcases,
  // tournaments). For season-long conference wrappers (>30 days), the
  // "event" is a data parent, not a venue or context — showing it on the
  // game card reads weirdly as "at ECNL Girls Ohio Valley 2025-26". Fall
  // through to the game_type badge instead, same path as standalone games.
  // The eventSlug is preserved for the action button (Open Tracker /
  // Summary) since those links still need to route into the event.
  const eventDurationDays = game.events
    ? getEventDurationDays(game.events.start_date, game.events.end_date)
    : 0
  const isDiscreteEvent = eventDurationDays > 0 && eventDurationDays <= 30
  const eventName = isDiscreteEvent ? game.events?.event_name : null
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

  // Action button — present only for games attached to an event. We
  // stopPropagation on its click so the card-level navigation below
  // doesn't fight the button's own destination.
  let action = null
  if (inEvent) {
    if (isPast || isClosed) {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}/summary`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 active:bg-gray-300 px-3 py-2 rounded-lg text-center block whitespace-nowrap"
        >
          Summary
        </Link>
      )
    } else {
      action = (
        <Link
          to={`/e/${eventSlug}/${teamSlug}`}
          onClick={(e) => e.stopPropagation()}
          className="text-xs font-medium bg-cyan-100 text-cyan-700 hover:bg-cyan-200 active:bg-cyan-300 px-3 py-2 rounded-lg text-center block whitespace-nowrap"
        >
          Open Tracker
        </Link>
      )
    }
  }

  // Whole-card click navigates to the unified game detail page. Cursor
  // + hover state signal tappability; role/tabIndex/keyDown give
  // keyboard parity. The action button above is the exception — its
  // click stopPropagation peels off so it can route to live tracker /
  // summary instead of the read-only game detail.
  const detailHref = `/t/${encodeURIComponent(teamSlug)}/game/${encodeURIComponent(game.id)}`
  const goToDetail = () => navigate(detailHref)

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={goToDetail}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          goToDetail()
        }
      }}
      className="p-4 flex items-start gap-3 cursor-pointer hover:bg-gray-50 transition-colors focus:outline-none focus:bg-gray-50"
      title={`View game details vs ${game.opponent || 'opponent'}`}
    >
      <div className="min-w-0 flex-1">
        {/* Line 1: date + result + status badges + coach indicator + video icon */}
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
          {hasVideo && (
            <span
              className="text-xs text-slate-500 inline-flex items-center gap-1"
              title={`${videos.length} video${
                videos.length === 1 ? '' : 's'
              } available — see Videos section above`}
              aria-label={`${videos.length} video${
                videos.length === 1 ? '' : 's'
              } available`}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                aria-hidden="true"
              >
                <rect x="2" y="6" width="14" height="12" rx="2" />
                <path d="m22 8-6 4 6 4V8Z" />
              </svg>
              {videos.length > 1 && (
                <span className="font-medium tabular-nums">
                  {videos.length}
                </span>
              )}
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

      {/* Right column: action button (only when game is in an event) */}
      {action && <div className="flex-shrink-0">{action}</div>}
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

  // Scroll to the "Colleges Watching This Team" section below. The id is
  // anchored on that section; scroll-mt-20 there gives the header room.
  const scrollToColleges = () => {
    const el = document.getElementById('colleges-watching')
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

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
          {/* Counts are a button that scrolls to the full colleges table
              below. Plain link styling (no underline) keeps it visually
              attached to the hero, but the cursor + hover state signal
              tappability. */}
          <button
            type="button"
            onClick={scrollToColleges}
            className="text-left text-xl sm:text-2xl font-bold text-cyan-900 leading-tight hover:text-cyan-700 transition-colors"
            aria-label="Jump to the full Colleges Watching This Team list"
          >
            {stats.coaches} {stats.coaches === 1 ? 'coach' : 'coaches'}
            <span className="text-cyan-700 font-medium"> · </span>
            {stats.schools} {stats.schools === 1 ? 'school' : 'schools'}
            <span className="text-cyan-600 text-base ml-1" aria-hidden="true"> ↓</span>
          </button>
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
              <Link
                key={s.id}
                to={teamCollegeHref(teamSlug, s.id)}
                className="text-xs px-2.5 py-1 bg-white border border-cyan-200 text-cyan-900 rounded-full whitespace-nowrap hover:bg-cyan-100 hover:border-cyan-300 transition-colors"
                title={`See ${s.school} coaches who watched our games`}
              >
                {s.school}
                <span className="text-cyan-600 font-medium ml-1">
                  · {s.games}
                </span>
              </Link>
            ))}
            {topColleges.length > 5 && (
              <button
                type="button"
                onClick={scrollToColleges}
                className="text-xs px-2.5 py-1 text-cyan-700 font-medium hover:text-cyan-900"
              >
                +{topColleges.length - 5} more
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * teamCollegeHref — build the URL for the contextual team × college
 * recruiting detail page (/t/<teamSlug>/college/<schoolId>). This is
 * where pills and table rows on the team page drill into — it's the
 * "what did this college do for OUR team" view, not the general
 * directory. The new page handles its own back-to-team affordance via
 * the URL it was navigated from.
 */
function teamCollegeHref(teamSlug, schoolId) {
  return `/t/${encodeURIComponent(teamSlug)}/college/${encodeURIComponent(schoolId)}`
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

  // Whole-card click target. Active events → live tracker (where parents
  // log coaches in real time); upcoming events → event landing (where
  // parents can see the team's slate of games at that event).
  const destHref = isActive
    ? `/e/${event.slug}/${teamSlug}`
    : `/e/${event.slug}`

  return (
    <Link
      to={destHref}
      className="bg-white rounded-md p-3 flex items-center justify-between gap-3 hover:bg-gray-50 transition-colors block"
    >
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
      {/* Visual CTA badge on active events. Not a nested link (the whole
          card is the click target); the gradient styling tells parents
          where the card will take them. */}
      {isActive && (
        <span
          className="bg-gradient-to-r from-emerald-500 to-cyan-600 text-white text-xs font-semibold rounded-md px-3 py-2 flex-shrink-0 whitespace-nowrap"
          aria-hidden="true"
        >
          Live Tracker →
        </span>
      )}
    </Link>
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

  // Recruiting check falls back to the event name itself when game_types
  // isn't tagged. AthleteOne ingest doesn't always tag showcase events with
  // a game_type, but "ECNL Florida - Winter" in the event_name is a strong
  // enough signal on its own.
  //
  // Duration override: events lasting more than 30 days are NEVER treated
  // as recruiting regardless of keyword match. Catches "ECNL Girls Ohio
  // Valley 2025-26" (the conference season schedule, ~8 months) which
  // would otherwise match on "ecnl" the same way "ECNL Florida - Winter"
  // (3 days) does. A season-long event isn't a showcase no matter what
  // it's called.
  const eventDurationDays = getEventDurationDays(event.start_date, event.end_date)
  const isLongRunning = eventDurationDays > 30
  const isRecruiting =
    !isLongRunning &&
    (isRecruitingType(eventGameType) || isRecruitingType(event.event_name))

  // Badge label policy:
  //  - Recruiting events: override the underlying game_type. AthleteOne
  //    often tags showcase/tournament games as "League" which would read
  //    contradictorily next to the cyan styling. Use "Tournament" when
  //    the event name says so, otherwise "Showcase" as the generic
  //    recruiting label.
  //  - Non-recruiting events: show the actual game_type when set; hide
  //    the badge when no game_type is on the games (no useful label to
  //    show).
  let badgeLabel = null
  if (isRecruiting) {
    const nameLower = (event.event_name || '').toLowerCase()
    badgeLabel = nameLower.includes('tournament') ? 'Tournament' : 'Showcase'
  } else if (eventGameType) {
    badgeLabel = eventGameType
  }

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
            {badgeLabel && (
              <span
                className={`text-[10px] uppercase tracking-wide font-medium px-1.5 py-0.5 rounded flex-shrink-0 ${
                  isRecruiting
                    ? 'bg-cyan-100 text-cyan-800 border border-cyan-200'
                    : 'bg-gray-100 text-gray-600 border border-gray-200'
                }`}
              >
                {badgeLabel}
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

/**
 * formatGameDateShort — "May 24" style, no weekday or year. Used in the
 * VideoSection gallery beneath each thumbnail where space is tight and
 * the weekday adds noise. Distinct from the main formatDate helper (which
 * includes the weekday) and from formatEventDate (which handles ranges).
 */
function formatGameDateShort(s) {
  if (!s) return ''
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  })
}

function parseGameDate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d)
}

/**
 * getEventDurationDays — number of days between an event's start and end
 * dates, inclusive. Used to distinguish discrete events (weekend showcases,
 * 2-4 days; multi-week tournaments, under a month) from season-long
 * schedules (conference seasons, several months). The latter shouldn't be
 * styled as recruiting events even when their names contain "ECNL", and
 * shouldn't hijack the hero panel's "Active now" badge just because we're
 * partway through the season.
 *
 * Returns 0 when start_date is missing (defensive); when only start_date
 * is set, treats it as a 0-day event.
 */
function getEventDurationDays(start, end) {
  if (!start) return 0
  const s = parseGameDate(start)
  const e = end ? parseGameDate(end) : s
  const ms = e - s
  return Math.round(ms / (1000 * 60 * 60 * 24))
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
 * isRecruitingType — substring-match heuristic for whether a name
 * represents a recruiting-flavored event (Showcase / Tournament / ECNL /
 * NPL / "recruit" in the string) vs regular league or friendly play.
 *
 * Called twice from EventCard — once on the dominant game_types.name and
 * once on the event.event_name itself. Either matching is enough to flip
 * the card to cyan styling. The event_name fallback exists because
 * AthleteOne ingest doesn't always tag showcase events with a recruiting
 * game_type, so we lean on the human-readable event title when that
 * tagging is missing.
 *
 * Brittle by design — if Damon adds new game types or event naming
 * conventions, this list may need extending. The clean fix is an explicit
 * is_recruiting boolean on the game_types table; this heuristic is the
 * bridge until that exists.
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
