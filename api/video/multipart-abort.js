import { S3Client, AbortMultipartUploadCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/multipart-abort
 *
 * Body: { videoId, uploadId }
 * Returns: { aborted: true }
 *
 * Cancels an in-progress multipart upload. Tells R2 to discard the
 * partial chunks (no orphan storage), then deletes the videos row
 * so the canceled upload doesn't appear anywhere.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Auth
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) return res.status(401).json({ error: 'Missing auth token' })
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid session' })
  }

  const { videoId, uploadId } = req.body || {}
  if (!videoId || !uploadId) {
    return res.status(400).json({ error: 'videoId, uploadId required' })
  }

  const { data: video } = await supabase
    .from('videos')
    .select('id, storage_path')
    .eq('id', videoId)
    .maybeSingle()
  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  // Best-effort abort against R2 — if it fails (network, already aborted)
  // we still proceed to clean up the DB row.
  if (video.storage_path && video.storage_path !== 'pending') {
    try {
      const s3 = new S3Client({
        region: 'auto',
        endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: process.env.R2_ACCESS_KEY_ID,
          secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
        },
      })
      await s3.send(
        new AbortMultipartUploadCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: video.storage_path,
          UploadId: uploadId,
        })
      )
    } catch (err) {
      console.error('AbortMultipartUpload failed (continuing):', err)
    }
  }

  // Remove the half-built row
  await supabase.from('videos').delete().eq('id', videoId)

  return res.status(200).json({ aborted: true })
}
