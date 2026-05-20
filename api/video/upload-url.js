import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/upload-url
 *
 * Body: { gameId, filename, mimeType, sizeBytes }
 * Returns: { uploadUrl, videoId, storagePath, expiresIn }
 *
 * Mints a presigned PUT URL the browser uses to upload the file
 * directly to Cloudflare R2 — video bytes never touch Vercel.
 * Inserts a videos row with upload_status='uploading' which is
 * flipped to 'ready' once the client confirms the upload.
 *
 * Auth: requires a Supabase access token in the Authorization header.
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
  const userId = userData.user.id

  // Validate body
  const { gameId, filename, mimeType, sizeBytes } = req.body || {}
  if (!gameId || !filename || !mimeType) {
    return res.status(400).json({ error: 'gameId, filename, mimeType required' })
  }
  if (!mimeType.startsWith('video/')) {
    return res.status(400).json({ error: 'Only video files are allowed' })
  }
  const MAX_BYTES = 3 * 1024 * 1024 * 1024 // 3 GB
  if (sizeBytes && sizeBytes > MAX_BYTES) {
    return res.status(400).json({
      error: `File too large. Max 3 GB; this is ${(sizeBytes / 1e9).toFixed(2)} GB.`,
    })
  }

  // Validate game exists
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle()
  if (gameErr || !game) {
    return res.status(404).json({ error: 'Game not found' })
  }

  // Build storage path: games/<gameId>/<videoId>-<safeName>.<ext>
  const safeName = filename
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
  const ext = safeName.split('.').pop() || 'mp4'
  const baseName = safeName.replace(/\.[^.]+$/, '')

  // Insert videos row (status 'uploading')
  const { data: videoRow, error: vErr } = await supabase
    .from('videos')
    .insert([
      {
        game_id: gameId,
        storage_path: 'pending', // updated below
        title: baseName,
        mime_type: mimeType,
        file_size_bytes: sizeBytes || null,
        upload_status: 'uploading',
        uploaded_by: userId,
      },
    ])
    .select('id')
    .single()
  if (vErr || !videoRow) {
    return res.status(500).json({ error: 'Failed to create video record' })
  }
  const videoId = videoRow.id
  const storagePath = `games/${gameId}/${videoId}-${baseName}.${ext}`

  await supabase
    .from('videos')
    .update({ storage_path: storagePath })
    .eq('id', videoId)

  // Mint R2 presigned PUT URL
  const s3 = makeR2Client()
  const cmd = new PutObjectCommand({
    Bucket: process.env.R2_BUCKET_NAME,
    Key: storagePath,
    ContentType: mimeType,
  })
  const expiresIn = 60 * 60 // 1 hour
  const uploadUrl = await getSignedUrl(s3, cmd, { expiresIn })

  return res.status(200).json({
    uploadUrl,
    videoId,
    storagePath,
    expiresIn,
  })
}

function makeR2Client() {
  return new S3Client({
    region: 'auto',
    endpoint: `https://${process.env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
    },
  })
}
