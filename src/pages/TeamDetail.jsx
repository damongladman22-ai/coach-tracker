import { useEffect, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import TimePicker from '../components/TimePicker'
import ScoreInput, { gameResult } from '../components/ScoreInput'
import { getCurrentClubId } from '../lib/club'
import { getGameTypes, getDefaultGameTypeId } from '../lib/lookups'

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
 * Route: /admin/teams/:teamId
 */
export default function TeamDetail({ session }) {
  const { teamId } = useParams()
  const [team, setTeam] = useState(null)
  const [games, setGames] = useState([])
  const [events, setEvents] = useState([]) // events in the team's season
  const [gameTypes, setGameTypes] = useState([])
  const [leagueTypeId, setLeagueTypeId] = useState(null)
  const [showcaseTypeId, setShowcaseTypeId] = useState(null)
  const [loading, setLoading] = useState(true)

  const today = new Date().toISOString().slice(0, 10)

  const [showForm, setShowForm] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [formData, setFormData] = useState({
    event_id: '',
    game_date: today,
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

    // Fetch team
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
    }

    setLoading(false)
  }

  const resetForm = () => {
    setEditingGame(null)
    setShowForm(false)
    setFormData({
      event_id: '',
      game_date: today,
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
                const url = `${window.location.origin}/t/${team.slug}`
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
              <div>
                <label className="block text-sm text-gray-600 mb-1">Date *</label>
                <input
                  type="date"
                  value={formData.game_date}
                  onChange={(e) =>
                    setFormData({ ...formData, game_date: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  required
                />
              </div>
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
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No games yet. Add one above.
        </div>
      ) : (
        <div className="space-y-5">
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
    </AdminLayout>
  )
}

function GameList({ games, onEdit, onDelete, onSaveScore, formatDate, formatTime }) {
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
