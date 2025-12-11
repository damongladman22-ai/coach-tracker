import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function GameAttendance() {
  const { eventSlug, teamSlug, gameId } = useParams()
  const [game, setGame] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [schools, setSchools] = useState([])
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [coaches, setCoaches] = useState([])
  const [selectedCoaches, setSelectedCoaches] = useState([])
  const [showAddCoachForm, setShowAddCoachForm] = useState(false)
  const [newCoach, setNewCoach] = useState({ first_name: '', last_name: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchGameData()
  }, [gameId])

  const fetchGameData = async () => {
    // Fetch game
    const { data: gameData } = await supabase
      .from('games')
      .select('*')
      .eq('id', gameId)
      .single()
    
    setGame(gameData)

    // Fetch attendance
    await fetchAttendance()
    
    setLoading(false)
  }

  const fetchAttendance = async () => {
    const { data: attendanceData } = await supabase
      .from('attendance')
      .select('*, coaches(*, schools(*))')
      .eq('game_id', gameId)
    
    setAttendance(attendanceData || [])
  }

  const searchSchools = async (term) => {
    if (term.length < 2) {
      setSchools([])
      return
    }

    const { data } = await supabase
      .from('schools')
      .select('*')
      .ilike('school', `%${term}%`)
      .limit(20)
    
    setSchools(data || [])
  }

  const selectSchool = async (school) => {
    setSelectedSchool(school)
    setSearchTerm(school.school)
    setSchools([])
    
    // Fetch coaches for this school
    const { data } = await supabase
      .from('coaches')
      .select('*')
      .eq('school_id', school.id)
      .order('last_name')
    
    setCoaches(data || [])
  }

  const toggleCoach = (coachId) => {
    setSelectedCoaches(prev => 
      prev.includes(coachId) 
        ? prev.filter(id => id !== coachId)
        : [...prev, coachId]
    )
  }

  const addNewCoach = async () => {
    if (!newCoach.first_name || !newCoach.last_name || !selectedSchool) return

    const { data, error } = await supabase
      .from('coaches')
      .insert([{ 
        first_name: newCoach.first_name,
        last_name: newCoach.last_name,
        school_id: selectedSchool.id
      }])
      .select()
      .single()
    
    if (!error && data) {
      setCoaches(prev => [...prev, data].sort((a, b) => a.last_name.localeCompare(b.last_name)))
      setSelectedCoaches(prev => [...prev, data.id])
      setNewCoach({ first_name: '', last_name: '' })
      setShowAddCoachForm(false)
    }
  }

  const saveAttendance = async () => {
    if (selectedCoaches.length === 0) return

    setSaving(true)

    // Insert attendance records
    const records = selectedCoaches.map(coachId => ({
      game_id: gameId,
      coach_id: coachId
    }))

    // Use upsert to avoid duplicates
    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'game_id,coach_id' })
    
    if (!error) {
      await fetchAttendance()
      closeModal()
    }

    setSaving(false)
  }

  const deleteAttendance = async (attendanceId) => {
    if (!confirm('Remove this coach from the attendance list?')) return

    const { error } = await supabase
      .from('attendance')
      .delete()
      .eq('id', attendanceId)
    
    if (!error) {
      fetchAttendance()
    }
  }

  const closeModal = () => {
    setShowAddModal(false)
    setSearchTerm('')
    setSelectedSchool(null)
    setSchools([])
    setCoaches([])
    setSelectedCoaches([])
    setShowAddCoachForm(false)
    setNewCoach({ first_name: '', last_name: '' })
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

  // Group attendance by school
  const getAttendanceBySchool = () => {
    const bySchool = {}
    attendance.forEach(record => {
      const schoolId = record.coaches?.schools?.id
      if (!schoolId) return
      if (!bySchool[schoolId]) {
        bySchool[schoolId] = {
          school: record.coaches.schools,
          records: []
        }
      }
      bySchool[schoolId].records.push(record)
    })
    return Object.values(bySchool).sort((a, b) => 
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

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-blue-600 text-white p-4">
        <Link 
          to={`/e/${eventSlug}/${teamSlug}`}
          className="text-blue-100 text-sm mb-2 inline-block"
        >
          ← Back to Games
        </Link>
        <h1 className="text-xl font-bold">
          {game && `${formatDate(game.game_date)} vs ${game.opponent}`}
        </h1>
      </header>

      {/* Add Button */}
      <div className="p-4">
        <button
          onClick={() => setShowAddModal(true)}
          className="w-full bg-green-600 text-white py-4 rounded-lg text-lg font-semibold hover:bg-green-700 active:bg-green-800"
        >
          + Add College Coaches
        </button>
      </div>

      {/* Attendance List */}
      <main className="px-4 pb-4">
        {attendance.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
            No coaches logged yet. Tap the button above to add coaches.
          </div>
        ) : (
          <div className="space-y-4">
            {getAttendanceBySchool().map(({ school, records }) => (
              <div key={school.id} className="bg-white rounded-lg shadow-md p-4">
                <h3 className="font-semibold">{school.school}</h3>
                <p className="text-xs text-gray-500 mb-2">
                  {school.division} • {school.conference}
                </p>
                <div className="space-y-2">
                  {records.map((record) => (
                    <div key={record.id} className="flex justify-between items-center py-1 border-t">
                      <span>
                        {record.coaches.first_name} {record.coaches.last_name}
                      </span>
                      <button
                        onClick={() => deleteAttendance(record.id)}
                        className="text-red-600 text-sm px-2"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Add Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50">
          <div className="bg-white w-full max-w-lg rounded-t-2xl h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b flex justify-between items-center shrink-0">
              <h2 className="text-lg font-semibold">
                {selectedSchool ? selectedSchool.school : 'Search for College'}
              </h2>
              <button 
                onClick={closeModal}
                className="text-gray-500 text-2xl p-2"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              {!selectedSchool ? (
                /* School Search */
                <>
                  <input
                    type="text"
                    value={searchTerm}
                    onChange={(e) => {
                      setSearchTerm(e.target.value)
                      searchSchools(e.target.value)
                    }}
                    className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg mb-4 sticky top-0 bg-white"
                    placeholder="Type college name..."
                    autoFocus
                  />
                  
                  {schools.length > 0 && (
                    <div className="space-y-2 pb-4">
                      {schools.map((school) => (
                        <button
                          key={school.id}
                          onClick={() => selectSchool(school)}
                          className="w-full text-left p-4 bg-gray-50 rounded-lg hover:bg-gray-100 active:bg-gray-200"
                        >
                          <div className="font-medium text-base">{school.school}</div>
                          <div className="text-sm text-gray-500">
                            {school.city}, {school.state} • {school.division}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  {searchTerm.length >= 2 && schools.length === 0 && (
                    <p className="text-center text-gray-500 py-4">
                      No schools found matching "{searchTerm}"
                    </p>
                  )}
                </>
              ) : (
                /* Coach Selection */
                <>
                  <button
                    onClick={() => {
                      setSelectedSchool(null)
                      setSearchTerm('')
                      setCoaches([])
                      setSelectedCoaches([])
                    }}
                    className="text-blue-600 mb-4 py-2"
                  >
                    ← Choose different school
                  </button>

                  <p className="text-sm text-gray-600 mb-3">
                    Select coaches who attended (tap to select):
                  </p>

                  {coaches.length > 0 ? (
                    <div className="space-y-2 mb-4 pb-2">
                      {coaches.map((coach) => (
                        <button
                          key={coach.id}
                          onClick={() => toggleCoach(coach.id)}
                          className={`w-full text-left p-4 rounded-lg border-2 ${
                            selectedCoaches.includes(coach.id)
                              ? 'border-green-500 bg-green-50'
                              : 'border-gray-200 bg-white'
                          }`}
                        >
                          <span className="font-medium text-base">
                            {coach.first_name} {coach.last_name}
                          </span>
                          {selectedCoaches.includes(coach.id) && (
                            <span className="float-right text-green-600 text-xl">✓</span>
                          )}
                        </button>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 mb-4">No coaches in database for this school.</p>
                  )}

                  {/* Add Coach Form */}
                  {showAddCoachForm ? (
                    <div className="bg-gray-50 rounded-lg p-4 mb-4">
                      <h4 className="font-medium mb-3">Add New Coach</h4>
                      <div className="space-y-3">
                        <input
                          type="text"
                          value={newCoach.first_name}
                          onChange={(e) => setNewCoach({ ...newCoach, first_name: e.target.value })}
                          className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base"
                          placeholder="First name"
                        />
                        <input
                          type="text"
                          value={newCoach.last_name}
                          onChange={(e) => setNewCoach({ ...newCoach, last_name: e.target.value })}
                          className="w-full px-3 py-3 border border-gray-300 rounded-lg text-base"
                          placeholder="Last name"
                        />
                        <div className="flex space-x-2">
                          <button
                            onClick={addNewCoach}
                            className="flex-1 bg-blue-600 text-white py-3 rounded-lg text-base"
                          >
                            Add Coach
                          </button>
                          <button
                            onClick={() => {
                              setShowAddCoachForm(false)
                              setNewCoach({ first_name: '', last_name: '' })
                            }}
                            className="flex-1 bg-gray-200 text-gray-700 py-3 rounded-lg text-base"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setShowAddCoachForm(true)}
                      className="w-full py-4 border-2 border-dashed border-gray-300 rounded-lg text-gray-600 mb-4 text-base"
                    >
                      + Add Coach Not Listed
                    </button>
                  )}
                </>
              )}
            </div>

            {/* Modal Footer */}
            {selectedSchool && selectedCoaches.length > 0 && (
              <div className="p-4 border-t shrink-0">
                <button
                  onClick={saveAttendance}
                  disabled={saving}
                  className="w-full bg-green-600 text-white py-4 rounded-lg text-lg font-semibold disabled:bg-gray-300"
                >
                  {saving ? 'Saving...' : `Save ${selectedCoaches.length} Coach${selectedCoaches.length > 1 ? 'es' : ''}`}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
