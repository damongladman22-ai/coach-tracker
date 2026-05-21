import { useState, useEffect } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { gameResult } from '../components/ScoreInput'
import VideoSection from '../components/VideoSection'
import ThumbnailBackfill from '../components/ThumbnailBackfill'

/**
 * Admin Game Videos — manage video uploads on any single game.
 *
 * Route: /admin/games/:gameId/videos
 *
 * Separate from coach attendance because the two concerns have nothing
 * to do with each other. This page shows game context at the top and
 * the VideoSection (upload, list, play, delete) below.
 */
export default function AdminGameVideos({ session }) {
  const { gameId } = useParams()
  const [game, setGame] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    const fetchGame = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('games')
        .select(
          '*, teams(id, name, slug), events(id, event_name, slug), game_types(id, name)'
        )
        .eq('id', gameId)
        .single()
      setGame(data)
      setLoading(false)
    }
    fetchGame()
  }, [gameId])

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
        <div className="text-center py-12 text-gray-500">
          That game doesn&apos;t exist or was deleted.
        </div>
      </AdminLayout>
    )
  }

  const r = gameResult(game)
  const teamId = game.teams?.id

  return (
    <AdminLayout session={session} title="Manage Videos">
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
              {game.events
                ? game.events.event_name
                : game.game_types?.name || 'Game'}
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

      <ThumbnailBackfill scope={{ gameId }} />
      <VideoSection gameId={gameId} />
    </AdminLayout>
  )
}
