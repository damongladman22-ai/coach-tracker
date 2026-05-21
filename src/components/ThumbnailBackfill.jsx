import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { generateAndUploadThumbnailFromExisting } from '../lib/videoStorage'

/**
 * ThumbnailBackfill — small admin widget that shows how many videos
 * are missing thumbnails and offers a one-click "Generate" action.
 *
 * Props:
 *  - scope: 'all' (every video in the system) | { gameId } (one game only)
 *  - onDone?: () => void  — called after backfill completes
 */
export default function ThumbnailBackfill({ scope, onDone }) {
  const [missing, setMissing] = useState([])
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState({ done: 0, total: 0, failed: 0 })
  const [doneMessage, setDoneMessage] = useState(null)

  const fetchMissing = async () => {
    setLoading(true)
    let q = supabase
      .from('videos')
      .select('id, title')
      .is('thumbnail_path', null)
      .eq('upload_status', 'ready')
    if (scope && typeof scope === 'object' && scope.gameId) {
      q = q.eq('game_id', scope.gameId)
    }
    const { data } = await q
    setMissing(data || [])
    setLoading(false)
  }

  useEffect(() => {
    fetchMissing()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scope?.gameId])

  const run = async () => {
    if (missing.length === 0) return
    setRunning(true)
    setDoneMessage(null)
    setProgress({ done: 0, total: missing.length, failed: 0 })
    let done = 0
    let failed = 0
    for (const v of missing) {
      const path = await generateAndUploadThumbnailFromExisting(v.id)
      if (path) done++
      else failed++
      setProgress({ done: done + failed, total: missing.length, failed })
    }
    setRunning(false)
    setDoneMessage(
      `Generated ${done} of ${missing.length} thumbnails${
        failed ? ` (${failed} failed)` : ''
      }.`
    )
    await fetchMissing()
    if (onDone) onDone()
  }

  if (loading) return null
  if (missing.length === 0 && !doneMessage) return null

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 my-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="min-w-0">
          <div className="font-medium text-amber-900 text-sm">
            {missing.length > 0
              ? `${missing.length} video${missing.length === 1 ? '' : 's'} missing thumbnails`
              : doneMessage}
          </div>
          {running && (
            <div className="text-xs text-amber-800 mt-1">
              Processing {progress.done} of {progress.total}…
              {progress.failed > 0 && ` (${progress.failed} failed)`}
            </div>
          )}
          {!running && missing.length > 0 && (
            <div className="text-xs text-amber-800 mt-1">
              Each video takes ~5–10 seconds. Stay on this page until it
              finishes.
            </div>
          )}
        </div>
        {missing.length > 0 && (
          <button
            onClick={run}
            disabled={running}
            className="bg-amber-600 hover:bg-amber-700 disabled:opacity-60 disabled:cursor-wait text-white px-4 py-2 rounded text-sm font-medium"
          >
            {running ? 'Generating…' : 'Generate Thumbnails'}
          </button>
        )}
      </div>
    </div>
  )
}
