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
