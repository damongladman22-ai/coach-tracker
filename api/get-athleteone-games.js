import { createClient } from '@supabase/supabase-js'

/**
 * GET /api/get-athleteone-games?teamId=N
 *
 * Returns the games AthleteOne has on file for one team (parsed from the
 * club-schedule endpoint, scoped to the team's data-team-id). Used by the
 * Game Dedup tool to compare manual vs AthleteOne game lists side-by-side.
 *
 * Read-only — does not write anything to the database.
 */
export default async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Auth: admin JWT only (no INGEST_SECRET fallback — this is a UI endpoint).
  const auth = await checkAdminJwt(supabase, req)
  if (!auth.ok) {
    return res.status(401).json({
      error: 'Unauthorized: ' + auth.reason,
      detail: auth.detail || null,
    })
  }

  const teamId = parseInt(req.query.teamId, 10)
  if (!teamId) {
    return res.status(400).json({ error: 'teamId query param required' })
  }

  // Look up the team's AthleteOne IDs
  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .select(
      'id, name, athleteone_org_id, athleteone_event_id, athleteone_club_id, athleteone_team_id'
    )
    .eq('id', teamId)
    .maybeSingle()

  if (teamErr) return res.status(500).json({ error: teamErr.message })
  if (!team) return res.status(404).json({ error: 'Team not found' })
  if (!team.athleteone_team_id) {
    return res.status(400).json({
      error: 'Team has no AthleteOne ID configured',
    })
  }

  // Fetch the team-info HTML — same source as the main ingest. Has scores,
  // explicit H/A markers, AND tournament games that aren't in the conference
  // schedule.
  const url =
    'https://api.athleteone.com/api/Script/get-individual-team-info/' +
    team.athleteone_org_id +
    '/' +
    team.athleteone_event_id +
    '/' +
    team.athleteone_club_id +
    '/' +
    team.athleteone_team_id

  let resp
  try {
    resp = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://theecnl.com/',
        Origin: 'https://theecnl.com',
        Accept: '*/*',
      },
    })
  } catch (err) {
    return res
      .status(502)
      .json({ error: 'Fetch failed: ' + (err.message || String(err)) })
  }

  if (!resp.ok) {
    return res
      .status(502)
      .json({ error: 'Team-info fetch failed: HTTP ' + resp.status })
  }

  const html = await resp.text()
  const games = parseGamesFromTeamInfo(html, String(team.athleteone_team_id))

  return res.status(200).json({
    team_id: team.id,
    name: team.name,
    games: games,
    count: games.length,
  })
}

// === Auth helper (JWT-only, slim version) ==========================
async function checkAdminJwt(supabase, req) {
  if (
    !process.env.VITE_SUPABASE_URL ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    return { ok: false, reason: 'env-missing' }
  }

  const authHeader = req.headers.authorization || ''
  const token = authHeader.startsWith('Bearer ')
    ? authHeader.slice(7)
    : null
  if (!token) return { ok: false, reason: 'no-token' }

  let userData, userError
  try {
    const result = await supabase.auth.getUser(token)
    userData = result.data
    userError = result.error
  } catch (err) {
    return { ok: false, reason: 'jwt-verify-threw', detail: err.message }
  }
  if (userError) {
    return { ok: false, reason: 'jwt-invalid', detail: userError.message }
  }
  const userEmail = (userData?.user?.email || '').toLowerCase()
  if (!userEmail) return { ok: false, reason: 'no-email-in-jwt' }

  const { data: admins, error: adminErr } = await supabase
    .from('allowed_admins')
    .select('email')
  if (adminErr) {
    return {
      ok: false,
      reason: 'admin-query-failed',
      detail: adminErr.message,
    }
  }
  const match = (admins || []).find(
    (a) => (a.email || '').toLowerCase() === userEmail
  )
  if (!match) {
    return {
      ok: false,
      reason: 'not-in-allowed-admins',
      detail: 'user=' + userEmail,
    }
  }
  return { ok: true, email: userEmail }
}

// === Parser (DUPLICATED from ingest-athleteone.js) ==================
// Keeping this in sync with the ingest version is important. If you find a
// parser bug, fix it here AND in api/ingest-athleteone.js.
function parseGamesFromTeamInfo(html, ourTeamIdStr) {
  const games = []
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = trRe.exec(html)) !== null) {
    const tr = m[1]
    const gmMatch = tr.match(/#(\d{6,7})/)
    const dateMatch = tr.match(
      /<div[^>]*>([A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})<\/div>/
    )
    if (!gmMatch || !dateMatch) continue

    const haMatch = tr.match(/<div[^>]*>([AH])<\/div>/)
    const isHome = haMatch && haMatch[1] === 'H'

    const timeMatch = tr.match(/<div[^>]*>(\d{1,2}:\d{2}\s+[AP]M)<\/div>/)

    const oppMatch = tr.match(
      /<span\s+class="individual-team-item"[^>]*data-team-id="(\d+)"[^>]*>([^<]+)<\/span>/i
    )

    const venueMatch = tr.match(
      /<span\s+class="game-complex-item"[^>]*>([\s\S]*?)<\/span>/i
    )

    const scoreMatch = tr.match(
      /(Win|Loss|Draw)_Icon\.png[^>]*\/>\s*<span>(\d+)\s*-\s*(\d+)<\/span>/i
    )

    games.push({
      athleteone_game_id: parseInt(gmMatch[1], 10),
      game_date: parseTeamInfoDate(dateMatch[1]),
      game_time: timeMatch ? parseTeamInfoTime(timeMatch[1]) : null,
      opponent: oppMatch ? oppMatch[2].trim() : null,
      opponent_team_id: oppMatch ? oppMatch[1] : null,
      is_home: isHome,
      location: venueMatch
        ? venueMatch[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
        : null,
      our_score: scoreMatch ? parseInt(scoreMatch[2], 10) : null,
      opponent_score: scoreMatch ? parseInt(scoreMatch[3], 10) : null,
      athleteone_result: scoreMatch ? scoreMatch[1].toLowerCase() : null,
    })
  }
  return games
}

function parseTeamInfoDate(s) {
  const months = {
    Jan: '01', Feb: '02', Mar: '03', Apr: '04', May: '05', Jun: '06',
    Jul: '07', Aug: '08', Sep: '09', Oct: '10', Nov: '11', Dec: '12',
  }
  const m = s.match(/([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/)
  if (!m) return null
  return m[3] + '-' + (months[m[1]] || '01') + '-' + String(m[2]).padStart(2, '0')
}

function parseTeamInfoTime(s) {
  const m = s.match(/(\d{1,2}):(\d{2})\s+([AP]M)/i)
  if (!m) return null
  let h = parseInt(m[1], 10)
  const min = parseInt(m[2], 10)
  const ampm = m[3].toUpperCase()
  if (ampm === 'PM' && h !== 12) h += 12
  if (ampm === 'AM' && h === 12) h = 0
  return String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':00'
}
