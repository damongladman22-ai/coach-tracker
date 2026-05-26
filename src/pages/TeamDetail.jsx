import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import TimePicker from '../components/TimePicker'
import DateField from '../components/DateField'
import ScoreInput, { gameResult } from '../components/ScoreInput'
import { getCurrentClubId } from '../lib/club'
import { getGameTypes, getDefaultGameTypeId } from '../lib/lookups'
import { getPublicBaseUrl } from '../lib/publicUrl'

const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
]

/**
 * TeamDetail: all games for a single team, grouped by event.
 *
 * Sprint 2 addition. Lets admins manage the full schedule for a
 * team -- both event-attached games (showcases, tournaments) and
 * standalone games (league fixtures with NULL event_id).
 *
 * Sprint 2 May 26: AthleteOne integration. Adds a sync card with
 * standings position, last-sync info, refresh button, and an
 * expandable form for setting org/event/club/team IDs. Roster and
 * Staff sections render below the games list.
 *
 * Route: /admin/teams/:teamId
 */
export default function TeamDetail({ session }) {
  const { teamId } = useParams()
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [videoCounts, setVideoCounts] = useState({})
  const [events, setEvents] = useState([]) // events in the team's season
  const [gameTypes, setGameTypes] = useState([])
  const [leagueTypeId, setLeagueTypeId] = useState(null)
  const [showcaseTypeId, setShowcaseTypeId] = useState(null)
  const [loading, setLoading] = useState(true)

  // AthleteOne integration state
  const [players, setPlayers] = useState([])
  const [staff, setStaff] = useState([])

  const [showForm, setShowForm] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [formData, setFormData] = useState({
    event_id: '',
    game_date: '',
    opponent: '',
    game_time: '',
    timezone: 'America/New_York',
    game_type_id: '',
    is_home: false,
    location: '',
  })

  useEffect(() => {
    initialize()
  }, [teamId])

  const initialize = async () => {
    setLoading(true)
    const [cid, types, defaultTypeId] = await Promise.all([
      getCurrentClubId(),
      getGameTypes(),
      getDefaultGameTypeId(),
    ])
    setGameTypes(types)
    setShowcaseTypeId(defaultTypeId)
    const league = types.find((t) => t.name.toLowerCase() === 'league')
    setLeagueTypeId(league?.id || defaultTypeId)

    // Fetch team — SELECT * brings in athleteone_* columns too
    const { data: teamData } = await supabase
      .from('teams')
      .select(
        '*, age_groups(name), programs(name), seasons(id, name, slug)'
      )
      .eq('id', teamId)
      .single()
    setTeam(teamData)

    if (teamData) {
      // Events in the team's season (for the optional event dropdown)
      const { data: eventsData } = await supabase
        .from('events')
        .select('id, event_name, slug, start_date, end_date, location')
        .eq('club_id', cid)
        .eq('season_id', teamData.season_id)
        .order('start_date')
      setEvents(eventsData || [])

      // All games for this team
      const { data: gamesData } = await supabase
        .from('games')
        .select('*, game_types(id, name), events(id, event_name, slug, start_date)')
        .eq('team_id', teamId)
        .order('game_date')
      setGames(gamesData || [])

      // Roster + Staff for the AthleteOne sections. Fetched in parallel with
      // video counts. Active and inactive rows both shown; admin sees
      // everything that's ever been synced.
      const [playersResult, staffResult] = await Promise.all([
        supabase
          .from('team_players')
          .select('*')
          .eq('team_id', teamId)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('jersey_number', { ascending: true, nullsFirst: false }),
        supabase
          .from('team_staff')
          .select('*')
          .eq('team_id', teamId)
          .order('sort_order', { ascending: true, nullsFirst: false })
          .order('athleteone_staff_id', { ascending: true, nullsFirst: false }),
      ])
      setPlayers(playersResult.data || [])
      setStaff(staffResult.data || [])

      // Video counts per game (ready only)
      if (gamesData && gamesData.length > 0) {
        const gameIds = gamesData.map((g) => g.id)
        const { data: vidData } = await supabase
          .from('videos')
          .select('game_id')
          .in('game_id', gameIds)
          .eq('upload_status', 'ready')
        const counts = {}
        ;(vidData || []).forEach((v) => {
          counts[v.game_id] = (counts[v.game_id] || 0) + 1
        })
        setVideoCounts(counts)
      } else {
        setVideoCounts({})
      }
    }

    setLoading(false)
  }

  const resetForm = () => {
    setEditingGame(null)
    setShowForm(false)
    setFormData({
      event_id: '',
      game_date: '',
      opponent: '',
      game_time: '',
      timezone: 'America/New_York',
      game_type_id: '',
      is_home: false,
      location: '',
    })
  }

  // When the event selection changes, default game_type appropriately
  const handleEventChange = (eventId) => {
    const next = { ...formData, event_id: eventId }
    if (!formData.game_type_id) {
      next.game_type_id = String(eventId ? showcaseTypeId : leagueTypeId)
    }
    setFormData(next)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.game_date) {
      alert('Date is required.')
      return
    }
    const payload = {
      team_id: parseInt(teamId, 10),
      event_id: formData.event_id || null,
      game_date: formData.game_date,
      opponent: formData.opponent,
      game_time: formData.game_time || null,
      timezone: formData.game_time ? formData.timezone : null,
      game_type_id: formData.game_type_id
        ? parseInt(formData.game_type_id, 10)
        : formData.event_id
        ? showcaseTypeId
        : leagueTypeId,
      is_home: formData.is_home,
      location: formData.location || null,
      last_modified_by: session?.user?.id || null,
    }

    if (editingGame) {
      const { error } = await supabase
        .from('games')
        .update({ ...payload, updated_at: new Date().toISOString() })
        .eq('id', editingGame.id)
      if (error) {
        alert('Could not update game: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('games').insert([payload])
      if (error) {
        alert('Could not create game: ' + error.message)
        return
      }
    }
    resetForm()
    initialize()
  }

  const handleEdit = (game) => {
    setEditingGame(game)
    setFormData({
      event_id: game.event_id ? String(game.event_id) : '',
      game_date: game.game_date,
      opponent: game.opponent || '',
      game_time: game.game_time || '',
      timezone: game.timezone || 'America/New_York',
      game_type_id: String(game.game_type_id || ''),
      is_home: !!game.is_home,
      location: game.location || '',
    })
    setShowForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDelete = async (gameId) => {
    if (!confirm('Delete this game? Attendance records for it will also be deleted.'))
      return
    const { error } = await supabase.from('games').delete().eq('id', gameId)
    if (!error) initialize()
  }

  const handleSaveScore = async (gameId, ourScore, opponentScore) => {
    const { error } = await supabase
      .from('games')
      .update({ our_score: ourScore, opponent_score: opponentScore })
      .eq('id', gameId)
    if (error) {
      alert('Could not save score: ' + error.message)
      return
    }
    // Refresh in place so the badge/record update without losing form state
    setGames((prev) =>
      prev.map((g) =>
        g.id === gameId
          ? { ...g, our_score: ourScore, opponent_score: opponentScore }
          : g
      )
    )
  }

  // Group games by event
  const grouped = (() => {
    const byEvent = new Map() // event_id -> { event, games }
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

  if (loading) {
    return (
      <AdminLayout session={session} title="Loading...">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )
  }
  if (!team) {
    return (
      <AdminLayout session={session} title="Team not found">
        <Link to="/admin/teams" className="text-blue-600 hover:text-blue-800">
          ← Back to Teams
        </Link>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title={team.name}>
      <Link
        to="/admin/teams"
        className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← Back to Teams
      </Link>

      <div className="bg-white rounded-lg shadow-md p-5 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold">{team.name}</h1>
            <p className="text-gray-600 mt-1">
              {team.age_groups?.name} · {team.gender} · {team.programs?.name}
            </p>
            <p className="text-xs text-gray-400 mt-1">
              Season: {team.seasons?.name}
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button
              onClick={() => {
                const url = `${getPublicBaseUrl()}/t/${team.slug}`
                navigator.clipboard.writeText(url)
                alert('Public team link copied to clipboard:\n\n' + url)
              }}
              className="bg-cyan-100 text-cyan-700 px-3 py-2 rounded text-sm hover:bg-cyan-200"
            >
              Copy Public Team Link
            </button>
            <Link
              to={`/t/${team.slug}`}
              target="_blank"
              className="text-center text-sm text-blue-600 hover:underline"
            >
              View public team page →
            </Link>
          </div>
        </div>
      </div>

      {/* AthleteOne sync card. Sits between the team header and the games
          section because it's both reference data (who's on the roster,
          where they stand in the standings) and a control surface (manual
          refresh trigger + ID configuration for setting up new teams). */}
      <AthleteOneCard
        team={team}
        playersCount={players.length}
        playersActive={players.filter((p) => p.active).length}
        staffCount={staff.length}
        staffActive={staff.filter((s) => s.active).length}
        onReload={initialize}
      />

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">
            {editingGame ? 'Edit Game' : 'Add Game'}
          </h2>
          {!showForm && (
            <button
              onClick={() => setShowForm(true)}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              + Add Game
            </button>
          )}
        </div>

        {showForm && (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Event (optional)
                </label>
                <select
                  value={formData.event_id}
                  onChange={(e) => handleEventChange(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">No event (league/standalone game)</option>
                  {events.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.event_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Game Type
                </label>
                <select
                  value={formData.game_type_id}
                  onChange={(e) =>
                    setFormData({ ...formData, game_type_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  <option value="">Default</option>
                  {gameTypes.map((gt) => (
                    <option key={gt.id} value={gt.id}>
                      {gt.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DateField
                label="Date"
                value={formData.game_date}
                onChange={(e) =>
                  setFormData({ ...formData, game_date: e.target.value })
                }
                required
              />
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Opponent
                </label>
                <input
                  type="text"
                  value={formData.opponent}
                  onChange={(e) =>
                    setFormData({ ...formData, opponent: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Time (optional)
                </label>
                <TimePicker
                  value={formData.game_time}
                  onChange={(v) =>
                    setFormData({ ...formData, game_time: v })
                  }
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Timezone
                </label>
                <select
                  value={formData.timezone}
                  onChange={(e) =>
                    setFormData({ ...formData, timezone: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={!formData.game_time}
                >
                  {TIMEZONES.map((tz) => (
                    <option key={tz.value} value={tz.value}>
                      {tz.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
              <div className="flex items-center mt-6">
                <label className="flex items-center gap-2 text-sm text-gray-600">
                  <input
                    type="checkbox"
                    checked={formData.is_home}
                    onChange={(e) =>
                      setFormData({ ...formData, is_home: e.target.checked })
                    }
                    className="h-4 w-4 text-blue-600 rounded"
                  />
                  Home game
                </label>
              </div>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
              >
                {editingGame ? 'Update Game' : 'Add Game'}
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Games list grouped by event */}
      {games.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500 mb-6">
          No games yet. Add one above.
        </div>
      ) : (
        <div className="space-y-5 mb-6">
          {grouped.eventGroups.map(({ event, games: eGames }) => (
            <div key={event.id} className="bg-white rounded-lg shadow-md p-5">
              <div className="flex justify-between items-center mb-3">
                <div>
                  <h3 className="text-lg font-semibold">{event.event_name}</h3>
                  <p className="text-xs text-gray-500">
                    {formatDate(event.start_date)}
                  </p>
                </div>
                <Link
                  to={`/admin/events/${event.id}`}
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  Manage event →
                </Link>
              </div>
              <GameList
                videoCounts={videoCounts}
                games={eGames}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSaveScore={handleSaveScore}
                formatDate={formatDate}
                formatTime={formatTime}
              />
            </div>
          ))}
          {grouped.standalone.length > 0 && (
            <div className="bg-white rounded-lg shadow-md p-5">
              <h3 className="text-lg font-semibold mb-3">Other Games</h3>
              <p className="text-xs text-gray-500 mb-3">
                Standalone games not tied to an event (league fixtures, friendlies)
              </p>
              <GameList
                videoCounts={videoCounts}
                games={grouped.standalone}
                onEdit={handleEdit}
                onDelete={handleDelete}
                onSaveScore={handleSaveScore}
                formatDate={formatDate}
                formatTime={formatTime}
              />
            </div>
          )}
        </div>
      )}

      {/* Roster + Staff cards. Placed after the games list because admins are
          on this page primarily to manage games — the roster/staff sections
          are reference views of what AthleteOne has synced. Both cards are
          hidden entirely when there's no data (e.g., new team with no IDs
          configured yet). */}
      {players.length > 0 && (
        <RosterCard players={players} />
      )}
      {staff.length > 0 && (
        <StaffCard staff={staff} />
      )}
    </AdminLayout>
  )
}

function GameList({ games, videoCounts = {}, onEdit, onDelete, onSaveScore, formatDate, formatTime }) {
  return (
    <div className="divide-y divide-gray-100">
      {games.map((g) => {
        const result = gameResult(g)
        return (
          <div key={g.id} className="flex flex-wrap justify-between items-center py-2 gap-2">
            <div className="flex-1 min-w-0 text-sm">
              <span className="font-medium">{formatDate(g.game_date)}</span>
              {g.game_time && (
                <span className="text-gray-500 ml-1">
                  @ {formatTime(g.game_time)}
                </span>
              )}
              <span className="text-gray-600">
                {' '}
                {g.is_home ? 'vs' : '@'} {g.opponent || 'TBD'}
              </span>
              {result.label && (
                <span
                  className={`ml-2 text-xs font-bold px-2 py-0.5 rounded ${result.color}`}
                >
                  {result.label} {result.score}
                </span>
              )}
              {g.game_types?.name && (
                <span className="ml-2 text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                  {g.game_types.name}
                </span>
              )}
              {g.location && (
                <span className="text-gray-400 text-xs ml-2">📍 {g.location}</span>
              )}
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <ScoreInput
                ourScore={g.our_score}
                opponentScore={g.opponent_score}
                onSave={(o, p) => onSaveScore(g.id, o, p)}
                compact
              />
              <Link
                to={`/admin/games/${g.id}`}
                className="text-cyan-700 bg-cyan-50 hover:bg-cyan-100 px-3 py-1 rounded text-sm"
              >
                Coaches
              </Link>
              <Link
                to={`/admin/games/${g.id}/videos`}
                className={`px-3 py-1 rounded text-sm ${
                  videoCounts[g.id]
                    ? 'text-purple-900 bg-purple-100 hover:bg-purple-200 font-medium'
                    : 'text-purple-700 bg-purple-50 hover:bg-purple-100'
                }`}
              >
                Videos
                {videoCounts[g.id] ? ` (${videoCounts[g.id]})` : ''}
              </Link>
              <button
                onClick={() => onEdit(g)}
                className="text-blue-600 hover:bg-blue-50 px-3 py-1 rounded text-sm"
              >
                Edit
              </button>
              <button
                onClick={() => onDelete(g.id)}
                className="text-red-600 hover:bg-red-50 px-3 py-1 rounded text-sm"
              >
                Delete
              </button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   AthleteOne integration components
   ──────────────────────────────────────────────────────────────────── */

/**
 * AthleteOneCard — the sync control surface for one team.
 *
 * Shows configuration status (configured vs not), the most recent standings
 * position pulled from athleteone_metadata, roster/staff counts, last sync
 * time, and parse warnings. Provides:
 *  - "Refresh from AthleteOne" button (sends the admin's Supabase JWT to
 *    /api/ingest-athleteone, which now accepts either INGEST_SECRET or an
 *    admin JWT).
 *  - Expandable configuration form to set org_id, event_id, club_id,
 *    team_id, and the athleteone_sync_games toggle.
 *
 * Saves config directly to the teams row via Supabase. After both refresh
 * and save, calls onReload() to refetch everything.
 */
function AthleteOneCard({ team, playersCount, playersActive, staffCount, staffActive, onReload }) {
  const configured =
    team.athleteone_org_id != null &&
    team.athleteone_event_id != null &&
    team.athleteone_club_id != null &&
    team.athleteone_team_id != null

  // Config form state — initialized from the team row. We keep it as strings
  // for the input fields, parsing back to integers when saving.
  const [showConfig, setShowConfig] = useState(!configured)
  const [config, setConfig] = useState({
    org_id: team.athleteone_org_id != null ? String(team.athleteone_org_id) : '',
    event_id: team.athleteone_event_id != null ? String(team.athleteone_event_id) : '',
    club_id: team.athleteone_club_id != null ? String(team.athleteone_club_id) : '',
    team_id: team.athleteone_team_id != null ? String(team.athleteone_team_id) : '',
    sync_games: !!team.athleteone_sync_games,
  })
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState(null) // { type: 'success' | 'error', text: string }

  // Re-sync local form state if the team prop changes (e.g., after onReload)
  useEffect(() => {
    setConfig({
      org_id: team.athleteone_org_id != null ? String(team.athleteone_org_id) : '',
      event_id: team.athleteone_event_id != null ? String(team.athleteone_event_id) : '',
      club_id: team.athleteone_club_id != null ? String(team.athleteone_club_id) : '',
      team_id: team.athleteone_team_id != null ? String(team.athleteone_team_id) : '',
      sync_games: !!team.athleteone_sync_games,
    })
  }, [
    team.athleteone_org_id,
    team.athleteone_event_id,
    team.athleteone_club_id,
    team.athleteone_team_id,
    team.athleteone_sync_games,
  ])

  const metadata = team.athleteone_metadata || {}
  const standingsPosition = metadata.standings_position
  const parseWarnings = Array.isArray(metadata.parse_warnings)
    ? metadata.parse_warnings
    : []
  const lastSyncedAt = team.athleteone_last_synced_at || metadata.synced_at

  const handleRefresh = async () => {
    setMessage(null)
    setRefreshing(true)
    try {
      const { data: sessionData } = await supabase.auth.getSession()
      const token = sessionData?.session?.access_token
      if (!token) {
        setMessage({ type: 'error', text: 'Not authenticated — please sign in again.' })
        setRefreshing(false)
        return
      }
      const url = `/api/ingest-athleteone?teamId=${team.id}&commit=true`
      const response = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${token}` },
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        setMessage({
          type: 'error',
          text: data?.error || `Sync failed (HTTP ${response.status})`,
        })
        setRefreshing(false)
        return
      }
      const teamResult = (data.results || [])[0]
      if (teamResult?.error) {
        setMessage({ type: 'error', text: teamResult.error })
      } else if (teamResult?.committed) {
        const c = teamResult.committed
        setMessage({
          type: 'success',
          text: `Synced ${c.players_upserted} players, ${c.staff_upserted} staff.`,
        })
      } else {
        setMessage({ type: 'success', text: 'Sync complete.' })
      }
      await onReload()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Sync failed' })
    } finally {
      setRefreshing(false)
    }
  }

  const handleSaveConfig = async (e) => {
    e.preventDefault()
    setMessage(null)
    setSaving(true)
    try {
      const payload = {
        athleteone_org_id: config.org_id ? parseInt(config.org_id, 10) : null,
        athleteone_event_id: config.event_id ? parseInt(config.event_id, 10) : null,
        athleteone_club_id: config.club_id ? parseInt(config.club_id, 10) : null,
        athleteone_team_id: config.team_id ? parseInt(config.team_id, 10) : null,
        athleteone_sync_games: config.sync_games,
      }
      const { error } = await supabase.from('teams').update(payload).eq('id', team.id)
      if (error) {
        setMessage({ type: 'error', text: error.message })
        setSaving(false)
        return
      }
      setMessage({ type: 'success', text: 'Configuration saved.' })
      await onReload()
    } catch (err) {
      setMessage({ type: 'error', text: err.message || 'Save failed' })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-5 mb-6">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3 mb-3">
        <div>
          <h2 className="text-lg font-semibold">AthleteOne Sync</h2>
          <p className="text-xs text-gray-500 mt-0.5">
            Roster, staff, and standings pulled from theecnl.com
          </p>
        </div>
        <button
          type="button"
          onClick={handleRefresh}
          disabled={!configured || refreshing}
          className={`px-4 py-2 rounded-lg text-sm font-medium whitespace-nowrap ${
            !configured || refreshing
              ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {refreshing ? 'Refreshing…' : 'Refresh from AthleteOne'}
        </button>
      </div>

      {/* Status grid: a compact dl-style display of the most useful facts.
          Renders only the rows that actually have data so an unconfigured
          team isn't cluttered with em-dashes. */}
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 text-sm mb-3">
        <StatusRow
          label="Status"
          value={
            configured ? (
              <span className="text-emerald-700 font-medium">✓ Configured</span>
            ) : (
              <span className="text-gray-500">Not configured</span>
            )
          }
        />
        {standingsPosition != null && (
          <StatusRow
            label="Standings"
            value={
              <span className="text-amber-700 font-medium">
                🏆 {ordinal(standingsPosition)} in conference
              </span>
            }
          />
        )}
        <StatusRow
          label="Roster"
          value={
            playersCount > 0
              ? `${playersCount} players (${playersActive} active)`
              : '—'
          }
        />
        <StatusRow
          label="Staff"
          value={
            staffCount > 0
              ? `${staffCount} members (${staffActive} active)`
              : '—'
          }
        />
        <StatusRow
          label="Sync games"
          value={
            team.athleteone_sync_games
              ? <span className="text-emerald-700">On</span>
              : <span className="text-gray-500">Off (manual games only)</span>
          }
        />
        <StatusRow
          label="Last sync"
          value={lastSyncedAt ? formatRelative(lastSyncedAt) : '—'}
        />
      </dl>

      {parseWarnings.length > 0 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 rounded p-2 text-xs mb-3">
          <strong>Parse warnings:</strong>
          <ul className="list-disc list-inside mt-1">
            {parseWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </div>
      )}

      {message && (
        <div
          className={`rounded p-2 text-sm mb-3 ${
            message.type === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          {message.text}
        </div>
      )}

      <button
        type="button"
        onClick={() => setShowConfig((v) => !v)}
        className="text-sm text-blue-600 hover:text-blue-800"
      >
        {showConfig ? 'Hide configuration' : 'Show configuration'}
      </button>

      {showConfig && (
        <form onSubmit={handleSaveConfig} className="mt-3 space-y-3 border-t border-gray-100 pt-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <ConfigInput
              label="Organization ID"
              hint="9 = ECNL Girls, 12 = ECNL Boys, 13 = ECNL RL Girls, 16 = ECNL RL Boys"
              value={config.org_id}
              onChange={(v) => setConfig({ ...config, org_id: v })}
            />
            <ConfigInput
              label="Event ID"
              hint="Season-specific ID from the theecnl.com URL"
              value={config.event_id}
              onChange={(v) => setConfig({ ...config, event_id: v })}
            />
            <ConfigInput
              label="Club ID"
              hint="437 = Ohio Premier"
              value={config.club_id}
              onChange={(v) => setConfig({ ...config, club_id: v })}
            />
            <ConfigInput
              label="Team ID"
              hint="Team-specific ID from the theecnl.com URL"
              value={config.team_id}
              onChange={(v) => setConfig({ ...config, team_id: v })}
            />
          </div>
          <label className="flex items-start gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={config.sync_games}
              onChange={(e) =>
                setConfig({ ...config, sync_games: e.target.checked })
              }
              className="mt-1 h-4 w-4 text-blue-600 rounded"
            />
            <span>
              <span className="font-medium">Sync games from AthleteOne</span>
              <span className="block text-xs text-gray-500">
                Pull the ECNL schedule into the games table. Leave off if
                you're maintaining games manually (e.g., to include
                friendlies, tournaments, and league games together).
              </span>
            </span>
          </label>
          <div className="flex items-center gap-2">
            <button
              type="submit"
              disabled={saving}
              className={`px-4 py-2 rounded-lg text-sm font-medium ${
                saving
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {saving ? 'Saving…' : 'Save Configuration'}
            </button>
          </div>
        </form>
      )}
    </div>
  )
}

function StatusRow({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-gray-500 w-24 flex-shrink-0">{label}:</dt>
      <dd className="text-gray-900 min-w-0">{value}</dd>
    </div>
  )
}

function ConfigInput({ label, hint, value, onChange }) {
  return (
    <div>
      <label className="block text-sm text-gray-600 mb-1">{label}</label>
      <input
        type="text"
        inputMode="numeric"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^\d]/g, ''))}
        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
      />
      {hint && <p className="text-xs text-gray-400 mt-0.5">{hint}</p>}
    </div>
  )
}

/**
 * RosterCard — read-only list of all players synced from AthleteOne.
 *
 * Active and inactive both shown; inactive players are visually de-
 * emphasized with a small Inactive badge. Layout mirrors the public team
 * page's Roster tab (StaffRow-style) so admin sees the same visual.
 */
function RosterCard({ players }) {
  return (
    <div className="bg-white rounded-lg shadow-md mb-6">
      <div className="p-5 pb-3 border-b border-gray-100">
        <h2 className="text-lg font-semibold">Roster ({players.length})</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Synced from AthleteOne. Use Refresh above to pull the latest.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {players.map((p) => (
          <PersonRow
            key={p.id}
            person={p}
            subtitle={buildPlayerSubtitle(p)}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * StaffCard — read-only list of all coaching staff synced from AthleteOne.
 */
function StaffCard({ staff }) {
  return (
    <div className="bg-white rounded-lg shadow-md mb-6">
      <div className="p-5 pb-3 border-b border-gray-100">
        <h2 className="text-lg font-semibold">Staff ({staff.length})</h2>
        <p className="text-xs text-gray-500 mt-0.5">
          Synced from AthleteOne. Use Refresh above to pull the latest.
        </p>
      </div>
      <div className="divide-y divide-gray-100">
        {staff.map((s) => (
          <PersonRow
            key={s.id}
            person={s}
            subtitle={s.title || '—'}
            email={s.email}
          />
        ))}
      </div>
    </div>
  )
}

/**
 * PersonRow — shared row layout for both Roster and Staff cards.
 *
 * Photo (or initials) on the left, name + subtitle on the right, optional
 * email beneath. Inactive rows get an "Inactive" badge and a strikethrough.
 */
function PersonRow({ person, subtitle, email }) {
  const initials =
    ((person.first_name || '').charAt(0) +
      (person.last_name || '').charAt(0)).toUpperCase() || '?'
  const fullName = `${person.first_name || ''} ${person.last_name || ''}`.trim()
  const isInactive = person.active === false

  return (
    <div className={`flex items-center gap-3 p-3 ${isInactive ? 'opacity-60' : ''}`}>
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
        <div className="flex items-center gap-2">
          <div
            className={`font-semibold text-sm text-gray-900 truncate ${
              isInactive ? 'line-through' : ''
            }`}
          >
            {person.first_name} {person.last_name}
          </div>
          {isInactive && (
            <span className="text-[10px] font-medium bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded uppercase tracking-wide flex-shrink-0">
              Inactive
            </span>
          )}
        </div>
        <div className="text-xs text-gray-500 truncate">{subtitle}</div>
        {email && (
          <a
            href={`mailto:${email}`}
            className="text-xs text-cyan-700 hover:underline truncate block"
          >
            {email}
          </a>
        )}
      </div>
    </div>
  )
}

/* ────────────────────────────────────────────────────────────────────
   Helpers
   ──────────────────────────────────────────────────────────────────── */

function buildPlayerSubtitle(player) {
  const parts = []
  if (player.jersey_number != null && player.jersey_number !== '') {
    parts.push(`#${player.jersey_number}`)
  }
  if (player.position) parts.push(player.position)
  if (player.grad_year) parts.push(`'${String(player.grad_year).slice(-2)}`)
  return parts.join(' · ') || '—'
}

function ordinal(n) {
  const num = Number(n)
  if (!Number.isFinite(num)) return String(n)
  const suffixes = ['th', 'st', 'nd', 'rd']
  const v = num % 100
  const suffix = suffixes[(v - 20) % 10] || suffixes[v] || suffixes[0]
  return `${num}${suffix}`
}

/**
 * formatRelative — short, human-friendly "X minutes ago" style timestamp.
 *
 * For older timestamps, falls back to a local-date string. Avoids pulling
 * in a date library for what is, at heart, a one-line UI nicety.
 */
function formatRelative(iso) {
  if (!iso) return '—'
  const then = new Date(iso)
  if (isNaN(then.getTime())) return '—'
  const diffMs = Date.now() - then.getTime()
  const diffSec = Math.round(diffMs / 1000)
  if (diffSec < 60) return 'just now'
  const diffMin = Math.round(diffSec / 60)
  if (diffMin < 60) return `${diffMin} min ago`
  const diffHr = Math.round(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hr ago`
  const diffDay = Math.round(diffHr / 24)
  if (diffDay < 7) return `${diffDay} day${diffDay === 1 ? '' : 's'} ago`
  return then.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
