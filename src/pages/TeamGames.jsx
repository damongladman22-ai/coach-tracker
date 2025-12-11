import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function TeamGames() {
  const { eventSlug, teamSlug } = useParams()
  const [event, setEvent] = useState(null)
  const [eventTeam, setEventTeam] = useState(null)
  const [games, setGames] = useState([])
  const [attendance, setAttendance] = useState({})
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState('games') // 'games' or 'colleges'
  const [error, setError] = useState(null)

  useEffect(() => {
    fetchData()
  }, [eventSlug, teamSlug])

  const fetchData = async () => {
    try {
      // Fetch event by slug
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('slug', eventSlug)
        .single()
      
      if (eventError || !eventData) {
        setError('Event not found')
        setLoading(false)
        return
      }
      setEvent(eventData)

      // Fetch event_team by slug and event_id
      const { data: eventTeamData, error: etError } = await supabase
        .from('event_teams')
        .select('*, club_teams(*)')
        .eq('event_id', eventData.id)
        .eq('slug', teamSlug)
        .single()
      
      if (etError || !eventTeamData) {
        setError('Team not found for this event')
        setLoading(false)
        return
      }
      setEventTeam(eventTeamData)

      // Fetch games
      const { data: gamesData } = await supabase
        .from('games')
        .select('*')
        .eq('event_team_id', eventTeamData.id)
        .order('game_date')
      
      setGames(gamesData || [])

      // Fetch attendance with coach and school details
      if (gamesData?.length > 0) {
        const gameIds = gamesData.map(g => g.id)
        const { data: attendanceData } = await supabase
          .from('attendance')
          .select('*, coaches(*, schools(*))')
          .in('game_id', gameIds)
        
        // Group by game
        const attendanceByGame = {}
        attendanceData?.forEach(a => {
          if (!attendanceByGame[a.game_id]) {
            attendanceByGame[a.game_id] = []
          }
          attendanceByGame[a.game_id].push(a)
        })
        setAttendance(attendanceByGame)
      }

      setLoading(false)
    } catch (err) {
      setError('Error loading data')
      setLoading(false)
    }
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    })
  }

  // Group attendance by college for college-centric view
  const getCollegeView = () => {
    const colleges = {}
    
    Object.entries(attendance).forEach(([gameId, records]) => {
      const game = games.find(g => g.id === gameId)
      records.forEach(record => {
        const school = record.coaches?.schools
        const coach = record.coaches
        if (!school || !coach) return

        if (!colleges[school.id]) {
          colleges[school.id] = {
            school,
            coaches: {}
          }
        }

        if (!colleges[school.id].coaches[coach.id]) {
          colleges[school.id].coaches[coach.id] = {
            coach,
            games: []
          }
        }

        colleges[school.id].coaches[coach.id].games.push(game)
      })
    })

    return Object.values(colleges).sort((a, b) => 
      a.school.school.localeCompare(b.school.school)
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 text-center">
          <h1 className="text-xl font-bold text-red-600 mb-2">Error</h1>
          <p className="text-gray-600">{error}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4">
        <h1 className="text-xl font-bold">{eventTeam?.club_teams?.team_name}</h1>
        <p className="text-blue-100">{event?.event_name}</p>
      </header>

      {/* View Toggle */}
      <div className="bg-white border-b p-2 flex">
        <button
          onClick={() => setViewMode('games')}
          className={`flex-1 py-2 text-center rounded-lg mx-1 ${
            viewMode === 'games' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-100 text-gray-700'
          }`}
        >
          By Game
        </button>
        <button
          onClick={() => setViewMode('colleges')}
          className={`flex-1 py-2 text-center rounded-lg mx-1 ${
            viewMode === 'colleges' 
              ? 'bg-blue-600 text-white' 
              : 'bg-gray-100 text-gray-700'
          }`}
        >
          By College
        </button>
      </div>

      {/* Content */}
      <main className="p-4">
        {games.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            No games scheduled yet.
          </div>
        ) : viewMode === 'games' ? (
          /* Game-Centric View */
          <div className="space-y-4">
            {games.map((game) => (
              <div key={game.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                <Link 
                  to={`/e/${eventSlug}/${teamSlug}/game/${game.id}`}
                  className="block p-4 hover:bg-gray-50"
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <h3 className="font-semibold text-lg">
                        {formatDate(game.game_date)} vs {game.opponent}
                      </h3>
                      <p className="text-sm text-gray-500 mt-1">
                        {attendance[game.id]?.length || 0} coaches logged
                      </p>
                    </div>
                    <span className="text-blue-600 text-2xl">→</span>
                  </div>
                </Link>
                
                {/* Show attendance summary */}
                {attendance[game.id]?.length > 0 && (
                  <div className="border-t px-4 py-3 bg-gray-50">
                    {Object.values(
                      attendance[game.id].reduce((acc, record) => {
                        const schoolId = record.coaches?.schools?.id
                        if (!schoolId) return acc
                        if (!acc[schoolId]) {
                          acc[schoolId] = {
                            school: record.coaches.schools,
                            coaches: []
                          }
                        }
                        acc[schoolId].coaches.push(record.coaches)
                        return acc
                      }, {})
                    ).map(({ school, coaches }) => (
                      <div key={school.id} className="text-sm py-1">
                        <span className="font-medium">{school.school}</span>
                        <span className="text-gray-600">
                          {' — '}{coaches.map(c => `${c.first_name} ${c.last_name}`).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          /* College-Centric View */
          <div className="space-y-4">
            {getCollegeView().length === 0 ? (
              <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
                No college coaches logged yet.
              </div>
            ) : (
              getCollegeView().map(({ school, coaches }) => (
                <div key={school.id} className="bg-white rounded-lg shadow-md p-4">
                  <h3 className="font-semibold text-lg">{school.school}</h3>
                  <p className="text-sm text-gray-500">
                    {school.division} • {school.conference}
                  </p>
                  <div className="mt-3 space-y-2">
                    {Object.values(coaches).map(({ coach, games: coachGames }) => (
                      <div key={coach.id} className="text-sm">
                        <span className="font-medium">{coach.first_name} {coach.last_name}</span>
                        <span className="text-gray-600">
                          {' — '}{coachGames.map(g => formatDate(g.game_date)).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>
    </div>
  )
}
