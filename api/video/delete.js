import { S3Client, DeleteObjectCommand } from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/delete
 *
 * Body: { videoId }
 * Returns: { deleted: true }
 *
 * Deletes the video from both R2 (the actual file) and the videos
 * table (the metadata row). Auth required — only admins should be
 * deleting videos. If the R2 deletion fails we still proceed with
 * the DB deletion to avoid orphan rows; the R2 object then becomes
 * an orphan, but those can be cleaned later.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  // Validate session
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace('Bearer ', '')
  if (!token) {
    return res.status(401).json({ error: 'Missing auth token' })
  }
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: userData, error: userErr } = await supabase.auth.getUser(token)
  if (userErr || !userData?.user) {
    return res.status(401).json({ error: 'Invalid session' })
  }

  const { videoId } = req.body || {}
  if (!videoId) {
    return res.status(400).json({ error: 'videoId required' })
  }

  // Look up the video so we know what to delete from R2
  const { data: video, error: lookupErr } = await supabase
    .from('videos')
    .select('id, storage_path')
    .eq('id', videoId)
    .maybeSingle()
  if (lookupErr) {
    return res.status(500).json({ error: lookupErr.message })
  }
  if (!video) {
    return res.status(404).json({ error: 'Video not found' })
  }

  // Best-effort R2 delete. If it fails we log and continue.
  let r2DeleteWarning = null
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
        new DeleteObjectCommand({
          Bucket: process.env.R2_BUCKET_NAME,
          Key: video.storage_path,
        })
      )
    } catch (err) {
      console.error('R2 delete failed (continuing):', err)
      r2DeleteWarning = err.message
    }
  }

  // Delete the DB row
  const { error: dbErr } = await supabase
    .from('videos')
    .delete()
    .eq('id', videoId)
  if (dbErr) {
    return res.status(500).json({ error: dbErr.message })
  }

  return res.status(200).json({
    deleted: true,
    r2DeleteWarning,
  })
}
