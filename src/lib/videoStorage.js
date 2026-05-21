import { supabase } from './supabase'

/**
 * Client-side wrappers around the /api/video/* endpoints.
 *
 * The flow:
 *   1. requestUploadUrl(gameId, file) – mints a presigned PUT URL and a
 *      videos row in 'uploading' state. Returns { uploadUrl, videoId }.
 *   2. uploadToStorage(uploadUrl, file, onProgress) – PUTs the bytes
 *      directly to R2. Vercel is bypassed for the byte transfer.
 *   3. markVideoReady(videoId) – flips the row to 'ready'.
 *
 * Playback:
 *   getPlaybackUrl(videoId) – returns a short-lived signed GET URL.
 */

async function authHeader() {
  const {
    data: { session },
  } = await supabase.auth.getSession()
  if (!session) throw new Error('Not signed in')
  return { Authorization: `Bearer ${session.access_token}` }
}

export async function requestUploadUrl(gameId, file) {
  const headers = await authHeader()
  const res = await fetch('/api/video/upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      gameId,
      filename: file.name,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Upload URL request failed (${res.status})`)
  }
  return res.json()
}

/**
 * Upload the file directly to R2 with progress reporting.
 * Uses XMLHttpRequest because fetch doesn't expose upload progress.
 */
export function uploadToStorage(uploadUrl, file, onProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', uploadUrl)
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onProgress) {
        onProgress(e.loaded / e.total)
      }
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve()
      } else {
        reject(new Error(`Upload failed (${xhr.status}): ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error during upload'))
    xhr.send(file)
  })
}

export async function markVideoReady(videoId, durationSeconds) {
  const update = { upload_status: 'ready' }
  if (durationSeconds) update.duration_seconds = Math.round(durationSeconds)
  const { error } = await supabase
    .from('videos')
    .update(update)
    .eq('id', videoId)
  if (error) throw error
}

export async function markVideoFailed(videoId) {
  await supabase
    .from('videos')
    .update({ upload_status: 'failed' })
    .eq('id', videoId)
}

export async function getPlaybackUrl(videoId) {
  const res = await fetch('/api/video/playback-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Playback URL request failed (${res.status})`)
  }
  return res.json()
}

export async function getDownloadUrl(videoId, filename) {
  const res = await fetch('/api/video/download-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoId, filename }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Download URL request failed (${res.status})`)
  }
  return res.json()
}

/**
 * Build a human-friendly download filename from game context.
 * Example: "2026-05-15-u16-girls-ecnl-vs-fc-united"
 */
export function buildVideoFilename(game, teamName) {
  const parts = []
  if (game?.game_date) parts.push(game.game_date) // already YYYY-MM-DD
  if (teamName) parts.push(slugify(teamName))
  const homeAway = game?.is_home ? 'vs' : 'at'
  if (game?.opponent) parts.push(`${homeAway}-${slugify(game.opponent)}`)
  return parts.join('-') || 'game-video'
}

function slugify(s) {
  return String(s)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export async function deleteVideo(videoId) {
  // Calls /api/video/delete which removes both the R2 object and the DB row.
  const headers = await authHeader()
  const res = await fetch('/api/video/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ videoId }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Delete failed (${res.status})`)
  }
  return res.json()
}

// ============================================================
// Multipart upload — for files >= MULTIPART_THRESHOLD
// ============================================================

export const MULTIPART_THRESHOLD = 100 * 1024 * 1024 // 100 MB
export const PART_SIZE = 250 * 1024 * 1024 // 250 MB
const MAX_CONCURRENCY = 6
const MAX_PART_RETRIES = 3

/**
 * Initiate a multipart upload. Server creates the multipart upload on
 * R2 and returns presigned URLs for each part, plus a videoId and
 * uploadId for completion/abort.
 */
export async function requestMultipartUpload(gameId, file) {
  const partCount = Math.ceil(file.size / PART_SIZE)
  const headers = await authHeader()
  const res = await fetch('/api/video/multipart-init', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({
      gameId,
      filename: file.name,
      mimeType: file.type || 'video/mp4',
      sizeBytes: file.size,
      partCount,
    }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Init failed (${res.status})`)
  }
  return res.json()
}

/**
 * Upload all parts in parallel (with concurrency cap) and retry each
 * part up to MAX_PART_RETRIES times with exponential backoff.
 *
 * onProgress receives a value 0..1 representing total bytes uploaded
 * over total bytes.
 *
 * Returns: [{ partNumber, etag }, ...] in part-number order.
 */
export async function uploadMultipartParts(
  partUrls,
  file,
  partSize,
  onProgress
) {
  const totalSize = file.size
  const partProgress = new Array(partUrls.length).fill(0)
  const results = new Array(partUrls.length)
  let nextIndex = 0
  let aborted = false

  const reportProgress = () => {
    const uploaded = partProgress.reduce((a, b) => a + b, 0)
    onProgress && onProgress(Math.min(uploaded / totalSize, 1))
  }

  async function uploadOnePart(index) {
    const { partNumber, url } = partUrls[index]
    const start = index * partSize
    const end = Math.min(start + partSize, totalSize)
    const blob = file.slice(start, end)
    const partBytes = end - start

    let lastErr
    for (let attempt = 1; attempt <= MAX_PART_RETRIES; attempt++) {
      if (aborted) throw new Error('Aborted')
      try {
        const etag = await uploadOnePartOnce(url, blob, (bytesSent) => {
          partProgress[index] = bytesSent
          reportProgress()
        })
        // Mark this part as 100% complete (in case the XHR didn't report final progress)
        partProgress[index] = partBytes
        reportProgress()
        return { partNumber, etag }
      } catch (err) {
        lastErr = err
        partProgress[index] = 0
        reportProgress()
        // Exponential backoff: 1s, 2s, 4s
        if (attempt < MAX_PART_RETRIES) {
          await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt - 1)))
        }
      }
    }
    throw lastErr || new Error('Part upload failed')
  }

  // Worker pool: each worker grabs the next index until exhausted
  const workers = Array.from(
    { length: Math.min(MAX_CONCURRENCY, partUrls.length) },
    async () => {
      while (true) {
        const i = nextIndex++
        if (i >= partUrls.length) return
        if (aborted) return
        try {
          results[i] = await uploadOnePart(i)
        } catch (err) {
          aborted = true
          throw err
        }
      }
    }
  )

  await Promise.all(workers)

  if (results.some((r) => !r)) {
    throw new Error('Some parts failed to upload')
  }
  return results
}

/**
 * PUT one part to its presigned URL via XHR (so we get upload progress).
 * Resolves with the part's ETag (cleaned of surrounding quotes).
 */
function uploadOnePartOnce(url, blob, onPartProgress) {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', url)
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && onPartProgress) onPartProgress(e.loaded)
    }
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        let etag = xhr.getResponseHeader('ETag') || xhr.getResponseHeader('etag')
        if (!etag) {
          reject(new Error('Missing ETag on part response'))
          return
        }
        // Strip surrounding quotes — R2/AWS returns "abc123" with quotes
        etag = etag.replace(/^"|"$/g, '')
        resolve(etag)
      } else {
        reject(new Error(`Part HTTP ${xhr.status}: ${xhr.responseText}`))
      }
    }
    xhr.onerror = () => reject(new Error('Network error on part upload'))
    xhr.send(blob)
  })
}

/**
 * Tell the server all parts are uploaded; the server then tells R2 to
 * assemble them and flips the videos row to 'ready'.
 */
export async function completeMultipartUpload(
  videoId,
  uploadId,
  parts,
  durationSeconds
) {
  const headers = await authHeader()
  const res = await fetch('/api/video/multipart-complete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify({ videoId, uploadId, parts, durationSeconds }),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `Complete failed (${res.status})`)
  }
  return res.json()
}

/**
 * Cancel an in-progress upload — cleans up partial chunks on R2 and
 * removes the half-built videos row.
 */
export async function abortMultipartUpload(videoId, uploadId) {
  try {
    const headers = await authHeader()
    await fetch('/api/video/multipart-abort', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ videoId, uploadId }),
    })
  } catch (err) {
    console.error('Abort failed (best-effort):', err)
  }
}

// ============================================================
// Thumbnails
// ============================================================

/**
 * Extract a still-frame thumbnail from a video file or URL using the
 * browser's <video> element + <canvas>. Returns a JPEG Blob (~30-80KB).
 *
 * For Files: pass the File directly (used during upload flow).
 * For URLs: pass a signed playback URL (used for backfill of existing
 * videos). The video element streams only what it needs via HTTP range
 * requests — does NOT download the whole video to extract one frame.
 *
 * Returns null if extraction fails (codec issues, taint, etc.) — caller
 * should handle gracefully.
 */
export function extractVideoThumbnail(fileOrUrl, options = {}) {
  const { seekFraction = 0.1, maxWidth = 640, quality = 0.8 } = options

  return new Promise((resolve) => {
    const video = document.createElement('video')
    video.preload = 'metadata'
    video.muted = true
    video.playsInline = true

    let objectUrl = null
    if (typeof fileOrUrl === 'string') {
      video.crossOrigin = 'anonymous'
      video.src = fileOrUrl
    } else {
      objectUrl = URL.createObjectURL(fileOrUrl)
      video.src = objectUrl
    }

    const cleanup = () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
    const fail = (reason) => {
      console.warn('Thumbnail extraction failed:', reason)
      cleanup()
      resolve(null)
    }

    let seeked = false

    video.addEventListener('loadedmetadata', () => {
      if (!isFinite(video.duration) || video.duration === 0) {
        // Some streams report 0 duration but still play; try a small seek
        video.currentTime = 1.0
      } else {
        video.currentTime = Math.max(0.5, video.duration * seekFraction)
      }
    })

    video.addEventListener('seeked', () => {
      if (seeked) return
      seeked = true
      try {
        const canvas = document.createElement('canvas')
        let w = video.videoWidth
        let h = video.videoHeight
        if (!w || !h) {
          fail('zero video dimensions')
          return
        }
        if (w > maxWidth) {
          h = Math.round((maxWidth / w) * h)
          w = maxWidth
        }
        canvas.width = w
        canvas.height = h
        const ctx = canvas.getContext('2d')
        ctx.drawImage(video, 0, 0, w, h)
        canvas.toBlob(
          (blob) => {
            cleanup()
            if (blob) resolve(blob)
            else fail('canvas toBlob returned null')
          },
          'image/jpeg',
          quality
        )
      } catch (err) {
        fail(err.message || String(err))
      }
    })

    video.addEventListener('error', () => fail('video element error'))

    // Safety net: if extraction hangs for more than 30 seconds, give up
    setTimeout(() => {
      if (!seeked) fail('timeout')
    }, 30000)
  })
}

/**
 * Upload a thumbnail Blob for an existing video. Mints a signed PUT URL
 * for the thumbnail path, uploads the Blob, then patches the videos
 * row to set thumbnail_path. Returns the storage path on success, null
 * on any failure (thumbnail upload is best-effort, never block on it).
 */
export async function uploadThumbnail(videoId, blob) {
  try {
    const headers = await authHeader()
    const res = await fetch('/api/video/thumbnail-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ videoId }),
    })
    if (!res.ok) throw new Error(`thumbnail-upload-url ${res.status}`)
    const { uploadUrl, thumbnailPath } = await res.json()

    const putRes = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: blob,
    })
    if (!putRes.ok) throw new Error(`R2 PUT ${putRes.status}`)

    const { error } = await supabase
      .from('videos')
      .update({ thumbnail_path: thumbnailPath })
      .eq('id', videoId)
    if (error) throw error

    return thumbnailPath
  } catch (err) {
    console.warn('Thumbnail upload failed (non-fatal):', err)
    return null
  }
}

/**
 * Generate + upload a thumbnail for a fresh video file. Used immediately
 * after upload completes. Best-effort: failures are logged and ignored.
 */
export async function generateAndUploadThumbnailFromFile(videoId, file) {
  const blob = await extractVideoThumbnail(file)
  if (!blob) return null
  return uploadThumbnail(videoId, blob)
}

/**
 * Generate + upload a thumbnail for an existing video by streaming it
 * from R2 via a signed URL. Used for backfill of videos uploaded before
 * thumbnails existed.
 */
export async function generateAndUploadThumbnailFromExisting(videoId) {
  try {
    const { url } = await getPlaybackUrl(videoId)
    const blob = await extractVideoThumbnail(url)
    if (!blob) return null
    return await uploadThumbnail(videoId, blob)
  } catch (err) {
    console.warn('Backfill thumbnail failed:', err)
    return null
  }
}

/**
 * Batch fetch signed thumbnail URLs for a set of videoIds.
 * Returns { [videoId]: url }. Videos without thumbnails are omitted.
 */
export async function getThumbnailUrls(videoIds) {
  if (!videoIds || videoIds.length === 0) return {}
  const res = await fetch('/api/video/thumbnail-urls', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ videoIds }),
  })
  if (!res.ok) {
    console.warn('Thumbnail URLs request failed:', res.status)
    return {}
  }
  const { urls } = await res.json()
  return urls || {}
}

/**
 * Try to read video duration from a file (client-side, using a hidden
 * <video> element). Returns null if it fails.
 */
export function probeVideoDuration(file) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file)
    const v = document.createElement('video')
    v.preload = 'metadata'
    v.onloadedmetadata = () => {
      const d = v.duration
      URL.revokeObjectURL(url)
      resolve(isFinite(d) ? d : null)
    }
    v.onerror = () => {
      URL.revokeObjectURL(url)
      resolve(null)
    }
    v.src = url
  })
}
