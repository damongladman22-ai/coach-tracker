import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const authHeader = req.headers.authorization || ''
  const expected = 'Bearer ' + process.env.INGEST_SECRET
  if (!process.env.INGEST_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  const { data, error } = await supabase
    .from('teams')
    .select('id, name, athleteone_team_id, athleteone_event_id, athleteone_org_id, athleteone_club_id')
    .not('athleteone_team_id', 'is', null)

  if (error) {
    return res.status(500).json({ error: error.message })
  }

  return res.status(200).json({
    message: 'Minimal version works',
    teams: data,
  })
}
