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

export async function deleteVideo(videoId) {
  // For MVP we just delete the DB row. The R2 file stays orphaned but
  // takes negligible space; a future cleanup job can sweep them.
  // Direct R2 deletion would require another /api endpoint.
  const { error } = await supabase.from('videos').delete().eq('id', videoId)
  if (error) throw error
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
