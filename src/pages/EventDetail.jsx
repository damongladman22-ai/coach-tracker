import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function EventDetail({ session }) {
  const { eventId } = useParams()
  const [event, setEvent] = useState(null)
  const [eventTeams, setEventTeams] = useState([])
  const [availableTeams, setAvailableTeams] = useState([])
  const [games, setGames] = useState({})
  const [loading, setLoading] = useState(true)
  const [selectedTeam, setSelectedTeam] = useState('')
  const [showGameForm, setShowGameForm] = useState(null)
  const [editingGame, setEditingGame] = useState(null)
  const [gameFormData, setGameFormData] = useState({ game_date: '', opponent: '' })
  const [exporting, setExporting] = useState(null)
  const [copiedLink, setCopiedLink] = useState(null)

  useEffect(() => {
    fetchData()
  }, [eventId])

  const fetchData = async () => {
    // Fetch event
    const { data: eventData } = await supabase
      .from('events')
      .select('*')
      .eq('id', eventId)
      .single()
    
    setEvent(eventData)

    // Fetch event teams with club team details
    const { data: eventTeamsData } = await supabase
      .from('event_teams')
      .select('*, club_teams(*)')
      .eq('event_id', eventId)
    
    setEventTeams(eventTeamsData || [])

    // Fetch all club teams for dropdown
    const { data: allTeams } = await supabase
      .from('club_teams')
      .select('*')
      .order('team_name')
    
    setAvailableTeams(allTeams || [])

    // Fetch games for each event team
    if (eventTeamsData?.length > 0) {
      const gamesByTeam = {}
      for (const et of eventTeamsData) {
        const { data: gamesData } = await supabase
          .from('games')
          .select('*')
          .eq('event_team_id', et.id)
          .order('game_date')
        gamesByTeam[et.id] = gamesData || []
      }
      setGames(gamesByTeam)
    }

    setLoading(false)
  }

  const generateSlug = (name) => {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const addTeamToEvent = async () => {
    if (!selectedTeam) return

    const team = availableTeams.find(t => t.id === selectedTeam)
    const slug = generateSlug(team.team_name)

    const { error } = await supabase
      .from('event_teams')
      .insert([{ 
        event_id: eventId, 
        club_team_id: selectedTeam,
        slug 
      }])
    
    if (!error) {
      setSelectedTeam('')
      fetchData()
    }
  }

  const removeTeamFromEvent = async (eventTeamId) => {
    if (!confirm('Remove this team from the event? This will also delete all games and attendance records.')) return

    const { error } = await supabase
      .from('event_teams')
      .delete()
      .eq('id', eventTeamId)
    
    if (!error) fetchData()
  }

  const addGame = async (eventTeamId) => {
    const { error } = await supabase
      .from('games')
      .insert([{ 
        event_team_id: eventTeamId,
        game_date: gameFormData.game_date,
        opponent: gameFormData.opponent
      }])
    
    if (!error) {
      setShowGameForm(null)
      setGameFormData({ game_date: '', opponent: '' })
      fetchData()
    }
  }

  const updateGame = async () => {
    const { error } = await supabase
      .from('games')
      .update({ 
        game_date: gameFormData.game_date,
        opponent: gameFormData.opponent
      })
      .eq('id', editingGame.id)
    
    if (!error) {
      setEditingGame(null)
      setShowGameForm(null)
      setGameFormData({ game_date: '', opponent: '' })
      fetchData()
    }
  }

  const handleEditGame = (game, eventTeamId) => {
    setEditingGame(game)
    setGameFormData({ game_date: game.game_date, opponent: game.opponent })
    setShowGameForm(eventTeamId)
  }

  const deleteGame = async (gameId) => {
    if (!confirm('Delete this game? This will also delete all attendance records.')) return

    const { error } = await supabase
      .from('games')
      .delete()
      .eq('id', gameId)
    
    if (!error) fetchData()
  }

  const getShareableLink = (eventTeam) => {
    const baseUrl = window.location.origin
    return `${baseUrl}/e/${event.slug}/${eventTeam.slug}`
  }

  const getSummaryLink = (eventTeam) => {
    const baseUrl = window.location.origin
    return `${baseUrl}/e/${event.slug}/${eventTeam.slug}/summary`
  }

  const copyLink = (eventTeam) => {
    navigator.clipboard.writeText(getShareableLink(eventTeam))
    setCopiedLink(`tracker-${eventTeam.id}`)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const copySummaryLink = (eventTeam) => {
    navigator.clipboard.writeText(getSummaryLink(eventTeam))
    setCopiedLink(`summary-${eventTeam.id}`)
    setTimeout(() => setCopiedLink(null), 2000)
  }

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }

  const formatDateShort = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric'
    })
  }

  const exportToCSV = async (eventTeam) => {
    setExporting(eventTeam.id)
    
    try {
      // Get games for this team
      const teamGames = games[eventTeam.id] || []
      if (teamGames.length === 0) {
        alert('No games to export')
        setExporting(null)
        return
      }

      // Fetch all attendance with coach and school details
      const gameIds = teamGames.map(g => g.id)
      const { data: attendanceData } = await supabase
        .from('attendance')
        .select('*, coaches(*, schools(*))')
        .in('game_id', gameIds)

      if (!attendanceData || attendanceData.length === 0) {
        alert('No attendance data to export')
        setExporting(null)
        return
      }

      // Build pivot data: group by school, then by game
      const schoolData = {}
      attendanceData.forEach(record => {
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
            games: {}
          }
        }

        // Add coach email if present
        if (coach.email) {
          schoolData[school.id].emails.add(coach.email)
        }

        const gameId = record.game_id
        if (!schoolData[school.id].games[gameId]) {
          schoolData[school.id].games[gameId] = []
        }
        schoolData[school.id].games[gameId].push(`${coach.first_name} ${coach.last_name}`)
      })

      // Create CSV header
      const gameHeaders = teamGames.map(g => `${formatDateShort(g.game_date)} vs ${g.opponent}`)
      const headers = ['College', 'Division', 'Conference', 'State', 'Email(s)', ...gameHeaders]

      // Create CSV rows
      const rows = Object.values(schoolData)
        .sort((a, b) => a.school.localeCompare(b.school))
        .map(data => {
          const row = [
            `"${data.school}"`,
            `"${data.division}"`,
            `"${data.conference}"`,
            `"${data.state}"`,
            `"${[...data.emails].join('; ')}"`
          ]
          teamGames.forEach(game => {
            const coaches = data.games[game.id] || []
            row.push(`"${coaches.join(', ')}"`)
          })
          return row.join(',')
        })

      // Combine into CSV content
      const csvContent = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n')

      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = `${event.event_name} - ${eventTeam.club_teams.team_name}.csv`
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

  const assignedTeamIds = eventTeams.map(et => et.club_team_id)
  const unassignedTeams = availableTeams.filter(t => !assignedTeamIds.includes(t.id))

  if (loading) {
    return (
      <AdminLayout session={session} title="Loading...">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title={event?.event_name}>
      <Link to="/admin/events" className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
        ← Back to Events
      </Link>

      {/* Add Team Section */}
      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Add Team to Event</h2>
        <div className="flex space-x-3">
          <select
            value={selectedTeam}
            onChange={(e) => setSelectedTeam(e.target.value)}
            className="flex-1 px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">Select a team...</option>
            {unassignedTeams.map(team => (
              <option key={team.id} value={team.id}>
                {team.team_name} ({team.gender})
              </option>
            ))}
          </select>
          <button
            onClick={addTeamToEvent}
            disabled={!selectedTeam}
            className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
          >
            Add Team
          </button>
        </div>
        {unassignedTeams.length === 0 && (
          <p className="text-sm text-gray-500 mt-2">
            All teams are already added to this event. 
            <Link to="/admin/teams" className="text-blue-600 hover:underline ml-1">
              Create a new team
            </Link>
          </p>
        )}
      </div>

      {/* Teams and Games */}
      {eventTeams.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No teams added to this event yet. Add a team above.
        </div>
      ) : (
        <div className="space-y-6">
          {eventTeams.map((eventTeam) => (
            <div key={eventTeam.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start mb-4">
                <div>
                  <h3 className="text-xl font-semibold">{eventTeam.club_teams.team_name}</h3>
                  <p className="text-gray-500">{eventTeam.club_teams.gender}</p>
                </div>
                <div className="flex space-x-2">
                  <Link
                    to={`/admin/events/${eventId}/matrix/${eventTeam.id}`}
                    className="bg-purple-100 text-purple-700 px-3 py-1 rounded text-sm hover:bg-purple-200"
                  >
                    Attendance Matrix
                  </Link>
                  <button
                    onClick={() => exportToCSV(eventTeam)}
                    disabled={exporting === eventTeam.id}
                    className="bg-blue-100 text-blue-700 px-3 py-1 rounded text-sm hover:bg-blue-200 disabled:bg-gray-100 disabled:text-gray-400"
                  >
                    {exporting === eventTeam.id ? 'Exporting...' : 'Export CSV'}
                  </button>
                  <button
                    onClick={() => copyLink(eventTeam)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      copiedLink === `tracker-${eventTeam.id}`
                        ? 'bg-green-500 text-white'
                        : 'bg-cyan-100 text-cyan-700 hover:bg-cyan-200'
                    }`}
                  >
                    {copiedLink === `tracker-${eventTeam.id}` ? '✓ Copied!' : 'Copy Tracker Link'}
                  </button>
                  <button
                    onClick={() => copySummaryLink(eventTeam)}
                    className={`px-3 py-1 rounded text-sm transition-colors ${
                      copiedLink === `summary-${eventTeam.id}`
                        ? 'bg-green-500 text-white'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {copiedLink === `summary-${eventTeam.id}` ? '✓ Copied!' : 'Copy Summary Link'}
                  </button>
                  <button
                    onClick={() => removeTeamFromEvent(eventTeam.id)}
                    className="text-red-600 hover:text-red-800 text-sm"
                  >
                    Remove
                  </button>
                </div>
              </div>

              {/* Shareable Links */}
              <div className="bg-gray-50 rounded p-3 mb-4 space-y-2">
                <div>
                  <p className="text-xs text-gray-500 mb-1">Tracker Link (for team group chat):</p>
                  <code className="text-sm text-cyan-600 break-all">{getShareableLink(eventTeam)}</code>
                </div>
                <div>
                  <p className="text-xs text-gray-500 mb-1">Summary Link (read-only view):</p>
                  <code className="text-sm text-gray-600 break-all">{getSummaryLink(eventTeam)}</code>
                </div>
              </div>

              {/* Games */}
              <div className="border-t pt-4">
                <div className="flex justify-between items-center mb-3">
                  <h4 className="font-medium">Games</h4>
                  <button
                    onClick={() => {
                      setEditingGame(null)
                      setGameFormData({ game_date: '', opponent: '' })
                      setShowGameForm(eventTeam.id)
                    }}
                    className="text-blue-600 hover:text-blue-800 text-sm"
                  >
                    + Add Game
                  </button>
                </div>

                {showGameForm === eventTeam.id && (
                  <div className="bg-gray-50 rounded p-4 mb-4">
                    <h4 className="font-medium mb-3">{editingGame ? 'Edit Game' : 'Add Game'}</h4>
                    <div className="grid grid-cols-2 gap-4 mb-3">
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Date</label>
                        <input
                          type="date"
                          value={gameFormData.game_date}
                          onChange={(e) => setGameFormData({ ...gameFormData, game_date: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div>
                        <label className="block text-sm text-gray-600 mb-1">Opponent</label>
                        <input
                          type="text"
                          value={gameFormData.opponent}
                          onChange={(e) => setGameFormData({ ...gameFormData, opponent: e.target.value })}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                          placeholder="e.g., ABC Soccer Club"
                        />
                      </div>
                    </div>
                    <div className="flex space-x-2">
                      <button
                        onClick={() => editingGame ? updateGame() : addGame(eventTeam.id)}
                        className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                      >
                        {editingGame ? 'Update Game' : 'Add Game'}
                      </button>
                      <button
                        onClick={() => {
                          setShowGameForm(null)
                          setEditingGame(null)
                          setGameFormData({ game_date: '', opponent: '' })
                        }}
                        className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm hover:bg-gray-300"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {games[eventTeam.id]?.length > 0 ? (
                  <div className="space-y-2">
                    {games[eventTeam.id].map((game) => (
                      <div key={game.id} className="flex justify-between items-center py-2 border-b">
                        <span>
                          <span className="font-medium">{formatDate(game.game_date)}</span>
                          <span className="text-gray-600"> vs {game.opponent}</span>
                        </span>
                        <div className="space-x-2">
                          <button
                            onClick={() => handleEditGame(game, eventTeam.id)}
                            className="text-blue-600 hover:text-blue-800 text-sm"
                          >
                            Edit
                          </button>
                          <button
                            onClick={() => deleteGame(game.id)}
                            className="text-red-600 hover:text-red-800 text-sm"
                          >
                            Delete
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-gray-500 text-sm">No games scheduled yet.</p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
