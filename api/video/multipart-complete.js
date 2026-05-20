import {
  S3Client,
  CompleteMultipartUploadCommand,
} from '@aws-sdk/client-s3'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/multipart-complete
 *
 * Body: { videoId, uploadId, parts: [{partNumber, etag}, ...], durationSeconds? }
 * Returns: { completed: true }
 *
 * After the client uploads all chunks to R2, it sends the list of
 * partNumber/etag pairs here. We tell R2 to assemble the file and
 * flip the videos row to 'ready'.
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

  const { videoId, uploadId, parts, durationSeconds } = req.body || {}
  if (!videoId || !uploadId || !Array.isArray(parts) || parts.length === 0) {
    return res
      .status(400)
      .json({ error: 'videoId, uploadId, parts[] required' })
  }

  // Look up the videos row to get the storage_path
  const { data: video, error: lookupErr } = await supabase
    .from('videos')
    .select('id, storage_path, upload_status')
    .eq('id', videoId)
    .maybeSingle()
  if (lookupErr || !video) {
    return res.status(404).json({ error: 'Video not found' })
  }
  if (video.upload_status !== 'uploading') {
    return res
      .status(409)
      .json({ error: `Video not in uploading state (was ${video.upload_status})` })
  }

  // Sort parts by partNumber (R2 requires ascending order)
  const sortedParts = parts
    .slice()
    .sort((a, b) => a.partNumber - b.partNumber)
    .map((p) => ({ PartNumber: p.partNumber, ETag: p.etag }))

  // Complete the multipart upload on R2
  const s3 = new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
  try {
    await s3.send(
      new CompleteMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: video.storage_path,
        UploadId: uploadId,
        MultipartUpload: { Parts: sortedParts },
      })
    )
  } catch (err) {
    console.error('CompleteMultipartUpload failed:', err)
    await supabase
      .from('videos')
      .update({ upload_status: 'failed' })
      .eq('id', videoId)
    return res
      .status(500)
      .json({ error: `Failed to complete upload: ${err.message}` })
  }

  // Flip videos row to 'ready'
  const update = { upload_status: 'ready' }
  if (durationSeconds && isFinite(durationSeconds)) {
    update.duration_seconds = Math.round(durationSeconds)
  }
  const { error: updErr } = await supabase
    .from('videos')
    .update(update)
    .eq('id', videoId)
  if (updErr) {
    console.error('Final videos update failed:', updErr)
  }

  return res.status(200).json({ completed: true })
}
