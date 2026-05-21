import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/thumbnail-urls
 *
 * Body: { videoIds: [string, ...] }
 * Returns: { urls: { [videoId]: url }, expiresAt }
 *
 * Mints signed GET URLs for multiple thumbnails in a single round trip.
 * Used when a page renders a list of game cards and needs all the
 * thumbnails at once. No auth required — signed URLs are the gate.
 *
 * Videos without a thumbnail_path are silently omitted from the result;
 * the client renders a fallback icon for those.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoIds } = req.body || {}
  if (!Array.isArray(videoIds) || videoIds.length === 0) {
    return res.status(400).json({ error: 'videoIds[] required' })
  }
  if (videoIds.length > 500) {
    return res.status(400).json({ error: 'Too many videoIds (max 500)' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: videos, error } = await supabase
    .from('videos')
    .select('id, thumbnail_path')
    .in('id', videoIds)
  if (error) {
    return res.status(500).json({ error: error.message })
  }

  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  const expiresIn = 60 * 60 // 1 hour — browser caches via <img> for the session

  const urls = {}
  await Promise.all(
    (videos || [])
      .filter((v) => v.thumbnail_path)
      .map(async (v) => {
        const cmd = new GetObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: v.thumbnail_path,
          ResponseContentType: 'image/jpeg',
        })
        urls[v.id] = await getSignedUrl(s3, cmd, { expiresIn })
      })
  )

  return res.status(200).json({
    urls,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  })
}
