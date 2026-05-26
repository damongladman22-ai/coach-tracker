import { createClient } from '@supabase/supabase-js'

const ATHLETEONE_BASE = 'https://api.athleteone.com/api/Script/get-individual-team-info'

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Auth — accept either INGEST_SECRET (cron/curl) or a Supabase admin JWT
  // (browser UI). Diagnostic version: on failure, returns a `reason` and
  // `detail` so we can see exactly which step rejected the request.
  const auth = await checkAdminAuth(supabase, req)
  if (!auth.ok) {
    return res.status(401).json({
      error: `Unauthorized: ${auth.reason}${auth.detail ? ' — ' + auth.detail : ''}`,
      reason: auth.reason,
      detail: auth.detail,
    })
  }

  const commit = String(req.query.commit || '').toLowerCase() === 'true'
  const teamFilter = req.query.teamId ? parseInt(req.query.teamId, 10) : null

  let q = supabase
    .from('teams')
    .select('id, name, athleteone_org_id, athleteone_event_id, athleteone_team_id, athleteone_club_id, athleteone_sync_games')
    .not('athleteone_team_id', 'is', null)
  if (teamFilter) q = q.eq('id', teamFilter)

  const { data: teams, error: teamsErr } = await q
  if (teamsErr) return res.status(500).json({ error: teamsErr.message })
  if (!teams || teams.length === 0) {
    return res.status(200).json({ message: 'No teams with AthleteOne IDs set', teams_processed: 0 })
  }

  const results = []

  // Schedule cache: key = "eventId:clubId", value = the HTML body of the
  // club-schedules endpoint. Cached so that when we sync multiple teams in
  // one call (e.g. immediately after bulk-create), we hit AthleteOne once
  // per club-event combo rather than once per team.
  const scheduleCache = new Map()

  for (const team of teams) {
    const url = ATHLETEONE_BASE + '/' + team.athleteone_org_id + '/' + team.athleteone_event_id + '/' + team.athleteone_club_id + '/' + team.athleteone_team_id

    try {
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://theecnl.com/',
          Origin: 'https://theecnl.com',
          Accept: '*/*',
        },
      })

      if (!response.ok) {
        results.push({ team_id: team.id, name: team.name, error: 'HTTP ' + response.status })
        continue
      }

      const html = await response.text()
      const standings = parseStandings(html)
      const players = parseRoster(html, 'players-table-content', 'player')
      const staff = parseRoster(html, 'staffs-table-content', 'staff')

      const summary = {
        team_id: team.id,
        name: team.name,
        bytes: html.length,
        parsed: {
          standings: standings,
          players_count: players.length,
          staff_count: staff.length,
          players_sample: players.slice(0, 3),
          staff_sample: staff.slice(0, 3),
        },
      }

      if (!commit) {
        summary.mode = 'dry-run'
        results.push(summary)
        continue
      }

      // Commit mode: write to DB
      const nowIso = new Date().toISOString()

      await supabase
        .from('teams')
        .update({ athleteone_metadata: standings, athleteone_last_synced_at: nowIso })
        .eq('id', team.id)

      // Deactivate-then-upsert pattern (avoids the complex .not().in() filter)
      await supabase
        .from('team_players')
        .update({ active: false, updated_at: nowIso })
        .eq('team_id', team.id)

      if (players.length > 0) {
        const playerRows = players.map((p, i) => ({
          team_id: team.id,
          athleteone_player_id: p.athleteone_player_id,
          last_name: p.last_name,
          first_name: p.first_name,
          position: p.position,
          grad_year: p.grad_year,
          jersey_number: p.jersey_number,
          photo_url: p.photo_url,
          active: true,
          sort_order: i,
          updated_at: nowIso,
        }))
        await supabase
          .from('team_players')
          .upsert(playerRows, { onConflict: 'team_id,athleteone_player_id' })
      }

      await supabase
        .from('team_staff')
        .update({ active: false, updated_at: nowIso })
        .eq('team_id', team.id)

      if (staff.length > 0) {
        const staffRows = staff.map((s, i) => ({
          team_id: team.id,
          athleteone_staff_id: s.athleteone_staff_id,
          last_name: s.last_name,
          first_name: s.first_name,
          title: s.title,
          email: s.email,
          photo_url: s.photo_url,
          active: true,
          sort_order: i,
          updated_at: nowIso,
        }))
        await supabase
          .from('team_staff')
          .upsert(staffRows, { onConflict: 'team_id,athleteone_staff_id' })
      }

      // === Games sync ===
      // Only runs when this team has athleteone_sync_games=TRUE. We fetch the
      // club-schedule endpoint (cached) and upsert games keyed on
      // athleteone_game_id. Rows flagged manual_override=TRUE are left alone.
      // Never deletes — even if a game disappears from AthleteOne, the row
      // stays so its attendance is preserved. Admin can delete manually.
      let gamesResult
      if (team.athleteone_sync_games) {
        gamesResult = await syncGames(supabase, team, scheduleCache)
      } else {
        gamesResult = 'sync disabled for this team'
      }

      summary.mode = 'committed'
      summary.committed = {
        players_upserted: players.length,
        staff_upserted: staff.length,
        games: gamesResult,
      }
      results.push(summary)
    } catch (err) {
      results.push({ team_id: team.id, name: team.name, error: err.message })
    }
  }

  return res.status(200).json({
    mode: commit ? 'committed' : 'dry-run',
    teams_processed: results.length,
    results: results,
  })
}

// Parse standings: <h3>Standings</h3> ... <table>...<tbody><tr><td>place</td><td>wins</td><td>losses</td><td>draws</td></tr>
function parseStandings(html) {
  const out = {
    record_w: null,
    record_l: null,
    record_t: null,
    standings_position: null,
    parse_warnings: [],
    synced_at: new Date().toISOString(),
  }

  const headingIdx = html.search(/<h3[^>]*>\s*Standings\s*<\/h3>/i)
  if (headingIdx === -1) {
    out.parse_warnings.push('No Standings heading')
    return out
  }

  const after = html.substring(headingIdx, headingIdx + 4000)
  const tableMatch = after.match(/<table[^>]*>([\s\S]*?)<\/table>/i)
  if (!tableMatch) {
    out.parse_warnings.push('No table after Standings')
    return out
  }

  const tbodyMatch = tableMatch[1].match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
  if (!tbodyMatch) {
    out.parse_warnings.push('No tbody')
    return out
  }

  const trMatch = tbodyMatch[1].match(/<tr[^>]*>([\s\S]*?)<\/tr>/i)
  if (!trMatch) {
    out.parse_warnings.push('No row')
    return out
  }

  const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi
  const cells = []
  let m
  while ((m = tdRegex.exec(trMatch[1])) !== null) {
    cells.push(stripTags(m[1]).trim())
  }

  if (cells.length < 4) {
    out.parse_warnings.push('Expected 4 cells, got ' + cells.length)
    return out
  }

  const placeMatch = cells[0].match(/^(\d+)/)
  if (placeMatch) out.standings_position = parseInt(placeMatch[1], 10)

  if (/^\d+$/.test(cells[1])) out.record_w = parseInt(cells[1], 10)
  if (/^\d+$/.test(cells[2])) out.record_l = parseInt(cells[2], 10)
  if (/^\d+$/.test(cells[3])) out.record_t = parseInt(cells[3], 10)

  return out
}

function parseRoster(html, tableId, kind) {
  const tablePattern = new RegExp('<table[^>]*id="' + tableId + '"[^>]*>([\\s\\S]*?)<\\/table>', 'i')
  const tableMatch = html.match(tablePattern)
  if (!tableMatch) return []

  const tableHtml = tableMatch[1]
  const rows = []
  const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
  let m
  while ((m = trRegex.exec(tableHtml)) !== null) {
    const rowHtml = m[1]
    if (/<th\b/i.test(rowHtml)) continue

    const imgMatch = rowHtml.match(/<img[^>]*src="([^"]+)"/i)
    const photoUrl = imgMatch ? imgMatch[1] : null

    const spans = []
    const spanRegex = /<span[^>]*>([\s\S]*?)<\/span>/g
    let sm
    while ((sm = spanRegex.exec(rowHtml)) !== null) {
      const txt = stripTags(sm[1]).trim()
      if (txt.length > 0) spans.push(txt)
    }

    if (spans.length < 2) continue

    const fullName = spans[0]
    const middle = spans[1] || ''
    const last = spans[2] || ''
    const trailing = spans[spans.length - 1] || ''

    const commaIdx = fullName.indexOf(',')
    if (commaIdx === -1) continue
    const lastName = fullName.substring(0, commaIdx).trim()
    const firstName = fullName.substring(commaIdx + 1).trim()
    if (!lastName || !firstName) continue

    const trailingId = trailing.replace(/^#/, '').trim()

    if (kind === 'player') {
      let aoId = null
      if (photoUrl) {
        const hashMatch = photoUrl.match(/_([a-f0-9]{32})\.[a-zA-Z]+$/i)
        if (hashMatch) aoId = hashMatch[1]
      }
      if (!aoId) {
        aoId = 'synth:' + normalize(lastName) + ':' + normalize(firstName) + ':' + (last || '0')
      }
      const gradYear = /^\d{4}$/.test(last) ? parseInt(last, 10) : null
      const jerseyNumber = /^\d+$/.test(trailingId) ? parseInt(trailingId, 10) : null

      rows.push({
        athleteone_player_id: aoId,
        last_name: lastName,
        first_name: firstName,
        position: middle || null,
        grad_year: gradYear,
        jersey_number: jerseyNumber,
        photo_url: photoUrl,
      })
    } else {
      const aoId = /^\d+$/.test(trailingId) ? trailingId : 'synth:' + normalize(lastName) + ':' + normalize(firstName)
      const isEmail = typeof last === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(last)

      rows.push({
        athleteone_staff_id: aoId,
        last_name: lastName,
        first_name: firstName,
        title: middle || null,
        email: isEmail ? last : null,
        photo_url: photoUrl,
      })
    }
  }
  return rows
}

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '')
}

function normalize(s) {
  return String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '')
}

/**
 * checkAdminAuth — diagnostic version.
 *
 * Returns one of:
 *   { ok: true,  kind: 'secret' }                         INGEST_SECRET match
 *   { ok: true,  kind: 'jwt', email }                     admin JWT validated
 *   { ok: false, reason: 'no-token' }                     no Authorization header
 *   { ok: false, reason: 'env-missing', detail }          Supabase env vars not set
 *   { ok: false, reason: 'jwt-verify-threw', detail }     getUser threw
 *   { ok: false, reason: 'jwt-invalid', detail }          getUser returned an error
 *   { ok: false, reason: 'no-user-in-jwt' }               getUser returned no user
 *   { ok: false, reason: 'no-email-in-jwt', detail }      user has no email
 *   { ok: false, reason: 'admin-query-failed', detail }   couldn't query allowed_admins
 *   { ok: false, reason: 'not-in-allowed-admins', detail } user email not whitelisted
 *
 * The detail field is safe to surface in the 401 response — it won't expose
 * secrets, only the user's own email and the list of admin emails (which the
 * user has access to via /admin/admins anyway).
 */
async function checkAdminAuth(supabase, req) {
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')

  if (!token) return { ok: false, reason: 'no-token' }

  // Path 1: INGEST_SECRET (cron / curl)
  if (process.env.INGEST_SECRET && token === process.env.INGEST_SECRET) {
    return { ok: true, kind: 'secret' }
  }

  if (!process.env.VITE_SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    return {
      ok: false,
      reason: 'env-missing',
      detail: 'VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set in Vercel',
    }
  }

  // Path 2: Supabase admin JWT
  let userData, userError
  try {
    const result = await supabase.auth.getUser(token)
    userData = result.data
    userError = result.error
  } catch (err) {
    return {
      ok: false,
      reason: 'jwt-verify-threw',
      detail: err.message || String(err),
    }
  }

  if (userError) {
    return {
      ok: false,
      reason: 'jwt-invalid',
      detail: userError.message || String(userError),
    }
  }
  if (!userData?.user) return { ok: false, reason: 'no-user-in-jwt' }
  if (!userData.user.email) {
    return {
      ok: false,
      reason: 'no-email-in-jwt',
      detail: `user.id=${userData.user.id}`,
    }
  }

  const userEmail = userData.user.email.toLowerCase()

  // Fetch all allowed_admins and compare in JS (case-insensitive). Bulletproof
  // against PostgREST ilike quirks and casing mismatches in the stored data.
  let admins, adminErr
  try {
    const result = await supabase.from('allowed_admins').select('email')
    admins = result.data
    adminErr = result.error
  } catch (err) {
    return {
      ok: false,
      reason: 'admin-query-failed',
      detail: err.message || String(err),
    }
  }

  if (adminErr) {
    return {
      ok: false,
      reason: 'admin-query-failed',
      detail: adminErr.message || String(adminErr),
    }
  }

  const match = (admins || []).find(
    (a) => (a.email || '').toLowerCase() === userEmail
  )
  if (!match) {
    return {
      ok: false,
      reason: 'not-in-allowed-admins',
      detail: `user=${userEmail}; admins_count=${admins?.length || 0}`,
    }
  }

  return { ok: true, kind: 'jwt', email: userEmail }
}

// === Games sync helpers ============================================
// Fetches the club-schedule HTML for the team's (event, club) tuple (using a
// shared cache so multiple teams in one call hit AthleteOne once), parses
// games involving the target team, and upserts them into the games table.
//
// Safety:
// - Upserts keyed on athleteone_game_id (partial unique index)
// - Never deletes — preserves attendance even if game disappears upstream
// - Skips rows with manual_override=TRUE so admin overrides stick
// - Scores NOT pulled (admin enters manually for completed games)
async function syncGames(supabase, team, scheduleCache) {
  const cacheKey = team.athleteone_event_id + ':' + team.athleteone_club_id
  let html = scheduleCache.get(cacheKey)

  if (!html) {
    const url =
      'https://api.athleteone.com/api/Script/get-club-schedules-by-eventID-and-clubID/' +
      team.athleteone_event_id +
      '/' +
      team.athleteone_club_id
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          Referer: 'https://theecnl.com/',
          Origin: 'https://theecnl.com',
          Accept: '*/*',
        },
      })
      if (!resp.ok) {
        return { error: 'Schedule fetch failed: HTTP ' + resp.status }
      }
      html = await resp.text()
      scheduleCache.set(cacheKey, html)
    } catch (err) {
      return { error: 'Schedule fetch error: ' + (err.message || String(err)) }
    }
  }

  const games = parseGames(html, String(team.athleteone_team_id))

  if (games.length === 0) {
    return {
      upserted: 0,
      skipped_override: 0,
      note: 'No games found for this team in schedule',
    }
  }

  // Find default League game type
  let defaultGameTypeId = null
  const { data: gameTypes } = await supabase
    .from('game_types')
    .select('id, name')
  if (gameTypes) {
    const league = gameTypes.find((gt) => /league/i.test(gt.name || ''))
    if (league) defaultGameTypeId = league.id
  }

  // Find which ao_game_ids have manual_override=TRUE so we skip them
  const aoIds = games.map((g) => g.athleteone_game_id).filter((id) => id != null)
  const overrideSet = new Set()
  if (aoIds.length > 0) {
    const { data: existing } = await supabase
      .from('games')
      .select('athleteone_game_id, manual_override')
      .in('athleteone_game_id', aoIds)
    if (existing) {
      for (const e of existing) {
        if (e.manual_override) overrideSet.add(e.athleteone_game_id)
      }
    }
  }

  const upsertRows = games
    .filter((g) => !overrideSet.has(g.athleteone_game_id))
    .map((g) => ({
      team_id: team.id,
      athleteone_game_id: g.athleteone_game_id,
      game_date: g.game_date,
      game_time: g.game_time,
      opponent: g.opponent,
      is_home: g.is_home,
      location: g.location,
      game_type_id: defaultGameTypeId,
      source: 'athleteone',
      timezone: 'America/New_York',
    }))

  if (upsertRows.length === 0) {
    return {
      upserted: 0,
      skipped_override: overrideSet.size,
      total_in_schedule: games.length,
    }
  }

  const { error: upErr } = await supabase
    .from('games')
    .upsert(upsertRows, { onConflict: 'athleteone_game_id' })
  if (upErr) {
    return { error: 'Upsert failed: ' + upErr.message }
  }

  return {
    upserted: upsertRows.length,
    skipped_override: overrideSet.size,
    total_in_schedule: games.length,
  }
}

// Parse all games from the club-schedule HTML. Returns games where the target
// team appears as one of the two participants. Determines home/away by
// position: first <span class="individual-team-item"> in the row = home.
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
  // GM# — first <div> containing only digits
  let gmId = null
  const gmMatch = rowHtml.match(/<div[^>]*>\s*(\d+)\s*<\/div>/i)
  if (gmMatch) gmId = parseInt(gmMatch[1], 10)

  // Date — "Mon DD, YYYY"
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

  // Time — "HH:MM AM/PM"
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

  // Team spans (first listed = home, second = away)
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

  // Venue (game-complex-item span). The text may contain a nested <span> for
  // the separator ("Rossford<span> - </span>Indoor"), so we capture all the
  // way to the closing </td> of the cell and strip tags. The game-complex-item
  // is always the last content in its cell, so this is safe.
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
