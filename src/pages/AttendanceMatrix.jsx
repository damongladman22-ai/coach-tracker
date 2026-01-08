import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { SchoolSearch } from '../components/SchoolSearch'

export default function AttendanceMatrix({ session }) {
  const { eventId, eventTeamId } = useParams()
  const [event, setEvent] = useState(null)
  const [eventTeam, setEventTeam] = useState(null)
  const [games, setGames] = useState([])
  const [coaches, setCoaches] = useState([])
  const [attendance, setAttendance] = useState({}) // { `${coachId}-${gameId}`: attendanceId }
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(null) // tracks which cell is saving
  const [showAddCoach, setShowAddCoach] = useState(false)
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [schoolCoaches, setSchoolCoaches] = useState([])
  const [newCoach, setNewCoach] = useState({ first_name: '', last_name: '' })
  const [showNewCoachForm, setShowNewCoachForm] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    fetchData()
  }, [eventId, eventTeamId])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchData = async () => {
    try {
      // Fetch event
      const { data: eventData } = await supabase
        .from('events')
        .select('*')
        .eq('id', eventId)
        .single()
      setEvent(eventData)

      // Fetch event team with club team info
      const { data: eventTeamData } = await supabase
        .from('event_teams')
        .select('*, club_teams(*)')
        .eq('id', eventTeamId)
        .single()
      setEventTeam(eventTeamData)

      // Fetch games for this event team
      const { data: gamesData } = await supabase
        .from('games')
        .select('*')
        .eq('event_team_id', eventTeamId)
        .order('game_date')
      setGames(gamesData || [])

      // Fetch all attendance for these games with coach and school info
      if (gamesData?.length > 0) {
        const gameIds = gamesData.map(g => g.id)
        const { data: attendanceData } = await supabase
          .from('attendance')
          .select('*, coaches(*, schools(*))')
          .in('game_id', gameIds)

        // Build attendance map and unique coaches list
        const attendanceMap = {}
        const coachesMap = {}
        
        ;(attendanceData || []).forEach(record => {
          if (record.coaches) {
            const key = `${record.coach_id}-${record.game_id}`
            attendanceMap[key] = record.id
            
            // Add coach to map if not already there
            if (!coachesMap[record.coach_id]) {
              coachesMap[record.coach_id] = {
                ...record.coaches,
                school: record.coaches.schools
              }
            }
          }
        })

        setAttendance(attendanceMap)
        
        // Sort coaches by school name, then last name
        const coachesList = Object.values(coachesMap).sort((a, b) => {
          const schoolCompare = (a.school?.school || '').localeCompare(b.school?.school || '')
          if (schoolCompare !== 0) return schoolCompare
          return a.last_name.localeCompare(b.last_name)
        })
        setCoaches(coachesList)
      }
    } catch (err) {
      console.error('Error fetching data:', err)
    } finally {
      setLoading(false)
    }
  }

  const toggleAttendance = async (coachId, gameId) => {
    const key = `${coachId}-${gameId}`
    const existingId = attendance[key]
    
    setSaving(key)
    
    try {
      if (existingId) {
        // Remove attendance
        const { error } = await supabase
          .from('attendance')
          .delete()
          .eq('id', existingId)
        
        if (error) throw error
        
        setAttendance(prev => {
          const updated = { ...prev }
          delete updated[key]
          return updated
        })
      } else {
        // Add attendance
        const { data, error } = await supabase
          .from('attendance')
          .insert([{ game_id: gameId, coach_id: coachId }])
          .select()
          .single()
        
        if (error) throw error
        
        setAttendance(prev => ({
          ...prev,
          [key]: data.id
        }))
      }
    } catch (err) {
      console.error('Error toggling attendance:', err)
      showToast('Error updating attendance', 'error')
    } finally {
      setSaving(null)
    }
  }

  const handleSchoolSelect = async (school) => {
    setSelectedSchool(school)
    if (school) {
      // Fetch coaches for this school
      const { data } = await supabase
        .from('coaches')
        .select('*')
        .eq('school_id', school.id)
        .order('last_name')
      setSchoolCoaches(data || [])
    } else {
      setSchoolCoaches([])
    }
  }

  const addCoachToMatrix = async (coach) => {
    // Check if coach is already in the matrix
    if (coaches.find(c => c.id === coach.id)) {
      showToast('Coach is already in the matrix', 'error')
      return
    }

    // Add coach to the matrix (will show with no games checked)
    setCoaches(prev => {
      const updated = [...prev, { ...coach, school: selectedSchool }]
      return updated.sort((a, b) => {
        const schoolCompare = (a.school?.school || '').localeCompare(b.school?.school || '')
        if (schoolCompare !== 0) return schoolCompare
        return a.last_name.localeCompare(b.last_name)
      })
    })

    showToast(`Added ${coach.first_name} ${coach.last_name}`)
  }

  const createAndAddCoach = async () => {
    if (!newCoach.first_name || !newCoach.last_name || !selectedSchool) return

    try {
      const { data, error } = await supabase
        .from('coaches')
        .insert([{
          first_name: newCoach.first_name,
          last_name: newCoach.last_name,
          school_id: selectedSchool.id
        }])
        .select()
        .single()

      if (error) throw error

      // Add to school coaches list
      setSchoolCoaches(prev => [...prev, data].sort((a, b) => a.last_name.localeCompare(b.last_name)))
      
      // Add to matrix
      setCoaches(prev => {
        const updated = [...prev, { ...data, school: selectedSchool }]
        return updated.sort((a, b) => {
          const schoolCompare = (a.school?.school || '').localeCompare(b.school?.school || '')
          if (schoolCompare !== 0) return schoolCompare
          return a.last_name.localeCompare(b.last_name)
        })
      })

      setNewCoach({ first_name: '', last_name: '' })
      setShowNewCoachForm(false)
      showToast(`Created and added ${data.first_name} ${data.last_name}`)
    } catch (err) {
      console.error('Error creating coach:', err)
      showToast('Error creating coach', 'error')
    }
  }

  const removeCoachFromMatrix = (coachId) => {
    // Only remove from view if they have no attendance records
    const hasAttendance = Object.keys(attendance).some(key => key.startsWith(`${coachId}-`))
    if (hasAttendance) {
      showToast('Remove attendance records first', 'error')
      return
    }
    setCoaches(prev => prev.filter(c => c.id !== coachId))
  }

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric'
    })
  }

  const getGameLabel = (game) => {
    return `${formatDate(game.game_date)} vs ${game.opponent}`
  }

  if (loading) {
    return (
      <AdminLayout session={session} title="Loading...">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title="Attendance Matrix">
      {/* Toast notification */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg ${
          toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'
        } text-white`}>
          {toast.message}
        </div>
      )}

      <Link to={`/admin/events/${eventId}`} className="text-blue-600 hover:text-blue-800 mb-4 inline-block">
        ← Back to Event
      </Link>

      <div className="bg-white rounded-lg shadow-md p-6 mb-6">
        <h2 className="text-xl font-semibold mb-1">{eventTeam?.club_teams?.team_name}</h2>
        <p className="text-gray-500 mb-4">{event?.event_name}</p>

        {games.length === 0 ? (
          <div className="text-center py-8 text-gray-500">
            No games scheduled. <Link to={`/admin/events/${eventId}`} className="text-blue-600">Add games first</Link>.
          </div>
        ) : coaches.length === 0 && !showAddCoach ? (
          <div className="text-center py-8">
            <p className="text-gray-500 mb-4">No coaches logged yet.</p>
            <button
              onClick={() => setShowAddCoach(true)}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
            >
              + Add Coach to Matrix
            </button>
          </div>
        ) : (
          <>
            {/* Add Coach Button */}
            <div className="mb-4">
              <button
                onClick={() => setShowAddCoach(!showAddCoach)}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {showAddCoach ? 'Close' : '+ Add Coach to Matrix'}
              </button>
            </div>

            {/* Add Coach Panel */}
            {showAddCoach && (
              <div className="bg-gray-50 rounded-lg p-4 mb-6">
                <h3 className="font-medium mb-3">Add Coach to Matrix</h3>
                
                <div className="mb-4">
                  <label className="block text-sm text-gray-600 mb-1">Search for School</label>
                  <SchoolSearch 
                    selectedSchool={selectedSchool} 
                    onSelect={handleSchoolSelect} 
                  />
                </div>

                {selectedSchool && (
                  <>
                    {schoolCoaches.length > 0 && (
                      <div className="mb-4">
                        <label className="block text-sm text-gray-600 mb-2">Select Coach from {selectedSchool.school}</label>
                        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                          {schoolCoaches.map(coach => {
                            const inMatrix = coaches.find(c => c.id === coach.id)
                            return (
                              <button
                                key={coach.id}
                                onClick={() => addCoachToMatrix(coach)}
                                disabled={inMatrix}
                                className={`text-left p-2 rounded border ${
                                  inMatrix 
                                    ? 'bg-gray-100 text-gray-400 border-gray-200 cursor-not-allowed'
                                    : 'bg-white border-gray-300 hover:bg-blue-50 hover:border-blue-300'
                                }`}
                              >
                                {coach.first_name} {coach.last_name}
                                {inMatrix && <span className="text-xs ml-1">(added)</span>}
                              </button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {/* Create New Coach */}
                    {showNewCoachForm ? (
                      <div className="bg-white rounded p-3 border">
                        <h4 className="font-medium mb-2">Create New Coach for {selectedSchool.school}</h4>
                        <div className="grid grid-cols-2 gap-2 mb-2">
                          <input
                            type="text"
                            value={newCoach.first_name}
                            onChange={(e) => setNewCoach({ ...newCoach, first_name: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded"
                            placeholder="First name"
                          />
                          <input
                            type="text"
                            value={newCoach.last_name}
                            onChange={(e) => setNewCoach({ ...newCoach, last_name: e.target.value })}
                            className="px-3 py-2 border border-gray-300 rounded"
                            placeholder="Last name"
                          />
                        </div>
                        <div className="flex gap-2">
                          <button
                            onClick={createAndAddCoach}
                            className="bg-green-600 text-white px-3 py-1 rounded hover:bg-green-700"
                          >
                            Create & Add
                          </button>
                          <button
                            onClick={() => {
                              setShowNewCoachForm(false)
                              setNewCoach({ first_name: '', last_name: '' })
                            }}
                            className="bg-gray-200 text-gray-700 px-3 py-1 rounded hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowNewCoachForm(true)}
                        className="text-blue-600 hover:text-blue-800"
                      >
                        + Create new coach for {selectedSchool.school}
                      </button>
                    )}
                  </>
                )}
              </div>
            )}

            {/* Matrix Table */}
            {coaches.length > 0 && (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="bg-gray-100">
                      <th className="border p-2 text-left sticky left-0 bg-gray-100 min-w-[200px]">
                        Coach
                      </th>
                      {games.map(game => (
                        <th key={game.id} className="border p-2 text-center min-w-[100px]">
                          <div className="text-xs font-normal text-gray-500">{formatDate(game.game_date)}</div>
                          <div className="text-sm truncate" title={game.opponent}>{game.opponent}</div>
                        </th>
                      ))}
                      <th className="border p-2 w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {coaches.map((coach, idx) => {
                      // Check if this is the first coach from a new school
                      const isNewSchool = idx === 0 || coaches[idx - 1].school?.id !== coach.school?.id
                      const hasAttendance = Object.keys(attendance).some(key => key.startsWith(`${coach.id}-`))
                      
                      return (
                        <>
                          {/* School separator row */}
                          {isNewSchool && (
                            <tr key={`school-${coach.school?.id || idx}`} className="bg-blue-50">
                              <td colSpan={games.length + 2} className="border p-2 font-medium text-blue-800">
                                {coach.school?.school || 'Unknown School'}
                                <span className="text-xs font-normal text-blue-600 ml-2">
                                  {coach.school?.division} • {coach.school?.conference}
                                </span>
                              </td>
                            </tr>
                          )}
                          <tr key={coach.id} className="hover:bg-gray-50">
                            <td className="border p-2 sticky left-0 bg-white">
                              <span className="font-medium">{coach.first_name} {coach.last_name}</span>
                            </td>
                            {games.map(game => {
                              const key = `${coach.id}-${game.id}`
                              const isChecked = !!attendance[key]
                              const isSaving = saving === key
                              
                              return (
                                <td key={game.id} className="border p-2 text-center">
                                  <button
                                    onClick={() => toggleAttendance(coach.id, game.id)}
                                    disabled={isSaving}
                                    className={`w-8 h-8 rounded border-2 flex items-center justify-center mx-auto transition-colors ${
                                      isSaving 
                                        ? 'bg-gray-100 border-gray-300 cursor-wait'
                                        : isChecked
                                          ? 'bg-green-500 border-green-600 text-white hover:bg-green-600'
                                          : 'bg-white border-gray-300 hover:border-blue-400 hover:bg-blue-50'
                                    }`}
                                  >
                                    {isSaving ? (
                                      <svg className="w-4 h-4 animate-spin text-gray-400" fill="none" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                      </svg>
                                    ) : isChecked ? (
                                      <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                                      </svg>
                                    ) : null}
                                  </button>
                                </td>
                              )
                            })}
                            <td className="border p-2 text-center">
                              {!hasAttendance && (
                                <button
                                  onClick={() => removeCoachFromMatrix(coach.id)}
                                  className="text-red-500 hover:text-red-700 text-xs"
                                  title="Remove from matrix"
                                >
                                  ✕
                                </button>
                              )}
                            </td>
                          </tr>
                        </>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Legend */}
            <div className="mt-4 flex items-center gap-4 text-sm text-gray-500">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded border-2 border-gray-300 bg-white"></div>
                <span>Not attended</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded border-2 border-green-600 bg-green-500 flex items-center justify-center">
                  <svg className="w-4 h-4 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <span>Attended</span>
              </div>
              <div className="text-gray-400">
                Click checkboxes to toggle • Changes save automatically
              </div>
            </div>
          </>
        )}
      </div>
    </AdminLayout>
  )
}
