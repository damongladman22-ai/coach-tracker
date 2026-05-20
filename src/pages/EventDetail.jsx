import { useState, useEffect } from 'react'
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

export default function EventDetail({ session }) {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [teamsAtEvent, setTeamsAtEvent] = useState([]) // [{ team, games: [] }]
  const [availableTeams, setAvailableTeams] = useState([])
  const [gameTypes, setGameTypes] = useState([])
  const [defaultGameTypeId, setDefaultGameTypeId] = useState(null)
  const [clubId, setClubId] = useState(null)
  const [loading, setLoading] = useState(true)

  // "Add game" form state
  const [showGameForm, setShowGameForm] = useState(false)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFormData, setGameFormData] = useState({
    team_id: '',
    game_date: new Date().toISOString().slice(0, 10),
    opponent: '',
    game_time: '',
    timezone: 'America/New_York',
    game_type_id: '',
    is_home: false,
    location: '',
  })

  const [exporting, setExporting] = useState(null)
  const [copiedLink, setCopiedLink] = useState(null)

  useEffect(() => {
    initialize()
  }, [eventId])

  const initialize = async () => {
    const [cid, types, defaultTypeId] = await Promise.all([
      getCurrentClubId(),
      getGameTypes(),
      getDefaultGameTypeId(),
    ])
    setClubId(cid)
    setGameTypes(types)
    setDefaultGameTypeId(defaultTypeId)
    setGameFormData((prev) => ({ ...prev, game_type_id: String(defaultTypeId || '') }))
    fetchData(cid)
  }

  const fetchData = async (currentClubId) => {
    setLoading(true)
    const cid = currentClubId || clubId
    if (!cid) {
      setLoading(false)
      return
    }

    // Fetch event with season
    const { data: eventData } = await supabase
      .from('events')
      .select('*, seasons(id, name, slug)')
      .eq('id', eventId)
      .single()
    setEvent(eventData)

    if (!eventData) {
      setLoading(false)
      return
    }

    // Fetch all games at this event WITH their teams
    const { data: gamesData } = await supabase
      .from('games')
      .select(`
        *,
        teams (
          id, name, slug, gender, age_group_id, program_id,
          age_groups (name, sort_order),
          programs (name)
        )
      `)
      .eq('event_id', eventId)
      .order('game_date')

    // Group games by team
    const teamMap = new Map()
    ;(gamesData || []).forEach((game) => {
      if (!game.teams) return
      const teamId = game.teams.id
      if (!teamMap.has(teamId)) {
        teamMap.set(teamId, { team: game.teams, games: [] })
      }
      teamMap.get(teamId).games.push(game)
    })

    const teamsList = Array.from(teamMap.values()).sort((a, b) =>
      a.team.name.localeCompare(b.team.name)
    )
    setTeamsAtEvent(teamsList)

    // Fetch all teams in this event's season (for "add game" dropdown)
    const { data: allTeams } = await supabase
      .from('teams')
      .select('*, age_groups(name, sort_order), programs(name)')
      .eq('club_id', cid)
      .eq('season_id', eventData.season_id)
      .order('name')
    setAvailableTeams(allTeams || [])

    setLoading(false)
  }

  const resetGameForm = () => {
    setEditingGame(null)
    setShowGameForm(false)
    const today = new Date().toISOString().slice(0, 10) // YYYY-MM-DD
    setGameFormData({
      team_id: '',
      game_date: today,
      opponent: '',
      game_time: '',
      timezone: 'America/New_York',
      game_type_id: String(defaultGameTypeId || ''),
      is_home: false,
      location: '',
    })
  }

  const handleSubmitGame = async (e) => {
    e.preventDefault()
    if (!gameFormData.team_id || !gameFormData.game_date) {
      alert('Team and date are required.')
      return
    }

    const payload = {
      team_id: parseInt(gameFormData.team_id, 10),
      event_id: parseInt(eventId, 10),
      game_date: gameFormData.game_date,
      opponent: gameFormData.opponent,
      game_time: gameFormData.game_time || null,
      timezone: gameFormData.game_time ? gameFormData.timezone : null,
      game_type_id: gameFormData.game_type_id
        ? parseInt(gameFormData.game_type_id, 10)
        : defaultGameTypeId,
      is_home: gameFormData.is_home,
      location: gameFormData.location || null,
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

    resetGameForm()
    fetchData()
  }

  const handleEditGame = (game) => {
    setEditingGame(game)
    setGameFormData({
      team_id: String(game.team_id),
      game_date: game.game_date,
      opponent: game.opponent || '',
      game_time: game.game_time || '',
      timezone: game.timezone || 'America/New_York',
      game_type_id: String(game.game_type_id || defaultGameTypeId || ''),
      is_home: !!game.is_home,
      location: game.location || '',
    })
    setShowGameForm(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const handleDeleteGame = async (gameId) => {
    if (!confirm('Delete this game? This will also delete all attendance records for it.')) return
    const { error } = await supabase.from('games').delete().eq('id', gameId)
    if (!error) fetchData()
  }

  const toggleGameClosed = async (game) => {
    const newStatus = !game.is_closed
    const { error } = await supabase
      .from('games')
      .update({
        is_closed: newStatus,
        updated_at: new Date().toISOString(),
      })
      .eq('id', game.id)
    if (!error) fetchData()
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
    // Local update so UI reflects immediately
    setTeamsAtEvent((prev) =>
      prev.map((te) => ({
        ...te,
        games: te.games.map((g) =>
          g.id === gameId
            ? { ...g, our_score: ourScore, opponent_score: opponentScore }
            : g
        ),
      }))
    )
  }

  const getShareableLink = (team) => {
    const baseUrl = window.location.origin
    return `${baseUrl}/e/${event.slug}/${team.slug}`
  }

  const getSummaryLink = (team) => {
    const baseUrl = window.location.origin
    return `${baseUrl}/e/${event.slug}/${team.slug}/summary`
  }

  const copyLink = (team, kind) => {
    const url = kind === 'tracker' ? getShareableLink(team) : getSummaryLink(team)
    navigator.clipboard.writeText(url)
    setCopiedLink(`${kind}-${team.id}`)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    })
  }

  const formatDateShort = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })
  }

  const formatTime = (timeStr) => {
    if (!timeStr) return ''
    const [hours, minutes] = timeStr.split(':').map(Number)
    const ampm = hours >= 12 ? 'PM' : 'AM'
    const hour12 = hours % 12 || 12
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm}`
  }

  const getTimezoneAbbr = (timezone) => {
    const abbrevs = {
      'America/New_York': 'ET',
      'America/Chicago': 'CT',
      'America/Denver': 'MT',
      'America/Phoenix': 'MST',
      'America/Los_Angeles': 'PT',
      'America/Anchorage': 'AKT',
      'Pacific/Honolulu': 'HT',
    }
    return abbrevs[timezone] || ''
  }

  const exportToCSV = async (team, games) => {
    setExporting(team.id)
    try {
      if (games.length === 0) {
        alert('No games to export')
        setExporting(null)
        return
      }

      const gameIds = games.map((g) => g.id)
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select('*, coaches(*, schools(*))')
        .in('game_id', gameIds)

      if (!attendanceData || attendanceData.length === 0) {
        alert('No attendance data to export')
        setExporting(null)
        return
      }

      const schoolData = {}
      attendanceData.forEach((record) => {
        const school = record.coaches?.schools
        const coach = record.coaches
        if (!school || !coach) return

        if (!schoolData[school.id]) {
          schoolData[school.id] = {
            school: school.school,
            division: school.division || '',
            conference: school.conference || '',
            state: school.state || '',
            emails: new Set(),
            games: {},
          }
        }
        if (coach.email) schoolData[school.id].emails.add(coach.email)

        if (!schoolData[school.id].games[record.game_id]) {
          schoolData[school.id].games[record.game_id] = []
        }
        schoolData[school.id].games[record.game_id].push(
          `${coach.first_name} ${coach.last_name}`
        )
      })

      const gameHeaders = games.map((g) => `${formatDateShort(g.game_date)} vs ${g.opponent}`)
      const headers = ['College', 'Division', 'Conference', 'State', 'Email(s)', ...gameHeaders]

      const rows = Object.values(schoolData)
        .sort((a, b) => a.school.localeCompare(b.school))
        .map((data) => {
          const row = [
            `"${data.school}"`,
            `"${data.division}"`,
            `"${data.conference}"`,
            `"${data.state}"`,
            `"${[...data.emails].join('; ')}"`,
          ]
          games.forEach((game) => {
            const coaches = data.games[game.id] || []
            row.push(`"${coaches.join(', ')}"`)
          })
          return row.join(',')
        })

      const csvContent = [headers.map((h) => `"${h}"`).join(','), ...rows].join('\n')
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${event.event_name} - ${team.name}.csv`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)
    } catch (err) {
      console.error('Export error:', err)
      alert('Error exporting data')
    }
    setExporting(null)
  }

  if (loading) {
    return (
      <AdminLayout session={session} title="Loading...">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )
  }

  if (!event) {
    return (
      <AdminLayout session={session} title="Event not found">
        <Link to="/admin/events" className="text-blue-600 hover:text-blue-800">
          ← Back to Events
        </Link>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title={event.event_name}>
      <Link to="/admin/events" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
        ← Back to Events
      </Link>

      {event.location && (
        <p className="text-gray-600 mb-2">📍 {event.location}</p>
      )}
      {event.seasons?.name && (
        <p className="text-xs text-gray-400 mb-4">Season: {event.seasons.name}</p>
      )}

      {/* Add/Edit Game Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <div className="flex justify-between items-center mb-4">
          <h2 className="text-lg font-semibold">
            {editingGame ? 'Edit Game' : 'Add Game'}
          </h2>
          {!showGameForm && (
            <button
              onClick={() => setShowGameForm(true)}
              className="text-blue-600 hover:text-blue-800 text-sm"
            >
              + Add Game
            </button>
          )}
        </div>

        {showGameForm && (
          <form onSubmit={handleSubmitGame} className="space-y-4" noValidate>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Team *</label>
                <select
                  value={gameFormData.team_id}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, team_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  required
                >
                  <option value="">Select a team...</option>
                  {availableTeams.map((team) => (
                    <option key={team.id} value={team.id}>
                      {team.name}
                    </option>
                  ))}
                </select>
                {availableTeams.length === 0 && (
                  <p className="text-xs text-orange-600 mt-1">
                    No teams exist for this event's season.{' '}
                    <Link to="/admin/teams" className="underline">
                      Create one
                    </Link>{' '}
                    first.
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Game Type</label>
                <select
                  value={gameFormData.game_type_id}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, game_type_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
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
                  value={gameFormData.game_date}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, game_date: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  required
                />
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Opponent</label>
                <input
                  type="text"
                  value={gameFormData.opponent}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, opponent: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., ABC Soccer Club"
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm text-gray-600 mb-1">Time (optional)</label>
                <TimePicker
                  value={gameFormData.game_time}
                  onChange={(v) =>
                    setGameFormData({ ...gameFormData, game_time: v })
                  }
                />
                <p className="text-xs text-gray-400 mt-1">
                  If set, tracker locks until near game time
                </p>
              </div>
              <div>
                <label className="block text-sm text-gray-600 mb-1">Timezone</label>
                <select
                  value={gameFormData.timezone}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, timezone: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  disabled={!gameFormData.game_time}
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
                <label className="block text-sm text-gray-600 mb-1">Location</label>
                <input
                  type="text"
                  value={gameFormData.location}
                  onChange={(e) =>
                    setGameFormData({ ...gameFormData, location: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="e.g., Field 3, Stadium Complex"
                />
              </div>
              <div className="flex items-center">
                <label className="flex items-center gap-2 text-sm text-gray-600 mt-6">
                  <input
                    type="checkbox"
                    checked={gameFormData.is_home}
                    onChange={(e) =>
                      setGameFormData({ ...gameFormData, is_home: e.target.checked })
                    }
                    className="h-4 w-4 text-blue-600 rounded"
                  />
                  Home game
                </label>
              </div>
            </div>
            <div className="flex space-x-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-blue-700"
              >
                {editingGame ? 'Update Game' : 'Add Game'}
              </button>
              <button
                type="button"
                onClick={resetGameForm}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg text-sm hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        )}
      </div>

      {/* Teams and their games */}
      {teamsAtEvent.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No games at this event yet. Add one above to get started.
        </div>
      ) : (
        <div className="space-y-6">
          {teamsAtEvent.map(({ team, games }) => (
            <div key={team.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold">{team.name}</h3>
                  <p className="text-gray-500 text-sm">{team.gender}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Link
                    to={`/admin/events/${eventId}/matrix/${team.id}`}
                    className="bg-purple-100 text-purple-700 px-3 py-2 rounded text-sm hover:bg-purple-200"
                  >
                    Attendance Matrix
                  </Link>
                  <button
                    onClick={() => exportToCSV(team, games)}
                    disabled={exporting === team.id}
                    className="bg-blue-100 text-blue-700 px-3 py-2 rounded text-sm hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {exporting === team.id ? 'Exporting...' : 'Export CSV'}
                  </button>
                  <button
                    onClick={() => copyLink(team, 'tracker')}
                    className={`px-3 py-2 rounded text-sm transition-colors ${
                      copiedLink === `tracker-${team.id}`
                        ? 'bg-green-500 text-white'
                        : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                    }`}
                  >
                    {copiedLink === `tracker-${team.id}`
                      ? '✓ Copied!'
                      : 'Copy Tracker Link'}
                  </button>
                  <button
                    onClick={() => copyLink(team, 'summary')}
                    className={`px-3 py-2 rounded text-sm transition-colors ${
                      copiedLink === `summary-${team.id}`
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {copiedLink === `summary-${team.id}`
                      ? '✓ Copied!'
                      : 'Copy Summary Link'}
                  </button>
                </div>
              </div>

              <div className="bg-gray-50 rounded p-3 mb-4 space-y-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Tracker Link:</p>
                  <code className="text-sm text-cyan-600 break-all">
                    {getShareableLink(team)}
                  </code>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Summary Link:</p>
                  <code className="text-sm text-gray-600 break-all">
                    {getSummaryLink(team)}
                  </code>
                </div>
              </div>

              <div className="border-t pt-4">
                <h4 className="font-medium mb-3">Games</h4>
                <div className="space-y-2">
                  {games.map((game) => (
                    <div
                      key={game.id}
                      className={`flex justify-between items-center py-2 border-b ${
                        game.is_closed ? 'bg-gray-50' : ''
                      }`}
                    >
                      <span className="flex items-center gap-2 flex-1 min-w-0">
                        {game.is_closed && (
                          <svg
                            className="h-4 w-4 text-gray-500 flex-shrink-0"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"
                            />
                          </svg>
                        )}
                        <span className={game.is_closed ? 'text-gray-500' : ''}>
                          <span className="font-medium">{formatDate(game.game_date)}</span>
                          {game.game_time && (
                            <span className="text-gray-500 text-sm ml-1">
                              @ {formatTime(game.game_time)}{' '}
                              {getTimezoneAbbr(game.timezone)}
                            </span>
                          )}
                          <span className="text-gray-600"> {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}</span>
                        </span>
                        {(() => {
                          const r = gameResult(game)
                          return r.label ? (
                            <span
                              className={`text-xs font-bold px-2 py-0.5 rounded ${r.color}`}
                            >
                              {r.label} {r.score}
                            </span>
                          ) : null
                        })()}
                        {game.is_closed && (
                          <span className="text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">
                            Closed
                          </span>
                        )}
                      </span>
                      <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
                        <ScoreInput
                          ourScore={game.our_score}
                          opponentScore={game.opponent_score}
                          onSave={(o, p) => handleSaveScore(game.id, o, p)}
                          compact
                        />
                        <button
                          onClick={() => toggleGameClosed(game)}
                          className={`text-sm px-3 py-2 rounded ${
                            game.is_closed
                              ? 'text-green-600 hover:text-green-800 hover:bg-green-50'
                              : 'text-orange-600 hover:text-orange-800 hover:bg-orange-50'
                          }`}
                        >
                          {game.is_closed ? 'Reopen' : 'Close'}
                        </button>
                        <button
                          onClick={() => handleEditGame(game)}
                          className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 text-sm px-3 py-2 rounded"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDeleteGame(game.id)}
                          className="text-red-600 hover:text-red-800 hover:bg-red-50 text-sm px-3 py-2 rounded"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
