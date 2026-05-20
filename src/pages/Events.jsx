import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClubId } from '../lib/club'
import { listSeasons, getActiveSeasonId } from '../lib/season'

export default function Events({ session }) {
  const [events, setEvents] = useState([])
  const [eventGameCounts, setEventGameCounts] = useState({}) // { eventId: count }
  const [seasons, setSeasons] = useState([])
  const [selectedSeasonId, setSelectedSeasonId] = useState(null)
  const [clubId, setClubId] = useState(null)
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [editingEvent, setEditingEvent] = useState(null)
  const [formData, setFormData] = useState({
    event_name: '',
    start_date: '',
    end_date: '',
    location: '',
    season_id: '',
  })

  useEffect(() => {
    initialize()
  }, [])

  useEffect(() => {
    if (clubId) fetchEvents()
  }, [clubId, selectedSeasonId])

  const initialize = async () => {
    const [cid, seasonsList, activeSeasonId] = await Promise.all([
      getCurrentClubId(),
      listSeasons(),
      getActiveSeasonId(),
    ])
    setClubId(cid)
    setSeasons(seasonsList)
    setSelectedSeasonId(activeSeasonId)
  }

  const fetchEvents = async () => {
    setLoading(true)
    let query = supabase
      .from('events')
      .select('*, seasons(name, slug)')
      .eq('club_id', clubId)
      .order('start_date', { ascending: false })

    if (selectedSeasonId) {
      query = query.eq('season_id', selectedSeasonId)
    }

    const { data, error } = await query
    if (!error) setEvents(data || [])

    // Fetch game counts per event
    if (data && data.length > 0) {
      const eventIds = data.map((e) => e.id)
      const { data: games } = await supabase
        .from('games')
        .select('event_id')
        .in('event_id', eventIds)
      const counts = {}
      ;(games || []).forEach((g) => {
        counts[g.event_id] = (counts[g.event_id] || 0) + 1
      })
      setEventGameCounts(counts)
    } else {
      setEventGameCounts({})
    }

    setLoading(false)
  }

  const generateSlug = (name) =>
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '')

  const resetForm = () => {
    setFormData({
      event_name: '',
      start_date: '',
      end_date: '',
      location: '',
      season_id: selectedSeasonId || '',
    })
    setEditingEvent(null)
    setShowForm(false)
  }

  const handleSubmit = async (e) => {
    e.preventDefault()

    if (!clubId) {
      alert('Club not set. Please contact admin.')
      return
    }

    if (!formData.event_name?.trim()) {
      alert('Event name is required.')
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

    const slug = generateSlug(formData.event_name)
    const seasonId = formData.season_id
      ? parseInt(formData.season_id, 10)
      : selectedSeasonId

    if (!seasonId) {
      alert('Season is required. Please select one.')
      return
    }

    const payload = {
      event_name: formData.event_name,
      start_date: formData.start_date,
      end_date: formData.end_date,
      location: formData.location || null,
      slug,
      club_id: clubId,
      season_id: seasonId,
    }

    if (editingEvent) {
      const { error } = await supabase
        .from('events')
        .update(payload)
        .eq('id', editingEvent.id)
      if (error) {
        alert('Could not update event: ' + error.message)
        return
      }
    } else {
      const { error } = await supabase.from('events').insert([payload])
      if (error) {
        alert('Could not create event: ' + error.message)
        return
      }
    }

    resetForm()
    fetchEvents()
  }

  const handleEdit = (event) => {
    setEditingEvent(event)
    setFormData({
      event_name: event.event_name,
      start_date: event.start_date,
      end_date: event.end_date,
      location: event.location || '',
      season_id: String(event.season_id || ''),
    })
    setShowForm(true)
  }

  const handleDelete = async (id) => {
    // Count what's about to be deleted so the confirm message is honest
    const { data: gamesAtEvent } = await supabase
      .from('games')
      .select('id')
      .eq('event_id', id)
    const gameIds = (gamesAtEvent || []).map((g) => g.id)
    let attCount = 0
    if (gameIds.length > 0) {
      const { count } = await supabase
        .from('attendance')
        .select('*', { count: 'exact', head: true })
        .in('game_id', gameIds)
      attCount = count || 0
    }

    const msg =
      gameIds.length === 0
        ? 'Delete this event?'
        : `Delete this event? It has ${gameIds.length} game${
            gameIds.length === 1 ? '' : 's'
          } and ${attCount} attendance record${
            attCount === 1 ? '' : 's'
          }. All will be deleted.`

    if (!confirm(msg)) return

    // Delete games for this event (attendance cascades via FK)
    if (gameIds.length > 0) {
      const { error: gErr } = await supabase
        .from('games')
        .delete()
        .eq('event_id', id)
      if (gErr) {
        alert('Could not delete games: ' + gErr.message)
        return
      }
    }

    // Then delete the event itself
    const { error } = await supabase.from('events').delete().eq('id', id)
    if (error) {
      alert('Could not delete event: ' + error.message)
      return
    }
    fetchEvents()
  }

  const formatDate = (dateStr) => {
    const [year, month, day] = dateStr.split('-')
    const date = new Date(year, month - 1, day)
    return date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }

  return (
    <AdminLayout session={session} title="Events &amp; Schedules">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-3 mb-6">
        <div className="flex items-center gap-3">
          <label className="text-sm font-medium text-gray-700">Season:</label>
          <select
            value={selectedSeasonId || ''}
            onChange={(e) =>
              setSelectedSeasonId(
                e.target.value ? parseInt(e.target.value, 10) : null
              )
            }
            className="px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All seasons</option>
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
                Event Name *
              </label>
              <input
                type="text"
                value={formData.event_name}
                onChange={(e) =>
                  setFormData({ ...formData, event_name: e.target.value })
                }
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Summer Showcase 2026"
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Season *
                </label>
                <select
                  value={formData.season_id || selectedSeasonId || ''}
                  onChange={(e) =>
                    setFormData({ ...formData, season_id: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required
                >
                  <option value="">Select...</option>
                  {seasons.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Location
                </label>
                <input
                  type="text"
                  value={formData.location}
                  onChange={(e) =>
                    setFormData({ ...formData, location: e.target.value })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="e.g., Las Vegas, NV"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Start Date *
                </label>
                <input
                  type="date"
                  value={formData.start_date}
                  onChange={(e) =>
                    setFormData({ ...formData, start_date: e.target.value })
                  }
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    formData.start_date
                      ? 'border-gray-300 text-gray-900'
                      : 'border-orange-300 bg-orange-50 text-gray-500'
                  }`}
                  required
                />
                {!formData.start_date && (
                  <p className="text-xs text-orange-600 italic mt-1">
                    Tap to pick a date — none selected yet
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  End Date *
                </label>
                <input
                  type="date"
                  value={formData.end_date}
                  onChange={(e) =>
                    setFormData({ ...formData, end_date: e.target.value })
                  }
                  className={`w-full px-3 py-2 border rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    formData.end_date
                      ? 'border-gray-300 text-gray-900'
                      : 'border-orange-300 bg-orange-50 text-gray-500'
                  }`}
                  required
                />
                {!formData.end_date && (
                  <p className="text-xs text-orange-600 italic mt-1">
                    Tap to pick a date — none selected yet
                  </p>
                )}
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
      ) : events.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No events yet. Create your first event above.
        </div>
      ) : (
        <div className="space-y-4">
          {events.map((event) => {
            const gameCount = eventGameCounts[event.id] || 0
            return (
            <div key={event.id} className="bg-white rounded-lg shadow-md p-6">
              <div className="flex justify-between items-start gap-3">
                <div className="flex-1 min-w-0">
                  <Link
                    to={`/admin/events/${event.id}`}
                    className="text-xl font-semibold text-blue-600 hover:text-blue-800"
                  >
                    {event.event_name}
                  </Link>
                  <p className="text-gray-600 mt-1">
                    {formatDate(event.start_date)} - {formatDate(event.end_date)}
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    {gameCount === 0
                      ? 'No games scheduled yet'
                      : `${gameCount} game${gameCount === 1 ? '' : 's'} scheduled`}
                  </p>
                  {event.location && (
                    <p className="text-gray-500 text-sm mt-1">
                      📍 {event.location}
                    </p>
                  )}
                  {event.seasons?.name && (
                    <p className="text-xs text-gray-400 mt-1">
                      Season: {event.seasons.name}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap gap-1 flex-shrink-0 justify-end">
                  <Link
                    to={`/admin/events/${event.id}`}
                    className="text-cyan-700 bg-cyan-50 hover:bg-cyan-100 px-3 py-2 rounded-lg text-sm font-medium"
                  >
                    Schedule &amp; Games →
                  </Link>
                  <button
                    onClick={() => handleEdit(event)}
                    className="text-blue-600 hover:text-blue-800 hover:bg-blue-50 px-3 py-2 rounded-lg text-sm"
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
          )})}
        </div>
      )}
    </AdminLayout>
  )
}
