import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/download-url
 *
 * Body: { videoId, filename?: string }
 * Returns: { url, expiresAt }
 *
 * Mints a signed GET URL with Content-Disposition: attachment so the
 * browser downloads the file instead of streaming it inline.
 *
 * If `filename` is provided, that's used as the suggested filename for
 * the download. Otherwise the stored title is used. Falls back to
 * "video.mp4" if neither is available.
 */
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' })
  }

  const { videoId, filename } = req.body || {}
  if (!videoId) {
    return res.status(400).json({ error: 'videoId required' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )
  const { data: video, error } = await supabase
    .from('videos')
    .select('id, storage_path, upload_status, mime_type, title')
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

  // Determine extension from mime type
  const ext = mimeToExt(video.mime_type) || 'mp4'
  const baseName = (filename || video.title || 'video').replace(
    /[^a-zA-Z0-9._-]/g,
    '-'
  )
  const finalName = baseName.toLowerCase().endsWith(`.${ext}`)
    ? baseName
    : `${baseName}.${ext}`

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
    ResponseContentDisposition: `attachment; filename="${finalName}"`,
    ResponseContentType: video.mime_type || 'video/mp4',
  })
  const expiresIn = 60 * 60 // 1 hour
  const url = await getSignedUrl(s3, cmd, { expiresIn })

  return res.status(200).json({
    url,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
  })
}

function mimeToExt(mime) {
  if (!mime) return null
  const map = {
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/x-msvideo': 'avi',
    'video/webm': 'webm',
    'video/x-matroska': 'mkv',
  }
  return map[mime] || null
}
