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
  
  // Add School state
  const [showAddSchool, setShowAddSchool] = useState(false)
  const [schoolFormData, setSchoolFormData] = useState({
    school: '',
    city: '',
    state: '',
    type: 'Public',
    conference: '',
    division: 'NCAA D1'
  })
  const [addingSchool, setAddingSchool] = useState(false)

  useEffect(() => {
    fetchSchools()
  }, [])

  const fetchSchools = async () => {
    // Fetch all schools in batches (Supabase default max is 1000)
    let allSchools = [];
    let from = 0;
    const batchSize = 1000;
    
    while (true) {
      const { data, error } = await supabase
        .from('schools')
        .select('*')
        .order('school')
        .range(from, from + batchSize - 1);
      
      if (error) {
        console.error('Error fetching schools:', error);
        break;
      }
      
      if (!data || data.length === 0) break;
      
      allSchools = [...allSchools, ...data];
      
      if (data.length < batchSize) break;
      from += batchSize;
    }
    
    setSchools(allSchools);
    console.log('Loaded schools:', allSchools.length);
    setLoading(false);
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

  const addSchool = async () => {
    if (!schoolFormData.school.trim()) {
      alert('School name is required')
      return
    }
    
    setAddingSchool(true)
    const { data, error } = await supabase
      .from('schools')
      .insert([schoolFormData])
      .select()
      .single()
    
    if (error) {
      alert('Error adding school: ' + error.message)
    } else {
      // Add to local state
      setSchools(prev => [...prev, data].sort((a, b) => a.school.localeCompare(b.school)))
      setShowAddSchool(false)
      setSchoolFormData({
        school: '',
        city: '',
        state: '',
        type: 'Public',
        conference: '',
        division: 'NCAA D1'
      })
    }
    setAddingSchool(false)
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

  // Show more results when searching (up to 200)
  const displayLimit = search.trim() ? 200 : 100
  const displayedSchools = filteredSchools.slice(0, displayLimit)

  return (
    <AdminLayout session={session} title="Schools & Coaches">
      {/* Search and Add School */}
      <div className="mb-6 flex flex-col md:flex-row gap-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Search schools by name, state, or conference..."
        />
        <button
          onClick={() => setShowAddSchool(true)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
        >
          + Add School
        </button>
      </div>

      {/* Add School Modal */}
      {showAddSchool && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 w-full max-w-md mx-4">
            <h2 className="text-lg font-semibold mb-4">Add New School</h2>
            
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">School Name *</label>
                <input
                  type="text"
                  value={schoolFormData.school}
                  onChange={(e) => setSchoolFormData({ ...schoolFormData, school: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., University of Missouri"
                />
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">City</label>
                  <input
                    type="text"
                    value={schoolFormData.city}
                    onChange={(e) => setSchoolFormData({ ...schoolFormData, city: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="e.g., Columbia"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">State</label>
                  <input
                    type="text"
                    value={schoolFormData.state}
                    onChange={(e) => setSchoolFormData({ ...schoolFormData, state: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                    placeholder="e.g., Missouri"
                  />
                </div>
              </div>
              
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                  <select
                    value={schoolFormData.type}
                    onChange={(e) => setSchoolFormData({ ...schoolFormData, type: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="Public">Public</option>
                    <option value="Private">Private</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Division</label>
                  <select
                    value={schoolFormData.division}
                    onChange={(e) => setSchoolFormData({ ...schoolFormData, division: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="NCAA D1">NCAA D1</option>
                    <option value="NCAA D2">NCAA D2</option>
                    <option value="NCAA D3">NCAA D3</option>
                    <option value="NAIA">NAIA</option>
                    <option value="JC">Junior College</option>
                  </select>
                </div>
              </div>
              
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Conference</label>
                <input
                  type="text"
                  value={schoolFormData.conference}
                  onChange={(e) => setSchoolFormData({ ...schoolFormData, conference: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg"
                  placeholder="e.g., SEC"
                />
              </div>
            </div>
            
            <div className="flex gap-3 mt-6">
              <button
                onClick={() => setShowAddSchool(false)}
                className="flex-1 px-4 py-2 bg-gray-200 text-gray-700 rounded-lg"
              >
                Cancel
              </button>
              <button
                onClick={addSchool}
                disabled={addingSchool}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400"
              >
                {addingSchool ? 'Adding...' : 'Add School'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Stats */}
      <div className="mb-4 text-sm text-gray-600">
        {search.trim() 
          ? `Found ${filteredSchools.length} schools matching "${search}"`
          : `${schools.length} schools in database`
        }
        {filteredSchools.length > displayLimit && (
          <span className="text-orange-600"> (showing first {displayLimit})</span>
        )}
      </div>

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : (
        <div className="space-y-2">
          {displayedSchools.map((school) => (
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

          {filteredSchools.length > displayLimit && (
            <div className="text-center py-4 text-gray-500">
              Showing first {displayLimit} results. Refine your search to see more.
            </div>
          )}

          {filteredSchools.length === 0 && search.trim() && (
            <div className="text-center py-8 text-gray-500">
              No schools found matching "{search}".
              <button
                onClick={() => setShowAddSchool(true)}
                className="block mx-auto mt-2 text-blue-600 hover:text-blue-700"
              >
                + Add this school
              </button>
            </div>
          )}
        </div>
      )}
    </AdminLayout>
  )
}
