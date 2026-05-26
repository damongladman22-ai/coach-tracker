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
      'id, name, athleteone_event_id, athleteone_club_id, athleteone_team_id'
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

  // Fetch the club-schedule HTML
  const url =
    'https://api.athleteone.com/api/Script/get-club-schedules-by-eventID-and-clubID/' +
    team.athleteone_event_id +
    '/' +
    team.athleteone_club_id

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
      .json({ error: 'Schedule fetch failed: HTTP ' + resp.status })
  }

  const html = await resp.text()
  const games = parseGames(html, String(team.athleteone_team_id))

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
function parseGames(html, ourTeamIdStr) {
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
  if (!tbodyMatch) return []

  const tbody = tbodyMatch[1]
  const rows = []
  const trRe = /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi
  let m
  while ((m = trRe.exec(tbody)) !== null) {
    rows.push(m[1])
  }

  const games = []
  for (const row of rows) {
    const g = parseGameRow(row, ourTeamIdStr)
    if (g) games.push(g)
  }
  return games
}

function parseGameRow(rowHtml, ourTeamIdStr) {
  let gmId = null
  const gmMatch = rowHtml.match(/<div[^>]*>\s*(\d+)\s*<\/div>/i)
  if (gmMatch) gmId = parseInt(gmMatch[1], 10)

  let gameDate = null
  const dateMatch = rowHtml.match(
    /(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+(\d{1,2}),\s+(\d{4})/i
  )
  if (dateMatch) {
    const months = {
      jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06',
      jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
    }
    const month = months[dateMatch[1].toLowerCase().slice(0, 3)] || '01'
    const day = String(dateMatch[2]).padStart(2, '0')
    gameDate = dateMatch[3] + '-' + month + '-' + day
  }

  let gameTime = null
  const timeMatch = rowHtml.match(/\b(\d{1,2}):(\d{2})\s+(AM|PM)\b/i)
  if (timeMatch) {
    let h = parseInt(timeMatch[1], 10)
    const min = parseInt(timeMatch[2], 10)
    const ampm = timeMatch[3].toUpperCase()
    if (ampm === 'PM' && h !== 12) h += 12
    if (ampm === 'AM' && h === 12) h = 0
    gameTime =
      String(h).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ':00'
  }

  const teamSpanRe =
    /<span\s+class="individual-team-item"([^>]*)>([^<]+)<\/span>/gi
  const teams = []
  let tm
  while ((tm = teamSpanRe.exec(rowHtml)) !== null) {
    const attrs = tm[1]
    const text = tm[2].trim()
    const teamId = extractAttrSimple(attrs, 'data-team-id')
    teams.push({ team_id: teamId, name: text })
  }
  if (teams.length < 2) return null

  const ourIdx = teams.findIndex((t) => t.team_id === ourTeamIdStr)
  if (ourIdx < 0) return null

  const opponent = teams[1 - ourIdx]
  const isHome = ourIdx === 0

  let location = null
  const venueMatch = rowHtml.match(
    /<span\s+class="game-complex-item"[^>]*>([\s\S]*?)<\/td>/i
  )
  if (venueMatch) {
    location = venueMatch[1]
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  return {
    athleteone_game_id: gmId,
    game_date: gameDate,
    game_time: gameTime,
    opponent: opponent.name,
    is_home: isHome,
    location: location,
  }
}

function extractAttrSimple(attrs, name) {
  const re = new RegExp(name + '="([^"]*)"', 'i')
  const m = attrs.match(re)
  return m ? m[1] : null
}
