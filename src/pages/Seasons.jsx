import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import DateField from '../components/DateField'
import { clearSeasonCache } from '../lib/season'

/**
 * Seasons admin page.
 *
 * Admins can:
 * - Create new seasons (e.g., when rolling forward into 2026-2027)
 * - Edit season names and dates
 * - Mark a season as active (only one active at a time)
 * - Delete seasons (only if no teams reference them)
 */
export default function Seasons({ session }) {
  const [seasons, setSeasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingSeason, setEditingSeason] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    slug: '',
    start_date: '',
    end_date: '',
    is_active: false,
  })

  useEffect(() => {
    fetchSeasons()
  }, [])

  const fetchSeasons = async () => {
    setLoading(true)
    const { data, error } = await supabase
      .from('seasons')
      .select('*')
      .order('start_date', { ascending: false })

    if (!error) setSeasons(data || [])
    setLoading(false)
  }

  const generateSlug = (name) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

  const resetForm = () => {
    setFormData({
      name: '',
      slug: '',
      start_date: '',
      end_date: '',
      is_active: false,
    })
    setEditingSeason(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!formData.name?.trim()) {
      alert('Season name is required.')
      return
    }
    if (!formData.start_date || !formData.end_date) {
      alert('Both Start Date and End Date are required. Please pick dates.')
      return
    }
    if (formData.end_date < formData.start_date) {
      alert('End Date must be on or after Start Date.')
      return
    }

    const payload = {
      ...formData,
      slug: formData.slug || generateSlug(formData.name),
    }

    // If this season is being marked active, deactivate all others first
    if (payload.is_active) {
      await supabase
        .from('seasons')
        .update({ is_active: false })
        .neq('id', editingSeason?.id || -1)
    }

    if (editingSeason) {
      const { error } = await supabase
        .from('seasons')
        .update(payload)
        .eq('id', editingSeason.id)
      if (error) {
        alert('Could not update season: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('seasons').insert([payload])
      if (error) {
        alert('Could not create season: ' + error.message)
        return
      }
    }

    clearSeasonCache()
    resetForm()
    fetchSeasons()
  }

  const handleEdit = (season) => {
    setEditingSeason(season)
    setFormData({
      name: season.name,
      slug: season.slug,
      start_date: season.start_date,
      end_date: season.end_date,
      is_active: season.is_active,
    })
    setShowForm(true)
  }

  const handleDelete = async (season) => {
    if (
      !confirm(
        `Delete season "${season.name}"? This will fail if any teams reference this season. You'd need to delete or reassign those teams first.`
      )
    )
      return

    const { error } = await supabase
      .from('seasons')
      .delete()
      .eq('id', season.id)
    if (error) {
      alert(
        'Could not delete season: ' +
          error.message +
          '\n\nLikely cause: there are teams or events still referencing this season.'
      )
      return
    }
    clearSeasonCache()
    fetchSeasons()
  }

  const handleSetActive = async (season) => {
    // Deactivate all
    await supabase
      .from('seasons')
      .update({ is_active: false })
      .neq('id', season.id)
    // Activate this one
    const { error } = await supabase
      .from('seasons')
      .update({ is_active: true })
      .eq('id', season.id)
    if (error) {
      alert('Could not set active: ' + error.message)
      return
    }
    clearSeasonCache()
    fetchSeasons()
  }

  const formatDate = (dateStr) => {
    if (!dateStr) return ''
    const [year, month, day] = dateStr.split('-').map(Number)
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <AdminLayout session={session} title="Seasons">
      <div className="mb-6">
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Season
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingSeason ? 'Edit Season' : 'Add New Season'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Season Name *
                </label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) =>
                    setFormData({
                      ...formData,
                      name: e.target.value,
                      slug: formData.slug || generateSlug(e.target.value),
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 2026-2027"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Slug *
                </label>
                <input
                  type="text"
                  value={formData.slug}
                  onChange={(e) =>
                    setFormData({ ...formData, slug: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., 2026-2027"
                  required
                />
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <DateField
                label="Start Date"
                value={formData.start_date}
                onChange={(e) =>
                  setFormData({ ...formData, start_date: e.target.value })
                }
                required
              />
              <DateField
                label="End Date"
                value={formData.end_date}
                onChange={(e) =>
                  setFormData({ ...formData, end_date: e.target.value })
                }
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_active"
                checked={formData.is_active}
                onChange={(e) =>
                  setFormData({ ...formData, is_active: e.target.checked })
                }
                className="h-4 w-4 text-blue-600 rounded"
              />
              <label htmlFor="is_active" className="text-sm text-gray-700">
                Mark this season as currently active (will deactivate others)
              </label>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {editingSeason ? 'Update' : 'Add'} Season
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

      {loading ? (
        <div className="text-center py-8">Loading...</div>
      ) : seasons.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No seasons yet. Add the first one above.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                  Season
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 hidden sm:table-cell">
                  Dates
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                  Status
                </th>
                <th className="px-6 py-3 text-right text-sm font-medium text-gray-500">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200">
              {seasons.map((season) => (
                <tr key={season.id}>
                  <td className="px-6 py-4">
                    <div className="font-medium text-gray-900">
                      {season.name}
                    </div>
                    <div className="text-xs text-gray-500">{season.slug}</div>
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden sm:table-cell">
                    {formatDate(season.start_date)} —{' '}
                    {formatDate(season.end_date)}
                  </td>
                  <td className="px-6 py-4">
                    {season.is_active ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    ) : (
                      <button
                        onClick={() => handleSetActive(season)}
                        className="text-xs text-blue-600 hover:text-blue-800 hover:underline"
                      >
                        Set active
                      </button>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => handleEdit(season)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(season)}
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
