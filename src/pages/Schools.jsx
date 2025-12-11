import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function Schools({ session }) {
  const [schools, setSchools] = useState([])
  const [coaches, setCoaches] = useState({})
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [expandedSchool, setExpandedSchool] = useState(null)
  const [showCoachForm, setShowCoachForm] = useState(null)
  const [coachFormData, setCoachFormData] = useState({ first_name: '', last_name: '' })

  useEffect(() => {
    fetchSchools()
  }, [])

  const fetchSchools = async () => {
    // Fetch all schools (default limit is 1000, we have 1400+)
    const { data, error } = await supabase
      .from('schools')
      .select('*')
      .order('school')
      .limit(2000)
    
    if (!error) setSchools(data || [])
    setLoading(false)
  }

  const fetchCoaches = async (schoolId) => {
    if (coaches[schoolId]) return // Already loaded
    
    const { data } = await supabase
      .from('coaches')
      .select('*')
      .eq('school_id', schoolId)
      .order('last_name')
    
    setCoaches(prev => ({ ...prev, [schoolId]: data || [] }))
  }

  const toggleSchool = (schoolId) => {
    if (expandedSchool === schoolId) {
      setExpandedSchool(null)
    } else {
      setExpandedSchool(schoolId)
      fetchCoaches(schoolId)
    }
  }

  const addCoach = async (schoolId) => {
    const { error } = await supabase
      .from('coaches')
      .insert([{ 
        school_id: schoolId,
        first_name: coachFormData.first_name,
        last_name: coachFormData.last_name
      }])
    
    if (!error) {
      setShowCoachForm(null)
      setCoachFormData({ first_name: '', last_name: '' })
      // Refresh coaches for this school
      const { data } = await supabase
        .from('coaches')
        .select('*')
        .eq('school_id', schoolId)
        .order('last_name')
      setCoaches(prev => ({ ...prev, [schoolId]: data || [] }))
    }
  }

  const deleteCoach = async (coachId, schoolId) => {
    if (!confirm('Delete this coach?')) return

    const { error } = await supabase
      .from('coaches')
      .delete()
      .eq('id', coachId)
    
    if (!error) {
      // Refresh coaches for this school
      const { data } = await supabase
        .from('coaches')
        .select('*')
        .eq('school_id', schoolId)
        .order('last_name')
      setCoaches(prev => ({ ...prev, [schoolId]: data || [] }))
    }
  }

  const filteredSchools = schools.filter(school => 
    school.school.toLowerCase().includes(search.toLowerCase()) ||
    school.state?.toLowerCase().includes(search.toLowerCase()) ||
    school.conference?.toLowerCase().includes(search.toLowerCase())
  )

  return (
    <AdminLayout session={session} title="Schools & Coaches">
      {/* Search */}
      <div className="mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full md:w-96 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search schools by name, state, or conference..."
        />
      </div>

      {/* Stats */}
      <div className="mb-4 text-sm text-gray-600">
        Showing {filteredSchools.length} of {schools.length} schools
      </div>

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="space-y-2">
          {filteredSchools.slice(0, 100).map((school) => (
            <div key={school.id} className="bg-white rounded-lg shadow-md overflow-hidden">
              <div 
                className="p-4 cursor-pointer hover:bg-gray-50 flex justify-between items-center"
                onClick={() => toggleSchool(school.id)}
              >
                <div>
                  <h3 className="font-semibold text-gray-900">{school.school}</h3>
                  <p className="text-sm text-gray-600">
                    {school.city}, {school.state} • {school.division} • {school.conference}
                  </p>
                </div>
                <span className="text-gray-400">
                  {expandedSchool === school.id ? '▼' : '▶'}
                </span>
              </div>

              {expandedSchool === school.id && (
                <div className="border-t px-4 py-3 bg-gray-50">
                  <div className="flex justify-between items-center mb-3">
                    <h4 className="font-medium text-sm">Coaches</h4>
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setShowCoachForm(school.id)
                      }}
                      className="text-blue-600 hover:text-blue-800 text-sm"
                    >
                      + Add Coach
                    </button>
                  </div>

                  {showCoachForm === school.id && (
                    <div className="bg-white rounded p-3 mb-3 border">
                      <div className="grid grid-cols-2 gap-2 mb-2">
                        <input
                          type="text"
                          value={coachFormData.first_name}
                          onChange={(e) => setCoachFormData({ ...coachFormData, first_name: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                          placeholder="First name"
                          onClick={(e) => e.stopPropagation()}
                        />
                        <input
                          type="text"
                          value={coachFormData.last_name}
                          onChange={(e) => setCoachFormData({ ...coachFormData, last_name: e.target.value })}
                          className="px-3 py-2 border border-gray-300 rounded text-sm"
                          placeholder="Last name"
                          onClick={(e) => e.stopPropagation()}
                        />
                      </div>
                      <div className="flex space-x-2">
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            addCoach(school.id)
                          }}
                          className="bg-blue-600 text-white px-3 py-1 rounded text-sm hover:bg-blue-700"
                        >
                          Add
                        </button>
                        <button
                          onClick={(e) => {
                            e.stopPropagation()
                            setShowCoachForm(null)
                            setCoachFormData({ first_name: '', last_name: '' })
                          }}
                          className="bg-gray-200 text-gray-700 px-3 py-1 rounded text-sm"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )}

                  {coaches[school.id]?.length > 0 ? (
                    <div className="space-y-1">
                      {coaches[school.id].map((coach) => (
                        <div key={coach.id} className="flex justify-between items-center py-1">
                          <span className="text-sm">
                            {coach.first_name} {coach.last_name}
                          </span>
                          <button
                            onClick={(e) => {
                              e.stopPropagation()
                              deleteCoach(coach.id, school.id)
                            }}
                            className="text-red-600 hover:text-red-800 text-xs"
                          >
                            Delete
                          </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-gray-500 text-sm">No coaches added yet.</p>
                  )}
                </div>
              )}
            </div>
          ))}

          {filteredSchools.length > 100 && (
            <div className="text-center py-4 text-gray-500">
              Showing first 100 results. Refine your search to see more.
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}
