import { useState, useEffect } from 'react'
import { getPlaybackUrl } from '../lib/videoStorage'

/**
 * VideoModal — full-screen modal that streams a video via a signed
 * playback URL. Used by both admin and parent surfaces.
 *
 * Props:
 *  - videoId: string  (required)
 *  - title?: string   (optional; shown in header)
 *  - onClose: () => void
 */
export default function VideoModal({ videoId, title, onClose }) {
  const [url, setUrl] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    let cancelled = false
    getPlaybackUrl(videoId)
      .then(({ url }) => {
        if (!cancelled) setUrl(url)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message)
      })
    return () => {
      cancelled = true
    }
  }, [videoId])

  // ESC closes
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/85 z-50 flex items-center justify-center p-2 sm:p-4"
      onClick={onClose}
    >
      <div
        className="bg-black rounded-lg max-w-5xl w-full"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-between items-center p-2">
          <span className="text-white text-sm pl-2 truncate flex-1">
            {title || 'Video'}
          </span>
          <button
            onClick={onClose}
            aria-label="Close"
            className="text-white text-2xl leading-none px-3 py-1 hover:bg-white/10 rounded"
          >
            ×
          </button>
        </div>
        {error ? (
          <div className="p-6 text-white">Could not load: {error}</div>
        ) : !url ? (
          <div className="p-6 text-white">Loading…</div>
        ) : (
          <video
            src={url}
            controls
            autoPlay
            playsInline
            className="w-full max-h-[80vh] block"
          />
        )}
      </div>
    </div>
  )
}
