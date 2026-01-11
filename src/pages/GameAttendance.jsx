import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import FeedbackButton from '../components/FeedbackButton'

export default function GameAttendance() {
  const { eventSlug, teamSlug, gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [allSchools, setAllSchools] = useState([]) // All schools loaded once
  const [schoolsLoading, setSchoolsLoading] = useState(false)
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
    // Fetch game and attendance in parallel
    const [gameResult, attendanceResult] = await Promise.all([
      supabase
        .from('games')
        .select('*')
        .eq('id', gameId)
        .single(),
      supabase
        .from('attendance')
        .select('*, coaches(*, schools(*))')
        .eq('game_id', gameId)
    ])
    
    const gameData = gameResult.data
    
    // If game is closed, redirect to summary
    if (gameData?.is_closed) {
      navigate(`/e/${eventSlug}/${teamSlug}/summary`, { replace: true })
      return
    }
    
    setGame(gameData)
    setAttendance(attendanceResult.data || [])
    setLoading(false)
  }

  const fetchAttendance = async () => {
    const { data: attendanceData } = await supabase
      .from('attendance')
      .select('*, coaches(*, schools(*))')
      .eq('game_id', gameId)
    
    setAttendance(attendanceData || [])
  }

  // Load all schools when modal opens (one-time load for client-side search)
  const loadAllSchools = async () => {
    if (allSchools.length > 0) return // Already loaded
    
    setSchoolsLoading(true)
    try {
      let schools = []
      let from = 0
      const batchSize = 1000
      
      while (true) {
        const { data, error } = await supabase
          .from('schools')
          .select('id, school, city, state, division')
          .order('school')
          .range(from, from + batchSize - 1)
        
        if (error) throw error
        if (!data || data.length === 0) break
        
        schools = [...schools, ...data]
        if (data.length < batchSize) break
        from += batchSize
      }
      
      setAllSchools(schools)
    } catch (err) {
      console.error('Error loading schools:', err)
    } finally {
      setSchoolsLoading(false)
    }
  }

  // Fuzzy matching score for a school against search term
  const getMatchScore = useCallback((school, term) => {
    const name = school.school.toLowerCase()
    const nameNoSpaces = name.replace(/\s+/g, '')
    const termLower = term.toLowerCase()
    const termNoSpaces = termLower.replace(/\s+/g, '')
    
    // Exact match
    if (name === termLower) return 100
    // Starts with term
    if (name.startsWith(termLower)) return 90
    // Word starts with term (e.g., "State" matches "Ohio State")
    if (name.split(' ').some(word => word.startsWith(termLower))) return 80
    // Contains term as substring
    if (name.includes(termLower)) return 70
    // Space-collapsed match: "lasalle" matches "la salle"
    if (nameNoSpaces.includes(termNoSpaces)) return 60
    // Space-collapsed starts with: "las" matches start of "lasalle" (from "la salle")
    if (nameNoSpaces.startsWith(termNoSpaces)) return 55
    // City or state match
    const city = (school.city || '').toLowerCase()
    const state = (school.state || '').toLowerCase()
    if (city.includes(termLower) || state.startsWith(termLower)) return 30
    
    return 0
  }, [])

  // Client-side filtered schools based on search term
  const filteredSchools = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return []
    
    const term = searchTerm.trim()
    
    return allSchools
      .map(school => ({ ...school, score: getMatchScore(school, term) }))
      .filter(school => school.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  }, [allSchools, searchTerm, getMatchScore])

  const selectSchool = async (school) => {
    setSelectedSchool(school)
    setSearchTerm(school.school)
    
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
        {/* Breadcrumb navigation */}
        <div className="flex items-center gap-2 text-sm text-blue-200 mb-2">
          <Link to="/home" className="hover:text-white">Home</Link>
          <span>›</span>
          <Link to={`/e/${eventSlug}`} className="hover:text-white">Event</Link>
          <span>›</span>
          <Link to={`/e/${eventSlug}/${teamSlug}`} className="hover:text-white">Team</Link>
        </div>
        <h1 className="text-xl font-bold">
          {game && `${formatDate(game.game_date)} vs ${game.opponent}`}
        </h1>
      </header>

      {/* Add Button */}
      <div className="p-4">
        <button
          onClick={() => {
            setShowAddModal(true)
            loadAllSchools()
          }}
          className="w-full bg-green-600 text-white py-4 rounded-lg text-lg font-semibold hover:bg-green-700 active:bg-green-800"
        >
          + Add College Coaches
        </button>
        <div className="text-center mt-2">
          <Link to="/help?context=parent" className="text-sm text-gray-500 hover:text-blue-600">
            Need help? View quick guide →
          </Link>
        </div>
      </div>

      {/* Attendance List */}
      <main className="px-4 pb-4">
        {attendance.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-6 text-center">
            <div className="text-gray-400 text-4xl mb-3">👀</div>
            <p className="text-gray-600 font-medium mb-2">No coaches logged yet</p>
            <p className="text-sm text-gray-500 mb-4">
              Tap the green button above to log college coaches watching this game.
            </p>
            <div className="text-xs text-gray-400 bg-gray-50 rounded-lg p-3">
              <strong>Tip:</strong> Search for a college, then check off the coaches you see. 
              If a coach isn't listed, you can add them on the fly!
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {getAttendanceBySchool().map(({ school, records }) => (
              <div key={school.id} className="bg-white rounded-lg shadow-md p-4">
                <h3 className="font-semibold">{school.school}</h3>
                <p className="text-xs text-gray-500 mb-2">
                  {school.division} • {school.conference}
                </p>
                <div className="space-y-1">
                  {records.map((record) => (
                    <div key={record.id} className="flex justify-between items-center py-2 border-t">
                      <span className="text-gray-900">
                        {record.coaches.first_name} {record.coaches.last_name}
                      </span>
                      <button
                        onClick={() => deleteAttendance(record.id)}
                        className="text-red-600 text-sm px-3 py-2 -my-2 -mr-2 hover:bg-red-50 rounded-lg active:bg-red-100"
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
        <div 
          className="fixed inset-0 bg-black bg-opacity-50 flex items-end justify-center z-50"
          role="dialog"
          aria-modal="true"
          aria-labelledby="add-coach-modal-title"
        >
          <div className="bg-white w-full max-w-lg rounded-t-2xl h-[85vh] flex flex-col">
            {/* Modal Header */}
            <div className="p-4 border-b flex justify-between items-center shrink-0">
              <h2 id="add-coach-modal-title" className="text-lg font-semibold">
                {selectedSchool ? selectedSchool.school : 'Search for College'}
              </h2>
              <button 
                onClick={closeModal}
                className="text-gray-500 text-2xl p-2"
                aria-label="Close modal"
              >
                ×
              </button>
            </div>

            {/* Modal Content */}
            <div className="flex-1 overflow-y-auto p-4 overscroll-contain" style={{ WebkitOverflowScrolling: 'touch' }}>
              {!selectedSchool ? (
                /* School Search */
                <>
                  <div className="relative sticky top-0 bg-white z-10 mb-4">
                    <input
                      type="text"
                      value={searchTerm}
                      onChange={(e) => setSearchTerm(e.target.value)}
                      className="w-full px-4 py-3 border border-gray-300 rounded-lg text-lg pr-10"
                      placeholder="Type college name..."
                      autoFocus
                      aria-label="Search for college"
                    />
                    {schoolsLoading && (
                      <div className="absolute right-3 top-1/2 -translate-y-1/2">
                        <div className="animate-spin h-5 w-5 border-2 border-blue-600 border-t-transparent rounded-full"></div>
                      </div>
                    )}
                  </div>
                  
                  {filteredSchools.length > 0 && (
                    <div className="space-y-2" role="listbox" aria-label="Search results">
                      {filteredSchools.map((school) => (
                        <button
                          key={school.id}
                          onClick={() => selectSchool(school)}
                          className="w-full text-left p-4 bg-gray-50 rounded-lg hover:bg-gray-100 active:bg-gray-200"
                          role="option"
                        >
                          <div className="font-medium text-base">{school.school}</div>
                          <div className="text-sm text-gray-500">
                            {school.city}, {school.state} • {school.division}
                          </div>
                        </button>
                      ))}
                      {/* Large spacer so last items can scroll above keyboard */}
                      <div className="h-[50vh]"></div>
                    </div>
                  )}

                  {searchTerm.length >= 2 && filteredSchools.length === 0 && !schoolsLoading && (
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
                    <div className="space-y-2 mb-4">
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
                  
                  {/* Large spacer so content can scroll above keyboard */}
                  <div className="h-[50vh]"></div>
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

      {/* Feedback Button */}
      <FeedbackButton />
    </div>
  )
}
