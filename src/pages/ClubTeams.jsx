import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function ClubTeams({ session }) {
  const [teams, setTeams] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [formData, setFormData] = useState({ team_name: '', gender: 'Girls' })

  useEffect(() => {
    fetchTeams()
  }, [])

  const fetchTeams = async () => {
    const { data, error } = await supabase
      .from('club_teams')
      .select('*')
      .order('team_name')
    
    if (!error) setTeams(data || [])
    setLoading(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    if (editingTeam) {
      const { error } = await supabase
        .from('club_teams')
        .update(formData)
        .eq('id', editingTeam.id)
      
      if (!error) {
        setEditingTeam(null)
        setShowForm(false)
        setFormData({ team_name: '', gender: 'Girls' })
        fetchTeams()
      }
    } else {
      const { error } = await supabase
        .from('club_teams')
        .insert([formData])
      
      if (!error) {
        setShowForm(false)
        setFormData({ team_name: '', gender: 'Girls' })
        fetchTeams()
      }
    }
  }

  const handleEdit = (team) => {
    setEditingTeam(team)
    setFormData({ team_name: team.team_name, gender: team.gender })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this team?')) return
    
    const { error } = await supabase
      .from('club_teams')
      .delete()
      .eq('id', id)
    
    if (!error) fetchTeams()
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingTeam(null)
    setFormData({ team_name: '', gender: 'Girls' })
  }

  return (
    <AdminLayout session={session} title="Club Teams">
      <div className="mb-6">
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Team
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingTeam ? 'Edit Team' : 'Add New Team'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Team Name
              </label>
              <input
                type="text"
                value={formData.team_name}
                onChange={(e) => setFormData({ ...formData, team_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., 2008 Girls Elite"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Gender
              </label>
              <select
                value={formData.gender}
                onChange={(e) => setFormData({ ...formData, gender: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value="Girls">Girls</option>
                <option value="Boys">Boys</option>
              </select>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {editingTeam ? 'Update' : 'Add'} Team
              </button>
              <button
                type="button"
                onClick={handleCancel}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : teams.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No teams yet. Add your first team above.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">Team Name</th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">Gender</th>
                <th className="px-6 py-3 text-right text-sm font-medium text-gray-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-6 py-4 text-gray-900">{team.team_name}</td>
                  <td className="px-6 py-4 text-gray-600">{team.gender}</td>
                  <td className="px-6 py-4 text-right space-x-2">
                    <button
                      onClick={() => handleEdit(team)}
                      className="text-blue-600 hover:text-blue-800"
                    >
                      Edit
                    </button>
                    <button
                      onClick={() => handleDelete(team.id)}
                      className="text-red-600 hover:text-red-800"
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </AdminLayout>
  )
}
