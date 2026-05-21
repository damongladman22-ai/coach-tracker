import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/thumbnail-upload-url
 *
 * Body: { videoId }
 * Returns: { uploadUrl, thumbnailPath, expiresIn }
 *
 * Mints a presigned PUT URL the client uses to upload a JPEG thumbnail
 * for an existing video. Storage path mirrors the video's path with a
 * '-thumb.jpg' suffix. The client updates videos.thumbnail_path after
 * successful upload.
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

  const { videoId } = req.body || {}
  if (!videoId) return res.status(400).json({ error: 'videoId required' })

  const { data: video, error } = await supabase
    .from('videos')
    .select('id, game_id, storage_path')
    .eq('id', videoId)
    .maybeSingle()
  if (error || !video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  // Derive thumbnail path from video path
  // games/{gameId}/{videoId}-{name}.{ext}  →  games/{gameId}/{videoId}-thumb.jpg
  const thumbnailPath = `games/${video.game_id}/${videoId}-thumb.jpg`

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: thumbnailPath,
    ContentType: 'image/jpeg',
  })
  const expiresIn = 15 * 60 // 15 minutes is plenty for a small JPEG upload
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn })

  return res.status(200).json({ uploadUrl, thumbnailPath, expiresIn })
}
