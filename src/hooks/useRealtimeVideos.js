import { useEffect, useState, useCallback, useRef } from 'react'
import { supabase } from '../lib/supabase'

/**
 * Hook for polling-based video updates.
 *
 * Takes an array of gameIds and returns a map keyed by game_id of the
 * 'ready' videos for those games. Polls every 10 seconds while the tab
 * is visible; pauses when hidden; resumes on visibility change. Matches
 * the pattern of useRealtimeAttendance, but slightly slower default
 * since video uploads are far less frequent than attendance changes.
 *
 * Returns:
 *   - videosByGame: { [gameId]: video[] }
 *   - loading: boolean (first fetch only)
 *   - lastUpdate: Date
 *
 * Usage:
 *   const { videosByGame } = useRealtimeVideos(games.map(g => g.id))
 */
export function useRealtimeVideos(gameIds) {
  const [videosByGame, setVideosByGame] = useState({})
  const [loading, setLoading] = useState(true)
  const [lastUpdate, setLastUpdate] = useState(null)
  const intervalRef = useRef(null)
  const pollMs = useRef(10000) // 10s baseline
  const isVisibleRef = useRef(true)

  // Stable string key so the hook only re-subscribes when the actual
  // set of game IDs changes, not on every render.
  const gameIdsKey = (gameIds || []).slice().sort().join(',')

  const fetchVideos = useCallback(async () => {
    if (!isVisibleRef.current) return
    if (!gameIdsKey) {
      setVideosByGame({})
      setLoading(false)
      return
    }
    const ids = gameIdsKey.split(',')
    const startTime = Date.now()
    try {
      const { data, error } = await supabase
        .from('videos')
        .select(
          'id, game_id, title, duration_seconds, file_size_bytes, mime_type, uploaded_at'
        )
        .in('game_id', ids)
        .eq('upload_status', 'ready')
        .order('uploaded_at', { ascending: false })
      if (error) throw error
      const byGame = {}
      ;(data || []).forEach((v) => {
        if (!byGame[v.game_id]) byGame[v.game_id] = []
        byGame[v.game_id].push(v)
      })
      setVideosByGame(byGame)
      setLastUpdate(new Date())
      const took = Date.now() - startTime
      if (took > 2000 && pollMs.current < 20000) {
        pollMs.current = 20000
      } else if (took < 1000 && pollMs.current > 10000) {
        pollMs.current = 10000
      }
    } catch (err) {
      console.error('Error fetching videos:', err)
      pollMs.current = 20000
    } finally {
      setLoading(false)
    }
  }, [gameIdsKey])

  useEffect(() => {
    fetchVideos()
    const poll = () => {
      fetchVideos()
      intervalRef.current = setTimeout(poll, pollMs.current)
    }
    intervalRef.current = setTimeout(poll, pollMs.current)
    const onVis = () => {
      isVisibleRef.current = document.visibilityState === 'visible'
      if (isVisibleRef.current) {
        fetchVideos()
        if (!intervalRef.current) {
          intervalRef.current = setTimeout(poll, pollMs.current)
        }
      } else if (intervalRef.current) {
        clearTimeout(intervalRef.current)
        intervalRef.current = null
      }
    }
    document.addEventListener('visibilitychange', onVis)
    return () => {
      if (intervalRef.current) clearTimeout(intervalRef.current)
      document.removeEventListener('visibilitychange', onVis)
    }
  }, [fetchVideos])

  return { videosByGame, loading, lastUpdate, refetch: fetchVideos }
}
