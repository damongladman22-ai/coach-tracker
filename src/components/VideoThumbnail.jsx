import { useEffect, useState } from 'react'
import { getThumbnailUrls } from '../lib/videoStorage'

// In-memory cache so we don't refetch URLs on every render across components.
// Keyed by videoId, value is the signed URL string.
const urlCache = new Map()

/**
 * Drop a videoId from the URL cache so the next render fetches a fresh
 * signed URL. Used after a thumbnail is regenerated (the file in R2 has
 * been overwritten; the cached URL points to it but the browser may
 * have the old bytes in its HTTP cache).
 */
export function invalidateThumbnailCache(videoId) {
  urlCache.delete(videoId)
}
// Track in-flight batched requests to dedupe simultaneous fetches.
let pendingBatch = null
let pendingIds = new Set()
let pendingResolvers = []

async function flushBatch() {
  const ids = Array.from(pendingIds)
  pendingIds = new Set()
  const resolvers = pendingResolvers
  pendingResolvers = []
  pendingBatch = null
  if (ids.length === 0) return
  try {
    const urls = await getThumbnailUrls(ids)
    for (const id of ids) {
      if (urls[id]) urlCache.set(id, urls[id])
    }
    resolvers.forEach((r) => r(urls))
  } catch (err) {
    resolvers.forEach((r) => r({}))
  }
}

/**
 * Schedule a thumbnail URL fetch, coalescing multiple requests within a
 * single tick into one batched API call. Cache results in-memory.
 */
function fetchThumbnailUrl(videoId) {
  if (urlCache.has(videoId)) {
    return Promise.resolve(urlCache.get(videoId))
  }
  pendingIds.add(videoId)
  if (!pendingBatch) {
    pendingBatch = setTimeout(flushBatch, 50)
  }
  return new Promise((resolve) => {
    pendingResolvers.push((urls) => resolve(urls[videoId] || null))
  })
}

/**
 * VideoThumbnail — img element that fetches a signed thumbnail URL on
 * mount and falls back to a video-camera icon if no thumbnail exists
 * for the video.
 *
 * Props:
 *  - videoId
 *  - size: 'sm' (60x40) | 'md' (120x68) | 'lg' (160x90) | 'fill'.
 *    Default 'md'. The fixed sizes set width/height inline and are
 *    intended for inline use next to other content.
 *
 *    The 'fill' variant takes no intrinsic dimensions — the inner img
 *    fills its parent container with object-cover. The parent must
 *    establish both width and height (e.g. a wrapper with w-full and
 *    aspect-video for a 16:9 cell). Use this for grid/gallery layouts
 *    where the cell width is dictated by the layout, not the
 *    thumbnail's intrinsic size.
 *  - className: optional extra classes (passed to the rendered element)
 */
export default function VideoThumbnail({ videoId, size = 'md', className = '' }) {
  const [url, setUrl] = useState(() => urlCache.get(videoId) || null)
  const [loading, setLoading] = useState(!urlCache.has(videoId))

  useEffect(() => {
    if (urlCache.has(videoId)) {
      setUrl(urlCache.get(videoId))
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    fetchThumbnailUrl(videoId).then((u) => {
      if (cancelled) return
      setUrl(u)
      setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [videoId])

  const isFill = size === 'fill'

  // Fixed sizes carry inline width/height; fill mode delegates sizing to
  // the parent container so the thumbnail can stretch to fit a grid cell.
  const dimensionStyle = isFill
    ? undefined
    : size === 'sm'
      ? { width: 60, height: 40 }
      : size === 'lg'
        ? { width: 160, height: 90 }
        : { width: 120, height: 68 }

  // Container styling diverges by mode:
  //   - Fixed: flex-shrink-0 so neighboring flex children don't squash it,
  //     own rounded corners.
  //   - Fill: stretches to fill parent; parent owns the rounding (typical
  //     pattern is the parent button has rounded-md overflow-hidden, so
  //     we'd round here too and clip).
  const container = isFill
    ? `bg-slate-200 overflow-hidden flex items-center justify-center w-full h-full ${className}`
    : `bg-slate-200 rounded overflow-hidden flex items-center justify-center flex-shrink-0 ${className}`

  if (loading) {
    return (
      <div className={container} style={dimensionStyle}>
        <div className="w-4 h-4 border-2 border-slate-400 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  if (!url) {
    // Fallback icon — no thumbnail available
    return (
      <div className={container} style={dimensionStyle}>
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="w-6 h-6 text-slate-400"
        >
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="m22 8-6 4 6 4V8Z" />
        </svg>
      </div>
    )
  }

  if (isFill) {
    return (
      <img
        src={url}
        alt=""
        loading="lazy"
        className={`object-cover w-full h-full ${className}`}
      />
    )
  }

  return (
    <img
      src={url}
      alt=""
      loading="lazy"
      className={`rounded object-cover flex-shrink-0 ${className}`}
      style={dimensionStyle}
    />
  )
}
