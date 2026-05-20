import { useState, useEffect, useRef } from 'react'
import { supabase } from '../lib/supabase'
import {
  requestUploadUrl,
  uploadToStorage,
  markVideoReady,
  markVideoFailed,
  deleteVideo,
  probeVideoDuration,
} from '../lib/videoStorage'
import VideoModal from './VideoModal'

/**
 * VideoSection — admin UI to upload + manage videos for one game.
 *
 * Renders inside AdminGameAttendance below the coach attendance list.
 * Handles:
 *  - File picker + upload progress
 *  - List existing videos for this game
 *  - Play (modal via signed URL) and delete
 */
export default function VideoSection({ gameId }) {
  const [videos, setVideos] = useState([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)
  const [playingVideoId, setPlayingVideoId] = useState(null)
  const fileInputRef = useRef(null)

  useEffect(() => {
    fetchVideos()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gameId])

  const fetchVideos = async () => {
    setLoading(true)
    const { data } = await supabase
      .from('videos')
      .select('*')
      .eq('game_id', gameId)
      .order('uploaded_at', { ascending: false })
    setVideos(data || [])
    setLoading(false)
  }

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0]
    if (!file) return
    setError(null)
    setUploading(true)
    setProgress(0)

    let videoId = null
    try {
      // Probe duration in parallel with mint
      const [{ uploadUrl, videoId: vid }, duration] = await Promise.all([
        requestUploadUrl(gameId, file),
        probeVideoDuration(file),
      ])
      videoId = vid
      await uploadToStorage(uploadUrl, file, (frac) => setProgress(frac))
      await markVideoReady(videoId, duration)
      await fetchVideos()
    } catch (err) {
      console.error('Upload error:', err)
      setError(err.message || 'Upload failed')
      if (videoId) await markVideoFailed(videoId).catch(() => {})
    } finally {
      setUploading(false)
      setProgress(0)
      if (fileInputRef.current) fileInputRef.current.value = ''
    }
  }

  const handlePlay = (videoId) => {
    setPlayingVideoId(videoId)
  }

  const handleDelete = async (videoId) => {
    if (!confirm('Delete this video? This cannot be undone.')) return
    try {
      await deleteVideo(videoId)
      await fetchVideos()
    } catch (err) {
      alert('Could not delete: ' + err.message)
    }
  }

  return (
    <div className="bg-white rounded-lg shadow-md p-5 mt-6">
      <div className="flex justify-between items-center mb-3">
        <h2 className="text-lg font-semibold">Videos ({videos.length})</h2>
        <div>
          <input
            ref={fileInputRef}
            type="file"
            accept="video/*"
            onChange={handleFileChange}
            disabled={uploading}
            className="sr-only"
            id="video-file-input"
          />
          <label
            htmlFor="video-file-input"
            className={`bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium ${
              uploading
                ? 'opacity-60 cursor-not-allowed'
                : 'hover:bg-blue-700 cursor-pointer'
            }`}
          >
            {uploading ? 'Uploading…' : '+ Upload Video'}
          </label>
        </div>
      </div>

      {uploading && (
        <div className="mb-3">
          <div className="h-2 bg-gray-200 rounded overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all"
              style={{ width: `${Math.round(progress * 100)}%` }}
            ></div>
          </div>
          <p className="text-xs text-gray-500 mt-1">
            Uploading directly to storage… {Math.round(progress * 100)}%
          </p>
        </div>
      )}

      {error && (
        <div className="bg-rose-50 text-rose-700 text-sm p-3 rounded mb-3">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-sm text-gray-500">Loading…</div>
      ) : videos.length === 0 ? (
        <p className="text-sm text-gray-500 italic">
          No videos uploaded for this game yet. Max 4.5 GB per file.
        </p>
      ) : (
        <div className="divide-y divide-gray-100">
          {videos.map((v) => (
            <VideoRow
              key={v.id}
              video={v}
              onPlay={() => handlePlay(v.id)}
              onDelete={() => handleDelete(v.id)}
            />
          ))}
        </div>
      )}

      {playingVideoId && (
        <VideoModal
          videoId={playingVideoId}
          onClose={() => setPlayingVideoId(null)}
        />
      )}
    </div>
  )
}

function VideoRow({ video, onPlay, onDelete }) {
  const statusBadge = () => {
    if (video.upload_status === 'ready') return null
    const colorMap = {
      uploading: 'bg-amber-100 text-amber-700',
      failed: 'bg-rose-100 text-rose-700',
    }
    return (
      <span
        className={`text-xs px-2 py-0.5 rounded ${
          colorMap[video.upload_status] || 'bg-gray-100 text-gray-600'
        }`}
      >
        {video.upload_status}
      </span>
    )
  }
  return (
    <div className="py-3 flex items-center justify-between gap-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-gray-900 truncate">
            {video.title || 'Untitled'}
          </span>
          {statusBadge()}
        </div>
        <div className="text-xs text-gray-500 mt-0.5">
          {video.duration_seconds
            ? `${Math.round(video.duration_seconds / 60)} min · `
            : ''}
          {video.file_size_bytes
            ? `${(video.file_size_bytes / 1e9).toFixed(2)} GB`
            : ''}
        </div>
      </div>
      <div className="flex gap-1 flex-shrink-0">
        {video.upload_status === 'ready' && (
          <button
            onClick={onPlay}
            className="text-cyan-700 bg-cyan-50 hover:bg-cyan-100 px-3 py-1.5 rounded text-sm font-medium"
          >
            Play
          </button>
        )}
        <button
          onClick={onDelete}
          className="text-rose-600 hover:bg-rose-50 px-3 py-1.5 rounded text-sm"
        >
          Delete
        </button>
      </div>
    </div>
  )
}

