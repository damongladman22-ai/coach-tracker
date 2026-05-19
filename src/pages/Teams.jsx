import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClubId } from '../lib/club'
import { listSeasons, getActiveSeason } from '../lib/season'
import {
  getPrograms,
  getAgeGroups,
  generateTeamName,
  generateTeamSlug,
} from '../lib/lookups'

/**
 * Teams admin page (replaces v1 ClubTeams).
 *
 * Teams are now scoped to a season with structured fields:
 * - age_group_id (FK to age_groups)
 * - program_id (FK to programs)
 * - gender ('Girls' / 'Boys')
 *
 * Name and slug are auto-generated from those fields.
 *
 * Filter by season at the top of the page. Default to active season.
 */
export default function Teams({ session }) {
  const [teams, setTeams] = useState([])
  const [seasons, setSeasons] = useState([])
  const [programs, setPrograms] = useState([])
  const [ageGroups, setAgeGroups] = useState([])
  const [selectedSeasonId, setSelectedSeasonId] = useState(null)
  const [clubId, setClubId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingTeam, setEditingTeam] = useState(null)
  const [formData, setFormData] = useState({
    age_group_id: '',
    program_id: '',
    gender: 'Girls',
  })

  useEffect(() => {
    initialize()
  }, [])

  useEffect(() => {
    if (selectedSeasonId && clubId) {
      fetchTeams()
    }
  }, [selectedSeasonId, clubId])

  const initialize = async () => {
    const [cid, seasonsList, programsList, ageGroupsList, activeSeason] =
      await Promise.all([
        getCurrentClubId(),
        listSeasons(),
        getPrograms(),
        getAgeGroups(),
        getActiveSeason(),
      ])

    setClubId(cid)
    setSeasons(seasonsList)
    setPrograms(programsList)
    setAgeGroups(ageGroupsList)
    setSelectedSeasonId(activeSeason?.id || seasonsList[0]?.id || null)
    setLoading(false)
  }

  const fetchTeams = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('teams')
      .select(`
        *,
        age_groups (id, name, sort_order),
        programs (id, name, sort_order)
      `)
      .eq('club_id', clubId)
      .eq('season_id', selectedSeasonId)
      .order('age_groups(sort_order)', { foreignTable: 'age_groups' })

    if (!error) setTeams(data || [])
    setLoading(false)
  }

  const resetForm = () => {
    setFormData({ age_group_id: '', program_id: '', gender: 'Girls' })
    setEditingTeam(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!formData.age_group_id || !formData.program_id || !formData.gender) {
      return
    }
    if (!clubId || !selectedSeasonId) {
      alert('Club or season not set. Please contact admin.')
      return
    }

    const ageGroup = ageGroups.find(
      (a) => a.id === parseInt(formData.age_group_id, 10)
    )
    const program = programs.find(
      (p) => p.id === parseInt(formData.program_id, 10)
    )
    if (!ageGroup || !program) return

    const name = generateTeamName(ageGroup.name, formData.gender, program.name)
    const slug = generateTeamSlug(ageGroup.name, formData.gender, program.name)

    const payload = {
      club_id: clubId,
      season_id: selectedSeasonId,
      age_group_id: ageGroup.id,
      program_id: program.id,
      gender: formData.gender,
      name,
      slug,
    }

    if (editingTeam) {
      const { error } = await supabase
        .from('teams')
        .update(payload)
        .eq('id', editingTeam.id)
      if (error) {
        alert('Could not update team: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('teams').insert([payload])
      if (error) {
        if (error.code === '23505') {
          alert(
            'A team with this combination of age group, gender, and program already exists in this season.'
          )
        } else {
          alert('Could not create team: ' + error.message)
        }
        return
      }
    }

    resetForm()
    fetchTeams()
  }

  const handleEdit = (team) => {
    setEditingTeam(team)
    setFormData({
      age_group_id: String(team.age_group_id),
      program_id: String(team.program_id),
      gender: team.gender,
    })
    setShowForm(true)
  }

  const handleDelete = async (team) => {
    if (
      !confirm(
        `Delete team "${team.name}"? This will also delete all games, attendance, and videos for this team. This cannot be undone.`
      )
    )
      return

    const { error } = await supabase.from('teams').delete().eq('id', team.id)
    if (error) {
      alert('Could not delete team: ' + error.message)
      return
    }
    fetchTeams()
  }

  const previewName =
    formData.age_group_id && formData.program_id && formData.gender
      ? generateTeamName(
          ageGroups.find((a) => a.id === parseInt(formData.age_group_id, 10))
            ?.name || '',
          formData.gender,
          programs.find((p) => p.id === parseInt(formData.program_id, 10))
            ?.name || ''
        )
      : ''

  return (
    <AdminLayout session={session} title="Teams">
      {/* Season selector + Add button row */}
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Season:</label>
          <select
            value={selectedSeasonId || ''}
            onChange={(e) => setSelectedSeasonId(parseInt(e.target.value, 10))}
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {seasons.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
                {s.is_active ? ' (active)' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Team
        </button>
      </div>

      {/* Form */}
      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingTeam ? 'Edit Team' : 'Add New Team'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Age Group *
                </label>
                <select
                  value={formData.age_group_id}
                  onChange={(e) =>
                    setFormData({ ...formData, age_group_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select...</option>
                  {ageGroups.map((ag) => (
                    <option key={ag.id} value={ag.id}>
                      {ag.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Gender *
                </label>
                <select
                  value={formData.gender}
                  onChange={(e) =>
                    setFormData({ ...formData, gender: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="Girls">Girls</option>
                  <option value="Boys">Boys</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Program *
                </label>
                <select
                  value={formData.program_id}
                  onChange={(e) =>
                    setFormData({ ...formData, program_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select...</option>
                  {programs.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {previewName && (
              <div className="bg-blue-50 border border-blue-200 rounded p-3 text-sm">
                <span className="text-blue-700 font-medium">Team name: </span>
                <span className="text-blue-900">{previewName}</span>
              </div>
            )}

            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {editingTeam ? 'Update' : 'Add'} Team
              </button>
              <button
                type="button"
                onClick={resetForm}
                className="bg-gray-200 text-gray-700 px-4 py-2 rounded-lg hover:bg-gray-300"
              >
                Cancel
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Teams list */}
      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : teams.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No teams in this season yet. Add your first team above.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                  Team Name
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 hidden sm:table-cell">
                  Age Group
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 hidden sm:table-cell">
                  Program
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 hidden md:table-cell">
                  Gender
                </th>
                <th className="px-6 py-3 text-right text-sm font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {teams.map((team) => (
                <tr key={team.id}>
                  <td className="px-6 py-4 text-gray-900 font-medium">
                    {team.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden sm:table-cell">
                    {team.age_groups?.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden sm:table-cell">
                    {team.programs?.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden md:table-cell">
                    {team.gender}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleEdit(team)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(team)}
                        className="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg text-sm"
                      >
                        Delete
                      </button>
                    </div>
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
