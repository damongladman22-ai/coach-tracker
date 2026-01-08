import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function Events({ session }) {
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [formData, setFormData] = useState({ 
    event_name: '', 
    start_date: '', 
    end_date: '' 
  })

  useEffect(() => {
    fetchEvents()
  }, [])

  const fetchEvents = async () => {
    const { data, error } = await supabase
      .from('events')
      .select('*')
      .order('start_date', { ascending: false })
    
    if (!error) setEvents(data || [])
    setLoading(false)
  }

  const generateSlug = (name) => {
    return name.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    
    const slug = generateSlug(formData.event_name)
    const dataToSave = { ...formData, slug }
    
    if (editingEvent) {
      const { error } = await supabase
        .from('events')
        .update(dataToSave)
        .eq('id', editingEvent.id)
      
      if (!error) {
        setEditingEvent(null)
        setShowForm(false)
        setFormData({ event_name: '', start_date: '', end_date: '' })
        fetchEvents()
      }
    } else {
      const { error } = await supabase
        .from('events')
        .insert([dataToSave])
      
      if (!error) {
        setShowForm(false)
        setFormData({ event_name: '', start_date: '', end_date: '' })
        fetchEvents()
      }
    }
  }

  const handleEdit = (event) => {
    setEditingEvent(event)
    setFormData({ 
      event_name: event.event_name, 
      start_date: event.start_date, 
      end_date: event.end_date 
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    if (!confirm('Are you sure you want to delete this event? This will also delete all associated games and attendance records.')) return
    
    const { error } = await supabase
      .from('events')
      .delete()
      .eq('id', id)
    
    if (!error) fetchEvents()
  }

  const handleCancel = () => {
    setShowForm(false)
    setEditingEvent(null)
    setFormData({ event_name: '', start_date: '', end_date: '' })
  }

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  return (
    <AdminLayout session={session} title="Events">
      <div className="mb-6">
        <button
          onClick={() => setShowForm(true)}
          className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
        >
          + Add Event
        </button>
      </div>

      {showForm && (
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">
            {editingEvent ? 'Edit Event' : 'Add New Event'}
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Event Name
              </label>
              <input
                type="text"
                value={formData.event_name}
                onChange={(e) => setFormData({ ...formData, event_name: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Summer Showcase 2025"
                required
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) => setFormData({ ...formData, start_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) => setFormData({ ...formData, end_date: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                />
              </div>
            </div>
            <div className="flex space-x-3">
              <button
                type="submit"
                className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700"
              >
                {editingEvent ? 'Update' : 'Add'} Event
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
      ) : events.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No events yet. Create your first event above.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => (
            <div key={event.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start">
                <div>
                  <Link 
                    to={`/admin/events/${event.id}`}
                    className="text-xl font-semibold text-blue-600 hover:text-blue-800"
                  >
                    {event.event_name}
                  </Link>
                  <p className="text-gray-600 mt-1">
                    {formatDate(event.start_date)} - {formatDate(event.end_date)}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Link
                    to={`/admin/events/${event.id}`}
                    className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm"
                  >
                    Manage
                  </Link>
                  <button
                    onClick={() => handleEdit(event)}
                    className="text-gray-600 hover:text-gray-800 hover:bg-gray-100 px-3 py-2 rounded-lg text-sm"
                  >
                    Edit
                  </button>
                  <button
                    onClick={() => handleDelete(event.id)}
                    className="text-red-600 hover:text-red-800 hover:bg-red-50 px-3 py-2 rounded-lg text-sm"
                  >
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </AdminLayout>
  )
}
