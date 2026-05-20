import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/playback-url
 *
 * Body: { videoId }
 * Returns: { url, expiresAt }
 *
 * Mints a short-lived signed GET URL the browser uses in <video src>.
 * No auth required — the time-limited URL is the gate.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoId } = req.body || {}
  if (!videoId) {
    return res.status(400).json({ error: 'videoId required' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, storage_path, upload_status, mime_type')
    .eq('id', videoId)
    .maybeSingle()
  if (error || !video) {
    return res.status(404).json({ error: 'Video not found' })
  }
  if (video.upload_status !== 'ready') {
    return res
      .status(409)
      .json({ error: `Video is not ready (status: ${video.upload_status})` })
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  const cmd = new GetObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: video.storage_path,
    ResponseContentType: video.mime_type || 'video/mp4',
  })
  const expiresIn = 60 * 60 // 1 hour
  const url = await getSignedUrl(s3, cmd, { expiresIn })

  return res.status(200).json({
    url,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  })
}
