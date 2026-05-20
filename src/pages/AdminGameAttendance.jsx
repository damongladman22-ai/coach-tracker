import { useState, useEffect, useCallback, useMemo } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { gameResult } from '../components/ScoreInput'
import VideoSection from '../components/VideoSection'

/**
 * Admin Game Attendance — manage coach attendance on any single game.
 *
 * Route: /admin/games/:gameId
 *
 * Works for both event-tied games and standalone league games. Provides:
 *  - Game context header (date, opponent, event/type, score)
 *  - Existing attendance grouped by school, with remove
 *  - Add Coaches flow: school search → pick coaches OR add new coach
 *  - Back link to the team detail page
 */
export default function AdminGameAttendance({ session }) {
  const { gameId } = useParams()
  const navigate = useNavigate()
  const [game, setGame] = useState(null)
  const [attendance, setAttendance] = useState([])
  const [loading, setLoading] = useState(true)
  const [showAddModal, setShowAddModal] = useState(false)
  const [allSchools, setAllSchools] = useState([])
  const [schoolsLoading, setSchoolsLoading] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [selectedSchool, setSelectedSchool] = useState(null)
  const [coaches, setCoaches] = useState([])
  const [selectedCoaches, setSelectedCoaches] = useState([])
  const [showNewCoachForm, setShowNewCoachForm] = useState(false)
  const [newCoach, setNewCoach] = useState({ first_name: '', last_name: '' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    fetchGameData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  const fetchGameData = async () => {
    setLoading(true)
    const [gameRes, attRes] = await Promise.all([
      supabase
        .from('games')
        .select(
          '*, teams(id, name, slug), events(id, event_name, slug), game_types(id, name)'
        )
        .eq('id', gameId)
        .single(),
      supabase
        .from('attendance')
        .select('*, coaches(*, schools(*))')
        .eq('game_id', gameId),
    ])
    setGame(gameRes.data)
    setAttendance(attRes.data || [])
    setLoading(false)
  }

  const loadAllSchools = async () => {
    if (allSchools.length > 0) return
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
    } finally {
      setSchoolsLoading(false)
    }
  }

  const getMatchScore = useCallback((school, term) => {
    const name = school.school.toLowerCase()
    const nameNoSpaces = name.replace(/\s+/g, '')
    const termLower = term.toLowerCase()
    const termNoSpaces = termLower.replace(/\s+/g, '')
    if (name === termLower) return 100
    if (name.startsWith(termLower)) return 90
    if (name.split(' ').some((w) => w.startsWith(termLower))) return 80
    if (name.includes(termLower)) return 70
    if (nameNoSpaces.includes(termNoSpaces)) return 60
    if (nameNoSpaces.startsWith(termNoSpaces)) return 55
    return 0
  }, [])

  const filteredSchools = useMemo(() => {
    if (!searchTerm || searchTerm.length < 2) return []
    return allSchools
      .map((s) => ({ ...s, score: getMatchScore(s, searchTerm.trim()) }))
      .filter((s) => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20)
  }, [allSchools, searchTerm, getMatchScore])

  const openAddModal = async () => {
    setShowAddModal(true)
    setSearchTerm('')
    setSelectedSchool(null)
    setCoaches([])
    setSelectedCoaches([])
    setShowNewCoachForm(false)
    setNewCoach({ first_name: '', last_name: '' })
    await loadAllSchools()
  }

  const closeAddModal = () => {
    setShowAddModal(false)
  }

  const selectSchool = async (school) => {
    setSelectedSchool(school)
    setSearchTerm(school.school)
    const { data } = await supabase
      .from('coaches')
      .select('*')
      .eq('school_id', school.id)
      .neq('is_active', false)
      .order('last_name')
    setCoaches(data || [])
  }

  const toggleCoach = (id) => {
    setSelectedCoaches((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    )
  }

  const addNewCoach = async () => {
    if (!newCoach.first_name || !newCoach.last_name || !selectedSchool) return
    const { data, error } = await supabase
      .from('coaches')
      .insert([
        {
          first_name: newCoach.first_name,
          last_name: newCoach.last_name,
          school_id: selectedSchool.id,
        },
      ])
      .select()
      .single()
    if (!error && data) {
      setCoaches((prev) =>
        [...prev, data].sort((a, b) => a.last_name.localeCompare(b.last_name))
      )
      setSelectedCoaches((prev) => [...prev, data.id])
      setNewCoach({ first_name: '', last_name: '' })
      setShowNewCoachForm(false)
    }
  }

  const saveAttendance = async () => {
    if (selectedCoaches.length === 0) return
    setSaving(true)
    const records = selectedCoaches.map((coachId) => ({
      game_id: gameId,
      coach_id: coachId,
    }))
    const { error } = await supabase
      .from('attendance')
      .upsert(records, { onConflict: 'game_id,coach_id' })
    setSaving(false)
    if (!error) {
      await fetchGameData()
      closeAddModal()
    } else {
      alert('Could not save: ' + error.message)
    }
  }

  const removeAttendance = async (attendanceId) => {
    if (!confirm('Remove this coach from this game?')) return
    const { error } = await supabase
      .from('attendance')
      .delete()
      .eq('id', attendanceId)
    if (!error) fetchGameData()
  }

  // Group attendance by school
  const grouped = useMemo(() => {
    const m = new Map()
    attendance.forEach((a) => {
      const school = a.coaches?.schools
      if (!school) return
      if (!m.has(school.id))
        m.set(school.id, { school, entries: [] })
      m.get(school.id).entries.push(a)
    })
    return Array.from(m.values()).sort((a, b) =>
      a.school.school.localeCompare(b.school.school)
    )
  }, [attendance])

  const formatDate = (s) => {
    if (!s) return ''
    const [y, m, d] = s.split('-')
    return new Date(y, m - 1, d).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }
  const formatTime = (t) => {
    if (!t) return ''
    const [h, m] = t.split(':').map(Number)
    const ampm = h >= 12 ? 'PM' : 'AM'
    return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${ampm}`
  }

  if (loading) {
    return (
      <AdminLayout session={session} title="Loading...">
        <div className="text-center py-12 text-gray-500">Loading...</div>
      </AdminLayout>
    )
  }

  if (!game) {
    return (
      <AdminLayout session={session} title="Game not found">
        <div className="bg-red-50 text-red-700 p-4 rounded-lg">Game not found.</div>
      </AdminLayout>
    )
  }

  const r = gameResult(game)
  const teamId = game.teams?.id

  return (
    <AdminLayout session={session} title="Manage Coach Attendance">
      {teamId && (
        <Link
          to={`/admin/teams/${teamId}`}
          className="text-sm text-blue-600 hover:underline mb-3 inline-block"
        >
          ← Back to {game.teams?.name}
        </Link>
      )}

      {/* Game context */}
      <div className="bg-white rounded-lg shadow-md p-5 mb-6">
        <div className="flex justify-between items-start gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-xs uppercase tracking-wider text-gray-500 mb-1">
              {game.events ? game.events.event_name : game.game_types?.name || 'Game'}
            </div>
            <h1 className="text-2xl font-bold text-gray-900">
              {game.is_home ? 'vs' : '@'} {game.opponent || 'TBD'}
            </h1>
            <div className="text-sm text-gray-600 mt-1">
              {formatDate(game.game_date)}
              {game.game_time && ` · ${formatTime(game.game_time)}`}
              {game.location && ` · 📍 ${game.location}`}
            </div>
          </div>
          {r.label && (
            <span
              className={`text-sm font-bold px-3 py-1 rounded tabular-nums flex-shrink-0 ${r.color}`}
            >
              {r.label} {r.score}
            </span>
          )}
        </div>
      </div>

      {/* Attendance list */}
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">
          Coaches Who Attended ({attendance.length})
        </h2>
        <button
          onClick={openAddModal}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
        >
          + Add Coaches
        </button>
      </div>

      {grouped.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No coaches logged for this game yet.
        </div>
      ) : (
        <div className="space-y-3">
          {grouped.map(({ school, entries }) => (
            <div key={school.id} className="bg-white rounded-lg shadow-md p-4">
              <div className="font-semibold text-gray-900">{school.school}</div>
              <div className="text-xs text-gray-500 mb-2">
                {school.division || ''}
                {school.division && (school.city || school.state) && ' · '}
                {[school.city, school.state].filter(Boolean).join(', ')}
              </div>
              <div className="divide-y divide-gray-100">
                {entries.map((a) => (
                  <div
                    key={a.id}
                    className="py-2 flex justify-between items-center"
                  >
                    <div className="text-sm">
                      <span className="font-medium">
                        {a.coaches?.first_name} {a.coaches?.last_name}
                      </span>
                      {a.coaches?.title && (
                        <span className="text-gray-500 ml-2">
                          {a.coaches.title}
                        </span>
                      )}
                    </div>
                    <button
                      onClick={() => removeAttendance(a.id)}
                      className="text-xs text-red-600 hover:bg-red-50 px-2 py-1 rounded"
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

      {/* Videos section */}
      <VideoSection gameId={gameId} />

      {/* Add Coaches Modal */}
      {showAddModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-2xl w-full max-h-[90vh] flex flex-col">
            <div className="p-4 border-b flex justify-between items-center">
              <h3 className="text-lg font-semibold">Add Coaches</h3>
              <button onClick={closeAddModal} className="text-gray-500 hover:text-gray-700 text-2xl leading-none">×</button>
            </div>

            <div className="p-4 overflow-y-auto flex-1">
              {/* School search */}
              <label className="block text-sm font-medium text-gray-700 mb-1">
                School
              </label>
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => {
                  setSearchTerm(e.target.value)
                  setSelectedSchool(null)
                  setCoaches([])
                }}
                placeholder="Type a school name..."
                className="w-full px-3 py-2 border border-gray-300 rounded-lg mb-2"
                autoFocus
              />

              {schoolsLoading && (
                <p className="text-xs text-gray-500">Loading schools…</p>
              )}

              {!selectedSchool && filteredSchools.length > 0 && (
                <div className="border border-gray-200 rounded-lg max-h-48 overflow-y-auto mb-3">
                  {filteredSchools.map((s) => (
                    <button
                      key={s.id}
                      onClick={() => selectSchool(s)}
                      className="w-full text-left px-3 py-2 hover:bg-blue-50 border-b border-gray-100 last:border-0"
                    >
                      <div className="text-sm font-medium">{s.school}</div>
                      <div className="text-xs text-gray-500">
                        {[s.city, s.state].filter(Boolean).join(', ')}
                        {s.division ? ` · ${s.division}` : ''}
                      </div>
                    </button>
                  ))}
                </div>
              )}

              {/* Coach picker */}
              {selectedSchool && (
                <>
                  <div className="bg-blue-50 px-3 py-2 rounded-lg mb-3 flex justify-between items-center">
                    <div className="text-sm font-medium">{selectedSchool.school}</div>
                    <button
                      onClick={() => {
                        setSelectedSchool(null)
                        setCoaches([])
                        setSelectedCoaches([])
                        setSearchTerm('')
                      }}
                      className="text-xs text-blue-700 hover:underline"
                    >
                      Change
                    </button>
                  </div>

                  <div className="mb-2 text-sm font-medium text-gray-700">
                    Coaches at this school:
                  </div>
                  {coaches.length === 0 ? (
                    <p className="text-sm text-gray-500 italic mb-3">
                      No coaches in the database for this school yet. Add one
                      below.
                    </p>
                  ) : (
                    <div className="space-y-1 mb-3">
                      {coaches.map((c) => (
                        <label
                          key={c.id}
                          className="flex items-center gap-2 px-2 py-2 hover:bg-gray-50 rounded cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={selectedCoaches.includes(c.id)}
                            onChange={() => toggleCoach(c.id)}
                            className="h-4 w-4"
                          />
                          <span className="text-sm">
                            {c.first_name} {c.last_name}
                            {c.title && (
                              <span className="text-gray-500 ml-2 text-xs">
                                {c.title}
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}

                  {/* Add new coach form */}
                  {!showNewCoachForm ? (
                    <button
                      onClick={() => setShowNewCoachForm(true)}
                      className="text-sm text-blue-600 hover:underline"
                    >
                      + Add a new coach to {selectedSchool.school}
                    </button>
                  ) : (
                    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                      <div className="text-sm font-medium mb-2">New Coach</div>
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <input
                          type="text"
                          placeholder="First name"
                          value={newCoach.first_name}
                          onChange={(e) =>
                            setNewCoach({ ...newCoach, first_name: e.target.value })
                          }
                          className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                        />
                        <input
                          type="text"
                          placeholder="Last name"
                          value={newCoach.last_name}
                          onChange={(e) =>
                            setNewCoach({ ...newCoach, last_name: e.target.value })
                          }
                          className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                        />
                      </div>
                      <div className="flex gap-2">
                        <button
                          onClick={addNewCoach}
                          disabled={!newCoach.first_name || !newCoach.last_name}
                          className="text-xs bg-blue-600 text-white px-3 py-1 rounded disabled:bg-gray-300"
                        >
                          Add Coach
                        </button>
                        <button
                          onClick={() => {
                            setShowNewCoachForm(false)
                            setNewCoach({ first_name: '', last_name: '' })
                          }}
                          className="text-xs text-gray-600 hover:underline"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}
                </>
              )}
            </div>

            <div className="p-4 border-t flex justify-end gap-2">
              <button
                onClick={closeAddModal}
                className="text-sm text-gray-600 hover:text-gray-800 px-3 py-2"
              >
                Cancel
              </button>
              <button
                onClick={saveAttendance}
                disabled={selectedCoaches.length === 0 || saving}
                className="bg-blue-600 text-white px-4 py-2 rounded text-sm font-medium hover:bg-blue-700 disabled:bg-gray-300"
              >
                {saving
                  ? 'Saving...'
                  : `Save ${selectedCoaches.length} Coach${selectedCoaches.length === 1 ? '' : 'es'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}
