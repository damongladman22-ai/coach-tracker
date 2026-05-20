import {
  S3Client,
  CreateMultipartUploadCommand,
  UploadPartCommand,
} from '@aws-sdk/client-s3'
import { getSignedUrl } from '@aws-sdk/s3-request-presigner'
import { createClient } from '@supabase/supabase-js'

/**
 * POST /api/video/multipart-init
 *
 * Body: { gameId, filename, mimeType, sizeBytes, partCount }
 * Returns: { videoId, uploadId, storagePath, partSize, partUrls: [{partNumber, url}], expiresIn }
 *
 * Initiates a multipart upload against R2 and mints presigned PUT URLs
 * for every part upfront. Client uploads parts in parallel, then calls
 * /api/video/multipart-complete with the resulting ETags.
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
  const userId = userData.user.id

  // Validate body
  const { gameId, filename, mimeType, sizeBytes, partCount } = req.body || {}
  if (!gameId || !filename || !mimeType || !sizeBytes || !partCount) {
    return res.status(400).json({
      error: 'gameId, filename, mimeType, sizeBytes, partCount required',
    })
  }
  if (!mimeType.startsWith('video/')) {
    return res.status(400).json({ error: 'Only video files are allowed' })
  }
  // R2 max: 5 TB per object, 10,000 parts. Client uses 100 MB parts.
  // Cap at 10,000 to be safe.
  const MAX_PARTS = 10000
  if (partCount < 1 || partCount > MAX_PARTS) {
    return res
      .status(400)
      .json({ error: `partCount must be between 1 and ${MAX_PARTS}` })
  }
  // R2 hard file limit is ~5 TB. Cap at 50 GB for sanity in MVP.
  const MAX_BYTES = 50 * 1024 * 1024 * 1024
  if (sizeBytes > MAX_BYTES) {
    return res.status(400).json({
      error: `File too large. Max 50 GB; this is ${(sizeBytes / 1e9).toFixed(2)} GB.`,
    })
  }

  // Validate game
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .select('id')
    .eq('id', gameId)
    .maybeSingle()
  if (gameErr || !game) {
    return res.status(404).json({ error: 'Game not found' })
  }

  // Build storage path
  const safeName = filename
    .toLowerCase()
    .replace(/[^a-z0-9.-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 100)
  const ext = safeName.split('.').pop() || 'mp4'
  const baseName = safeName.replace(/\.[^.]+$/, '')

  // Insert videos row in 'uploading' state
  const { data: videoRow, error: vErr } = await supabase
    .from('videos')
    .insert([
      {
        game_id: gameId,
        storage_path: 'pending',
        title: baseName,
        mime_type: mimeType,
        file_size_bytes: sizeBytes,
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

  // Create the multipart upload on R2
  const s3 = makeR2Client()
  let uploadId
  try {
    const createRes = await s3.send(
      new CreateMultipartUploadCommand({
        Bucket: process.env.R2_BUCKET_NAME,
        Key: storagePath,
        ContentType: mimeType,
      })
    )
    uploadId = createRes.UploadId
  } catch (err) {
    console.error('CreateMultipartUpload failed:', err)
    // Mark the videos row as failed so we don't leave it lingering
    await supabase
      .from('videos')
      .update({ upload_status: 'failed' })
      .eq('id', videoId)
    return res.status(500).json({ error: 'Failed to initiate upload' })
  }

  // Mint presigned URLs for each part
  const expiresIn = 6 * 60 * 60 // 6 hours — allow time for large uploads
  const partUrls = []
  for (let partNumber = 1; partNumber <= partCount; partNumber++) {
    const cmd = new UploadPartCommand({
      Bucket: process.env.R2_BUCKET_NAME,
      Key: storagePath,
      UploadId: uploadId,
      PartNumber: partNumber,
    })
    const url = await getSignedUrl(s3, cmd, { expiresIn })
    partUrls.push({ partNumber, url })
  }

  return res.status(200).json({
    videoId,
    uploadId,
    storagePath,
    partUrls,
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
