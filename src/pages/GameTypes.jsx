import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClubId } from '../lib/club'
import { clearLookupCaches } from '../lib/lookups'

/**
 * Programs admin page. Lookup CRUD: name, sort_order, active.
 * Scoped to the current club.
 */
export default function GameTypes({ session }) {
  const [items, setItems] = useState([])
  const [clubId, setClubId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [formData, setFormData] = useState({
    name: '',
    sort_order: 0,
    active: true,
  })

  useEffect(() => {
    initialize()
  }, [])

  const initialize = async () => {
    const cid = await getCurrentClubId()
    setClubId(cid)
    if (cid) fetchItems(cid)
    else setLoading(false)
  }

  const fetchItems = async (cid) => {
    setLoading(true)
    const { data } = await supabase
      .from('game_types')
      .select('*')
      .eq('club_id', cid || clubId)
      .order('sort_order')
    setItems(data || [])
    setLoading(false)
  }

  const resetForm = () => {
    setFormData({ name: '', sort_order: items.length, active: true })
    setEditing(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!clubId) return
    const payload = {
      club_id: clubId,
      name: formData.name,
      sort_order: parseInt(formData.sort_order, 10) || 0,
      active: formData.active,
    }
    if (editing) {
      const { error } = await supabase
        .from('game_types')
        .update(payload)
        .eq('id', editing.id)
      if (error) {
        alert('Could not update: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('game_types').insert([payload])
      if (error) {
        alert('Could not create: ' + error.message)
        return
      }
    }
    clearLookupCaches()
    resetForm()
    fetchItems()
  }

  const handleEdit = (item) => {
    setEditing(item)
    setFormData({
      name: item.name,
      sort_order: item.sort_order,
      active: item.active,
    })
    setShowForm(true)
  }

  const handleDelete = async (item) => {
    if (
      !confirm(
        `Delete game type "${item.name}"? Will fail if any teams reference it. Mark Inactive instead to retire it.`
      )
    )
      return
    const { error } = await supabase.from('game_types').delete().eq('id', item.id)
    if (error) {
      alert('Could not delete: ' + error.message)
      return
    }
    clearLookupCaches()
    fetchItems()
  }

  const toggleActive = async (item) => {
    const { error } = await supabase
      .from('game_types')
      .update({ active: !item.active })
      .eq('id', item.id)
    if (!error) {
      clearLookupCaches()
      fetchItems()
    }
  }

  return (
    <AdminLayout session={session} title="Game Types">
      <div className="mb-6">
        <button
          onClick={() => {
            resetForm()
            setShowForm(true)
          }}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Game Type
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editing ? 'Edit Game Type' : 'Add Game Type'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            <div>
              <label className="block text-sm text-gray-600 mb-1">Name *</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg"
                placeholder="e.g., League, Showcase, Tournament"
                required
              />
            </div>
            <div>
              <label className="block text-sm text-gray-600 mb-1">
                Sort Order
              </label>
              <input
                type="number"
                value={formData.sort_order}
                onChange={(e) =>
                  setFormData({ ...formData, sort_order: e.target.value })
                }
                className="w-full sm:w-32 px-3 py-2 border border-gray-300 rounded-lg"
              />
              <p className="text-xs text-gray-400 mt-1">
                Lower numbers appear first in dropdowns
              </p>
            </div>
            <div>
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={formData.active}
                  onChange={(e) =>
                    setFormData({ ...formData, active: e.target.checked })
                  }
                  className="h-4 w-4 text-blue-600 rounded"
                />
                Active (uncheck to retire without deleting)
              </label>
            </div>
            <div className="flex gap-2">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {editing ? 'Update' : 'Add'} Program
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
      ) : items.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No game types yet.
        </div>
      ) : (
        <div className="bg-white rounded-lg shadow-md overflow-hidden">
          <table className="w-full">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500">
                  Name
                </th>
                <th className="px-6 py-3 text-left text-sm font-medium text-gray-500 hidden sm:table-cell">
                  Sort Order
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
              {items.map((item) => (
                <tr key={item.id} className={!item.active ? 'opacity-60' : ''}>
                  <td className="px-6 py-4 text-gray-900 font-medium">
                    {item.name}
                  </td>
                  <td className="px-6 py-4 text-gray-600 hidden sm:table-cell">
                    {item.sort_order}
                  </td>
                  <td className="px-6 py-4">
                    {item.active ? (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-green-100 text-green-700">
                        Active
                      </span>
                    ) : (
                      <span className="inline-flex items-center px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-600">
                        Inactive
                      </span>
                    )}
                  </td>
                  <td className="px-6 py-4 text-right">
                    <div className="flex justify-end gap-1">
                      <button
                        onClick={() => toggleActive(item)}
                        className="text-xs text-gray-600 hover:text-gray-800 hover:bg-gray-50 px-3 py-2 rounded-lg"
                      >
                        {item.active ? 'Mark Inactive' : 'Mark Active'}
                      </button>
                      <button
                        onClick={() => handleEdit(item)}
                        className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDelete(item)}
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
