import { useState } from 'react'
import { getDownloadUrl, buildVideoFilename } from '../lib/videoStorage'
import VideoModal from './VideoModal'

/**
 * GameVideosPanel — inline parent-facing video list for one game.
 *
 * Shown when a parent expands a game card's video badge. Lists each
 * ready video with:
 *   - Title, duration, file size
 *   - Play button (opens VideoModal with signed playback URL)
 *   - Download button (uses signed URL with Content-Disposition: attachment)
 *
 * Props:
 *  - videos: array of video records (already filtered to upload_status='ready')
 *  - game: the game record (for filename context)
 *  - teamName?: string (for filename context)
 */
export default function GameVideosPanel({ videos, game, teamName }) {
  const [playingVideoId, setPlayingVideoId] = useState(null)
  const [playingTitle, setPlayingTitle] = useState(null)
  const [downloading, setDownloading] = useState(null) // videoId currently being prepped
  const [error, setError] = useState(null)

  if (!videos || videos.length === 0) return null

  const handleDownload = async (video) => {
    setError(null)
    setDownloading(video.id)
    try {
      const baseName = buildVideoFilename(game, teamName)
      const { url } = await getDownloadUrl(video.id, baseName)
      // Trigger the download by clicking a hidden link
      const a = document.createElement('a')
      a.href = url
      a.rel = 'noopener'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
    } catch (err) {
      setError(err.message || 'Download failed')
    } finally {
      setDownloading(null)
    }
  }

  return (
    <div className="bg-gray-50 border-t border-gray-200 px-4 py-3">
      {error && (
        <div className="text-rose-700 text-sm bg-rose-50 p-2 rounded mb-2">
          {error}
        </div>
      )}
      <div className="space-y-2">
        {videos.map((v) => {
          const sizeGB = v.file_size_bytes
            ? (v.file_size_bytes / 1e9).toFixed(2)
            : null
          const durationMin = v.duration_seconds
            ? Math.round(v.duration_seconds / 60)
            : null
          return (
            <div
              key={v.id}
              className="bg-white rounded-lg p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-gray-900 text-sm truncate">
                  {v.title || 'Video'}
                </div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {durationMin ? `${durationMin} min` : null}
                  {durationMin && sizeGB ? ' · ' : null}
                  {sizeGB ? `${sizeGB} GB` : null}
                </div>
              </div>
              <div className="flex gap-2 flex-shrink-0">
                <button
                  onClick={() => {
                    setPlayingVideoId(v.id)
                    setPlayingTitle(v.title || 'Video')
                  }}
                  className="bg-cyan-600 hover:bg-cyan-700 active:bg-cyan-800 text-white px-4 py-2.5 rounded-lg text-sm font-medium min-w-[88px]"
                >
                  Play
                </button>
                <button
                  onClick={() => handleDownload(v)}
                  disabled={downloading === v.id}
                  className="bg-gray-200 hover:bg-gray-300 active:bg-gray-400 text-gray-800 px-4 py-2.5 rounded-lg text-sm font-medium min-w-[110px] disabled:opacity-60 disabled:cursor-wait"
                >
                  {downloading === v.id ? 'Preparing…' : 'Download'}
                </button>
              </div>
            </div>
          )
        })}
      </div>

      {playingVideoId && (
        <VideoModal
          videoId={playingVideoId}
          title={playingTitle}
          onClose={() => {
            setPlayingVideoId(null)
            setPlayingTitle(null)
          }}
        />
      )}
    </div>
  )
}
