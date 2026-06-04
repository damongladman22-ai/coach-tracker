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
  const listOnly = String(req.query.list_only || '').toLowerCase() === 'true'
  const probeMode = String(req.query.probe || '').toLowerCase() === 'true'

  // PROBE MODE: brute-force search for the best (org_id, season_id) pair
  // for a given team. Doesn't sync — just reports the winning pair so we
  // can add it to KNOWN_STANDINGS_PAIRS. Required for programs (RL,
  // Pre-ECNL) whose constants we don't yet know.
  //
  // Usage:
  //   GET /api/ingest-athleteone?probe=true&teamId=N
  //
  // Strategy:
  //   1. Use existing discovery to find ANY working pair (gets us an
  //      age_group_id where this team appears).
  //   2. Brute-probe (org, season) over a wider grid keeping age_group_id
  //      fixed. Each call cheap because age_group_id is set.
  //   3. Score each by populated qualifications. Best wins.
  if (probeMode) {
    if (!teamFilter) {
      return res.status(400).json({ error: 'probe mode requires teamId' })
    }
    const { data: team } = await supabase
      .from('teams')
      .select('id, name, athleteone_event_id, athleteone_team_id, athleteone_age_group_id, athleteone_standings_org_id, athleteone_standings_season_id')
      .eq('id', teamFilter)
      .single()
    if (!team) {
      return res.status(404).json({ error: 'team not found' })
    }
    if (!team.athleteone_event_id || !team.athleteone_team_id) {
      return res.status(400).json({ error: 'team missing event/team id' })
    }
    const probeResult = await probeBestStandingsPair(team)
    return res.status(200).json({
      team_id: team.id,
      name: team.name,
      event_id: team.athleteone_event_id,
      athleteone_team_id: team.athleteone_team_id,
      ...probeResult,
    })
  }

  let q = supabase
    .from('teams')
    .select('id, name, club_id, season_id, athleteone_org_id, athleteone_event_id, athleteone_team_id, athleteone_club_id, athleteone_age_group_id, athleteone_standings_org_id, athleteone_standings_season_id, athleteone_sync_games')
    .not('athleteone_team_id', 'is', null)
  if (teamFilter) q = q.eq('id', teamFilter)

  const { data: teams, error: teamsErr } = await q
  if (teamsErr) return res.status(500).json({ error: teamsErr.message })
  if (!teams || teams.length === 0) {
    return res.status(200).json({ message: 'No teams with AthleteOne IDs set', teams_processed: 0 })
  }

  // list_only mode: return the team list (id + name) without syncing. Used by
  // the nightly GitHub Actions workflow to fetch the list of teams it should
  // iterate through, since each per-team sync fits well within Vercel Hobby's
  // 10s function timeout but the full bulk loop would not.
  if (listOnly) {
    return res.status(200).json({
      teams: teams.map((t) => ({ id: t.id, name: t.name })),
      count: teams.length,
    })
  }

  const results = []

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

      // Conference standings enrichment. Calls the separate
      // get-conference-standings endpoint and merges the full league
      // table into the team's athleteone_metadata. Errors are non-fatal
      // — standings is enrichment, not critical-path data. The discovered
      // age_group_id is persisted only in commit mode.
      const conferenceResult = await syncConferenceStandings(
        supabase,
        team,
        commit
      )
      if (conferenceResult.ok) {
        standings.conference_standings = conferenceResult.standings
        standings.conference_age_group_id = conferenceResult.age_group_id
        standings.conference_org_id = conferenceResult.org_id
        standings.conference_season_id = conferenceResult.season_id
        standings.conference_synced_at = new Date().toISOString()
      } else {
        standings.parse_warnings = standings.parse_warnings || []
        standings.parse_warnings.push(
          'conference standings: ' + conferenceResult.reason
        )
      }

      // Build a known_opponents map for opponent enrichment in the UI.
      // Conference opponents (rich data: place, record, ppg, logo) come
      // from conference_standings; non-conference opponents (tournament
      // and showcase teams whose own conference we don't track) come
      // from the game rows of our team-info HTML, which embed each
      // opponent's logo + club_id + team_id. Game cards do a merged
      // lookup so logos appear even for out-of-conference matchups.
      //
      // Keyed by team_name (the exact opponent text we store on games)
      // for direct lookup. Same key shape as conference_standings rows
      // so consumers can use the same matching path. Last-write wins
      // when a name appears in both — conference_standings carries
      // richer fields so we write it second.
      const knownOpponents = {}
      const opponentGameRows = parseGamesFromTeamInfo(html)
      for (const g of opponentGameRows) {
        if (!g.opponent || !g.opponent_logo_url) continue
        knownOpponents[g.opponent] = {
          team_name: g.opponent,
          team_id: g.opponent_team_id || null,
          club_id: g.opponent_club_id || null,
          logo_url: g.opponent_logo_url,
        }
      }
      if (conferenceResult.ok) {
        for (const row of conferenceResult.standings) {
          if (!row.team_name) continue
          knownOpponents[row.team_name] = {
            team_name: row.team_name,
            team_id: row.team_id || null,
            club_id: row.club_id || null,
            logo_url: row.logo_url || knownOpponents[row.team_name]?.logo_url || null,
          }
        }
      }
      standings.known_opponents = knownOpponents

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
          conference_rows: conferenceResult.ok
            ? conferenceResult.standings.length
            : 0,
          conference_age_group_id: conferenceResult.ok
            ? conferenceResult.age_group_id
            : null,
          conference_org_id: conferenceResult.ok
            ? conferenceResult.org_id
            : null,
          conference_season_id: conferenceResult.ok
            ? conferenceResult.season_id
            : null,
          conference_error: conferenceResult.ok ? null : conferenceResult.reason,
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

      // === Events + Games sync ===
      // Only runs when this team has athleteone_sync_games=TRUE. We first
      // parse the team's event list from the hidden "Events" tab of team-info
      // HTML (find-or-create rows in the events table, upgrading any matching
      // manual events to source='athleteone'). Then we sync games, tagging
      // each game with its narrowest containing event by date-range overlap.
      let eventsResult = null
      let gamesResult
      if (team.athleteone_sync_games) {
        const parsedEvents = parseEventsFromTeamInfo(html)
        eventsResult = await syncEvents(supabase, team, parsedEvents)
        gamesResult = await syncGames(
          supabase,
          team,
          html,
          eventsResult.events
        )
      } else {
        gamesResult = 'sync disabled for this team'
      }

      summary.mode = 'committed'
      summary.committed = {
        players_upserted: players.length,
        staff_upserted: staff.length,
        events: eventsResult,
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

  // Path 1: INGEST_SECRET (manual cron / curl)
  if (process.env.INGEST_SECRET && token === process.env.INGEST_SECRET) {
    return { ok: true, kind: 'secret' }
  }

  // Path 1b: CRON_SECRET (Vercel Cron / GitHub Actions nightly sync)
  if (process.env.CRON_SECRET && token === process.env.CRON_SECRET) {
    return { ok: true, kind: 'cron' }
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
// Parses games + scores directly from the team-info HTML (which is already
// fetched in the main loop for roster/staff/standings), then upserts them.
//
// Why team-info over club-schedule:
//  - Includes scores (Win/Loss/Draw + actual goal counts)
//  - Explicit H/A markers (more reliable than position-based)
//  - Includes ALL games (incl. tournaments outside the conference schedule)
//
// Safety:
//  - Upserts keyed on athleteone_game_id (regular unique index, ON CONFLICT
//    works against it)
//  - Never deletes — preserves attendance even if a game disappears upstream
//  - Skips rows with manual_override=TRUE so admin overrides stick

// ECNL sub-events whose name signals postseason play are typed Tournament;
// any other real sub-event (city showcases, cups) is a Showcase.
const POSTSEASON_RE = /playoff|championship|nationals?|finals?/i

// Classify one game to an event row + game type.
//
// The decisive signal is the game's own athleteone_event_id (parsed off the
// opponent span):
//   - equals the team's season-shape event id -> league game (season event, League)
//   - any other id -> sub-event game: resolve to the narrowest NON-season event
//       whose date window contains the game, typed Tournament (postseason name)
//       or Showcase
//   - missing -> legacy fallback: narrowest containing event by date, typed
//       League (never regress an un-tagged row)
//
// events: [{ id, name, start_date, end_date, _width }] (id may be absent in preview)
// typeIds: { league, showcase, tournament }
function classifyGame(g, events, typeIds, seasonAoEventId) {
  const d = g.game_date
  if (!events || events.length === 0) {
    return { event: null, game_type_id: typeIds.league, bucket: 'no-events' }
  }
  const seasonEvent = events.reduce((a, b) => (b._width > a._width ? b : a))
  const containing = (list) =>
    list.find(
      (e) => e.start_date && e.end_date && d >= e.start_date && d <= e.end_date
    ) || null
  const aoEv = g.athleteone_event_id

  // League game: its event id matches the team's season-shape event.
  if (aoEv != null && seasonAoEventId != null && String(aoEv) === String(seasonAoEventId)) {
    return { event: seasonEvent, game_type_id: typeIds.league, bucket: 'league' }
  }

  // Sub-event game: narrowest NON-season event whose window holds the date.
  if (aoEv != null && seasonAoEventId != null) {
    const subs = events
      .filter((e) => e !== seasonEvent)
      .sort((a, b) => a._width - b._width)
    const sub = containing(subs)
    if (sub) {
      const isPost = POSTSEASON_RE.test(sub.name || '')
      return {
        event: sub,
        game_type_id: isPost ? typeIds.tournament : typeIds.showcase,
        bucket: isPost ? 'tournament' : 'showcase',
      }
    }
    // Tagged as a sub-event but no matching window — don't mislabel as league.
    return { event: null, game_type_id: typeIds.tournament, bucket: 'tournament-nowindow' }
  }

  // Legacy fallback (no event id parsed): old narrowest-containing behavior.
  const any = containing(events.slice().sort((a, b) => a._width - b._width))
  return { event: any, game_type_id: typeIds.league, bucket: 'legacy' }
}

async function syncGames(supabase, team, teamInfoHtml, events) {
  const games = parseGamesFromTeamInfo(
    teamInfoHtml,
    String(team.athleteone_team_id)
  )

  if (games.length === 0) {
    return {
      upserted: 0,
      skipped_override: 0,
      note: 'No games found for this team in team-info HTML',
    }
  }

  // Resolve game-type ids by name (case-insensitive). Showcase/Tournament
  // fall back gracefully so a missing type never yields a null game_type_id.
  const { data: gameTypes } = await supabase
    .from('game_types')
    .select('id, name')
  const byName = (re) => {
    const t = (gameTypes || []).find((gt) => re.test(gt.name || ''))
    return t ? t.id : null
  }
  const leagueTypeId = byName(/league/i)
  const typeIds = {
    league: leagueTypeId,
    showcase: byName(/showcase/i) || byName(/tournament/i) || leagueTypeId,
    tournament: byName(/tournament/i) || leagueTypeId,
  }

  // Events with computed window width, consumed by classifyGame.
  const evMeta = (events || []).map((e) => ({
    id: e.id,
    name: e.event_name || e.name || '',
    start_date: e.start_date,
    end_date: e.end_date,
    _width: dateDaysBetween(e.start_date, e.end_date),
  }))

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

  const bucketCounts = {}
  const upsertRows = games
    .filter((g) => !overrideSet.has(g.athleteone_game_id))
    .map((g) => {
      const c = classifyGame(g, evMeta, typeIds, team.athleteone_event_id)
      bucketCounts[c.bucket] = (bucketCounts[c.bucket] || 0) + 1
      return {
        team_id: team.id,
        athleteone_game_id: g.athleteone_game_id,
        game_date: g.game_date,
        game_time: g.game_time,
        opponent: g.opponent,
        is_home: g.is_home,
        location: g.location,
        our_score: g.our_score,
        opponent_score: g.opponent_score,
        game_type_id: c.game_type_id,
        source: 'athleteone',
        timezone: 'America/New_York',
        event_id: c.event ? c.event.id : null,
      }
    })

  if (upsertRows.length === 0) {
    return {
      upserted: 0,
      skipped_override: overrideSet.size,
      total_parsed: games.length,
    }
  }

  const { error: upErr } = await supabase
    .from('games')
    .upsert(upsertRows, { onConflict: 'athleteone_game_id' })
  if (upErr) {
    return { error: 'Upsert failed: ' + upErr.message }
  }

  // Counts for diagnostic output
  const scoredCount = games.filter((g) => g.our_score != null).length
  const linkedCount = upsertRows.filter((r) => r.event_id != null).length

  return {
    upserted: upsertRows.length,
    skipped_override: overrideSet.size,
    total_parsed: games.length,
    with_scores: scoredCount,
    linked_to_event: linkedCount,
    by_bucket: bucketCounts,
  }
}

/**
 * Parse the team's event list from the hidden "Events" tab of team-info HTML.
 *
 * Structure inside <table id="events-table-content">:
 *   <span class="individual-team-item" data-event-id="{EID}" ...>EVENT NAME</span>
 *   ...
 *   <div>DATE_RANGE</div>
 *
 * DATE_RANGE examples:
 *   "Oct 11 - Oct 13, 2025"     (same year)
 *   "Aug 01 - Jul 01, 2026"     (crosses year boundary -> start is 2025)
 *
 * Note: data-event-id can repeat across rows for the same team (multiple
 * sub-events all roll up to the league event_id). We dedup downstream by
 * (LOWER(event_name), start_date), not by athleteone_event_id.
 */
function parseEventsFromTeamInfo(html) {
  const events = []

  // The events-table-content section contains a nested <table> per event card,
  // which confuses a naive lazy match on the outer </table>. Instead, find the
  // start of the section and cap the search region using sibling section IDs
  // (players-table-content, staffs-table-content) that always come after.
  const startMatch = html.match(/id="events-table-content"/i)
  if (!startMatch) return events
  const startIdx = startMatch.index

  let endIdx = html.length
  for (const marker of ['id="players-table-content"', 'id="staffs-table-content"']) {
    const i = html.indexOf(marker, startIdx)
    if (i > startIdx && i < endIdx) endIdx = i
  }

  const section = html.substring(startIdx, endIdx)

  // Match each span+date pair within the events section. The non-greedy
  // `[\s\S]{0,400}?` bridges the gap between the event-name span and the
  // following date-range div without crossing into a sibling event card.
  const eventRe = /<span\s+class="individual-team-item"\s+data-event-id="(\d+)"[^>]*>([^<]+)<\/span>[\s\S]{0,400}?<div[^>]*>([A-Z][a-z]{2}\s+\d{1,2}\s*-\s*[A-Z][a-z]{2}\s+\d{1,2},\s+\d{4})<\/div>/gi

  let m
  while ((m = eventRe.exec(section)) !== null) {
    const aoEventId = parseInt(m[1], 10)
    const eventName = normalizeEventName(m[2])
    const range = parseEventDateRange(m[3])
    if (!eventName || !range) continue

    events.push({
      athleteone_event_id: aoEventId,
      event_name: eventName,
      start_date: range.start,
      end_date: range.end,
    })
  }

  return events
}

// Normalize event names so unicode dash variants ("2025-26" vs "2025–26") and
// stray whitespace don't fool the case-insensitive dedup lookup.
function normalizeEventName(s) {
  if (!s) return null
  const out = s
    .replace(/[\u2010-\u2015]/g, '-')   // unicode dashes -> ASCII hyphen
    .replace(/\s+/g, ' ')
    .trim()
  return out.length > 0 ? out : null
}

// Parse "Aug 01 - Jul 01, 2026" or "Oct 11 - Oct 13, 2025" into ISO date strings.
// When start month > end month, start year is inferred to be (end year - 1).
function parseEventDateRange(s) {
  const months = {
    Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
    Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12,
  }
  const m = s.match(
    /([A-Z][a-z]{2})\s+(\d{1,2})\s*-\s*([A-Z][a-z]{2})\s+(\d{1,2}),\s+(\d{4})/
  )
  if (!m) return null

  const startMon = months[m[1]]
  const startDay = parseInt(m[2], 10)
  const endMon = months[m[3]]
  const endDay = parseInt(m[4], 10)
  const endYear = parseInt(m[5], 10)

  if (!startMon || !endMon) return null

  const startYear = startMon > endMon ? endYear - 1 : endYear

  const toIso = (y, mo, d) =>
    y + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0')

  return {
    start: toIso(startYear, startMon, startDay),
    end: toIso(endYear, endMon, endDay),
  }
}

// Find-or-create rows in events table for each parsed event.
// Behavior:
//   - Lookup by (club_id, start_date, LOWER(event_name)) — scopes to this
//     team's club so we never accidentally collide with another club's events.
//   - If existing event has source='manual', upgrade to 'athleteone' and set
//     athleteone_event_id (so your manually-created events get linked, not
//     duplicated)
//   - If existing event has source='athleteone' but no athleteone_event_id,
//     backfill the id
//   - Otherwise leave existing row alone
//   - If no match, INSERT new event with source='athleteone'
//
// Errors are accumulated into result.errors (instead of swallowed silently)
// so the caller can see why a sync failed.
async function syncEvents(supabase, team, parsedEvents) {
  const result = {
    events: [],
    created: 0,
    upgraded: 0,
    backfilled: 0,
    total_parsed: parsedEvents.length,
    errors: [],
  }

  if (parsedEvents.length === 0) return result

  // Both fields are NOT NULL on events table; bail early if the team is
  // missing either (would be a data-integrity issue worth surfacing).
  if (!team.club_id || !team.season_id) {
    result.errors.push(
      `team ${team.id} missing club_id (${team.club_id}) or season_id (${team.season_id})`
    )
    return result
  }

  for (const ev of parsedEvents) {
    // Lookup candidates scoped to this club + start_date, filter by lowered
    // name in JS (Supabase JS doesn't expose LOWER() in a where clause).
    const { data: candidates, error: selErr } = await supabase
      .from('events')
      .select('id, event_name, start_date, end_date, source, athleteone_event_id, club_id')
      .eq('club_id', team.club_id)
      .eq('start_date', ev.start_date)

    if (selErr) {
      result.errors.push(`select "${ev.event_name}": ${selErr.message}`)
      continue
    }

    const lcName = ev.event_name.toLowerCase()
    const existing = (candidates || []).find(
      (c) => (c.event_name || '').toLowerCase() === lcName
    )

    if (existing) {
      if (existing.source === 'manual') {
        const { error: upErr } = await supabase
          .from('events')
          .update({
            source: 'athleteone',
            athleteone_event_id: ev.athleteone_event_id,
          })
          .eq('id', existing.id)
        if (upErr) {
          result.errors.push(`upgrade "${ev.event_name}": ${upErr.message}`)
        } else {
          result.upgraded += 1
        }
      } else if (
        existing.athleteone_event_id == null &&
        ev.athleteone_event_id != null
      ) {
        const { error: upErr } = await supabase
          .from('events')
          .update({ athleteone_event_id: ev.athleteone_event_id })
          .eq('id', existing.id)
        if (upErr) {
          result.errors.push(`backfill "${ev.event_name}": ${upErr.message}`)
        } else {
          result.backfilled += 1
        }
      }
      result.events.push({
        id: existing.id,
        event_name: existing.event_name,
        start_date: existing.start_date,
        end_date: existing.end_date,
      })
      continue
    }

    // No match — create new event row
    const slug = generateEventSlug(ev.event_name, ev.start_date)
    const insertPayload = {
      event_name: ev.event_name,
      start_date: ev.start_date,
      end_date: ev.end_date,
      slug: slug,
      source: 'athleteone',
      athleteone_event_id: ev.athleteone_event_id,
      club_id: team.club_id,
      season_id: team.season_id,
    }
    const { data: inserted, error: insErr } = await supabase
      .from('events')
      .insert(insertPayload)
      .select('id, event_name, start_date, end_date')
      .single()

    if (insErr || !inserted) {
      // Likely a slug collision — try once with a suffix
      const fallbackSlug = slug + '-' + Date.now().toString(36).slice(-4)
      const retry = await supabase
        .from('events')
        .insert({ ...insertPayload, slug: fallbackSlug })
        .select('id, event_name, start_date, end_date')
        .single()
      if (retry.error || !retry.data) {
        result.errors.push(
          `insert "${ev.event_name}" (${ev.start_date}): ${insErr?.message || 'unknown'} | retry: ${retry.error?.message || 'unknown'}`
        )
        continue
      }
      result.events.push(retry.data)
      result.created += 1
      continue
    }
    result.events.push(inserted)
    result.created += 1
  }

  return result
}

function generateEventSlug(name, startDate) {
  const base = (name || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
  const year = (startDate || '').substring(0, 4)
  return base + (year ? '-' + year : '')
}

function dateDaysBetween(startIso, endIso) {
  if (!startIso || !endIso) return 999999
  const s = new Date(startIso + 'T00:00:00Z').getTime()
  const e = new Date(endIso + 'T00:00:00Z').getTime()
  if (isNaN(s) || isNaN(e)) return 999999
  return Math.max(0, Math.round((e - s) / 86400000))
}

/**
 * Parse games from the team-info HTML.
 *
 * Structure (per game row):
 *   <tr>
 *     <td>
 *       <div>...<div>A or H</div>            <!-- home/away marker
 *               <div>Sep 06, 2025</div>      <!-- date
 *               <div>11:00 AM</div>          <!-- time
 *               <div>#965399</div>           <!-- GM#
 *           <span class="individual-team-item" data-team-id="...">opponent name</span>
 *           <span class="game-complex-item">venue</span>
 *       ...
 *     </td>
 *     <td>
 *       <img src=".../{Win|Loss|Draw}_Icon.png"/>
 *       <span>X - Y</span>                    <!-- our_score - opp_score
 *     </td>
 *   </tr>
 *
 * Filters out non-game rows (staff/player listings) by requiring both a GM#
 * and a date pattern in the same row.
 */
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

    const timeMatch = tr.match(
      /<div[^>]*>(\d{1,2}:\d{2}\s+[AP]M)<\/div>/
    )

    // Opponent: the lone individual-team-item span in this view (vs the
    // club-schedule which had two). data-team-id + data-club-id are
    // captured so downstream consumers can wire opponent enrichment
    // (logos, club lookups) without re-fetching.
    const oppMatch = tr.match(
      /<span\s+class="individual-team-item"[^>]*data-club-id="(\d+)"[^>]*data-team-id="(\d+)"[^>]*>([^<]+)<\/span>/i
    )

    // The opponent span also carries data-event-id = the event this game
    // belongs to. This is the only reliable game->event signal: game rows
    // otherwise have no event id, and the events tab labels every card with
    // the overloaded league event_id. Captured here, consumed by classifyGame.
    const evIdMatch = tr.match(
      /class="individual-team-item"[^>]*\bdata-event-id="(\d+)"/i
    )

    // Opponent logo lives in the SAME flexbox cell as the team-item
    // span — typically the <img> just before it. Grab any image src
    // inside the row whose tag also sits before the opponent span;
    // simplest reliable rule: first img.src in the row (since opponent
    // logo is the only image in a game row's main cell).
    const logoMatch = tr.match(/<img[^>]+src="([^"]+)"/i)

    const venueMatch = tr.match(
      /<span\s+class="game-complex-item"[^>]*>([\s\S]*?)<\/span>/i
    )

    // Score (optional — only present for played games)
    const scoreMatch = tr.match(
      /(Win|Loss|Draw)_Icon\.png[^>]*\/>\s*<span>(\d+)\s*-\s*(\d+)<\/span>/i
    )

    games.push({
      athleteone_game_id: parseInt(gmMatch[1], 10),
      game_date: parseTeamInfoDate(dateMatch[1]),
      game_time: timeMatch ? parseTeamInfoTime(timeMatch[1]) : null,
      opponent: oppMatch ? oppMatch[3].trim() : null,
      opponent_club_id: oppMatch ? parseInt(oppMatch[1], 10) : null,
      opponent_team_id: oppMatch ? parseInt(oppMatch[2], 10) : null,
      athleteone_event_id: evIdMatch ? parseInt(evIdMatch[1], 10) : null,
      opponent_logo_url: logoMatch ? logoMatch[1] : null,
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
// === Conference standings helpers ====================================
// Calls the separate get-conference-standings endpoint to fetch the full
// league table (not just our team's row, which is all the team-info HTML
// gives us). Five positional path params:
//   event_id / org_id / season_id / age_group_id / standing_type
//
// org_id and season_id vary per ECNL program. Known pairs:
//   ECNL Girls: 9 / 69
//   ECNL Boys: 12 / 70
// RL and Pre-ECNL variants are likely different again — add to
// KNOWN_STANDINGS_PAIRS below as they're discovered. The
// discoverStandingsParams walk tries each pair in turn on first sync
// per team and caches the working one back to the team row.
//
// standing_type: 0 = Conference, 1 = Champions League. We only fetch
// Conference here; could expand later if useful.
const CONFERENCE_STANDINGS_BASE =
  'https://api.athleteone.com/api/Script/get-conference-standings'

// Known (org_id, season_id) pairs to try during auto-discovery. Each
// entry covers ONE ECNL program across ALL age bands within that
// program. Discovered empirically via probe mode — see
// /api/ingest-athleteone?probe=true&teamId=N to find pairs for new
// programs.
//
// AthleteOne treats (org_id, season_id) as a "qualification filter":
// the team list returned is determined by event_id alone, but only
// the matching pair populates postseason qualifications. Scoring
// discovery picks the pair with the most populated qualifications.
const KNOWN_STANDINGS_PAIRS = [
  [9, 69], // ECNL Girls (all age bands)
  [12, 70], // ECNL Boys (all age bands)
  [13, 71], // ECNL RL Girls (all age bands, multi-conference)
  [16, 72], // ECNL RL Boys (all age bands)
]

async function fetchConferenceStandings(eventId, orgId, seasonId, ageGroupId) {
  const url =
    CONFERENCE_STANDINGS_BASE +
    '/' +
    eventId +
    '/' +
    orgId +
    '/' +
    seasonId +
    '/' +
    (ageGroupId || 0) +
    '/0'
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        Referer: 'https://theecnl.com/',
        Origin: 'https://theecnl.com',
        Accept: '*/*',
      },
    })
    if (!response.ok) return { ok: false, error: 'HTTP ' + response.status }
    const html = await response.text()
    return { ok: true, html }
  } catch (err) {
    return { ok: false, error: err.message }
  }
}

// Extract age_group_id options from the embedded <select id="division-select">
// dropdown. Used during auto-discovery to iterate candidate IDs.
function parseAgeGroupOptions(html) {
  const selectMatch = html.match(
    /<select\s+id="division-select"[^>]*>([\s\S]*?)<\/select>/i
  )
  if (!selectMatch) return []
  const ids = []
  const optRe = /<option\s+value="(\d+)"/gi
  let m
  while ((m = optRe.exec(selectMatch[1])) !== null) {
    const id = parseInt(m[1], 10)
    if (id > 0) ids.push(id)
  }
  return ids
}

// Returns the currently-selected age_group_id from the dropdown, or null.
// AthleteOne defaults to *something* when called with age_group_id=0, so
// reading the selected option after the sentinel call can short-circuit
// the iterative walk.
function parseSelectedAgeGroup(html) {
  const selectMatch = html.match(
    /<select\s+id="division-select"[^>]*>([\s\S]*?)<\/select>/i
  )
  if (!selectMatch) return null
  const m = selectMatch[1].match(/<option\s+value="(\d+)"\s+selected/i)
  return m ? parseInt(m[1], 10) : null
}

// Quick existence check for a team_id in the standings response. The only
// data-team-id attributes in this response are in the standings table
// rows (dropdown options use different attributes), so this is safe.
function htmlContainsTeamId(html, teamId) {
  if (!teamId) return false
  const re = new RegExp('data-team-id="' + teamId + '"', 'i')
  return re.test(html)
}

// Parse the full conference standings into structured rows. Each table
// has 11 cells per row: [POS, TEAM_INFO, GP, W, L, D, GF, GA, GD, PPG, PTS].
// TEAM_INFO contains a <span class="individual-team-item" data-team-id="N">
// with the team name and an optional qualification block.
//
// Multi-division conferences (e.g. ECNL Girls Ohio Valley G2010 → North
// and South, 6 teams each) return TWO tables in the same response. Each
// table is preceded by an <h*> heading naming the division. Single-
// division conferences (e.g. G2013) return one table with no division
// heading. Output rows carry a `division` field that is null for the
// single-table case and the heading text (e.g. "North"/"South") for
// the multi-table case.
function parseConferenceStandings(html) {
  const out = []

  // Find every standings table by anchoring on its POS column header.
  // Multiple matches means a divisional split — one match means a flat
  // conference table. Same logic handles both.
  const posHeaderRe = /<th[^>]*>\s*POS\s*<\/th>/gi
  const tableStarts = []
  let h
  while ((h = posHeaderRe.exec(html)) !== null) {
    tableStarts.push(h.index)
  }
  if (tableStarts.length === 0) return out

  // The division marker is a big 48px-styled <span> AthleteOne renders
  // as a grey watermark above each table. In multi-division conferences
  // (Ohio Valley G2010 → North/South) the span text is the division
  // name. In single-division conferences (G2013) the SAME span carries
  // the league acronym ("ECNL") as a decoration — we handle that case
  // by nulling division on all rows when every value matches a known
  // acronym, so the modal renders flat instead of putting "ECNL" as
  // a section header above one undivided table.
  const markerRe =
    /<span\s+style="[^"]*font-size:\s*48px[^"]*"[^>]*>([^<]+)<\/span>/gi
  const markers = []
  let mm
  while ((mm = markerRe.exec(html)) !== null) {
    const text = stripTags(mm[1]).trim()
    if (text) markers.push({ pos: mm.index, text: text })
  }

  // Closest preceding marker wins, scoped to the gap between this table
  // and the previous one.
  function markerFor(tableStart, prevEnd) {
    let best = null
    for (const marker of markers) {
      if (marker.pos < tableStart && marker.pos >= prevEnd) {
        best = marker.text
      }
    }
    return best
  }

  for (let i = 0; i < tableStarts.length; i++) {
    const start = tableStarts[i]
    const prevEnd = i > 0 ? tableStarts[i - 1] : 0
    const division = markerFor(start, prevEnd)

    const end =
      i + 1 < tableStarts.length ? tableStarts[i + 1] : html.length
    const section = html.substring(start, end)
    const tbodyMatch = section.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i)
    if (!tbodyMatch) continue

    const tbody = tbodyMatch[1]
    const rowRe = /<tr[^>]*>([\s\S]*?)<\/tr>/gi
    let rowMatch
    while ((rowMatch = rowRe.exec(tbody)) !== null) {
      const parsed = parseStandingsRow(rowMatch[1], division)
      if (parsed) out.push(parsed)
    }
  }

  // Single-division responses put the league acronym in the marker span
  // ("ECNL"/"ECNL RL"/"PRE-ECNL"/etc) as a watermark, NOT as a real
  // division label. When every row carries the same value AND that
  // value is a known acronym, treat the response as undivided.
  const distinct = new Set(out.map((r) => r.division).filter((d) => d))
  const ACRONYM_MARKERS = new Set([
    'ECNL',
    'ECNL RL',
    'ECNL BOYS',
    'ECNL GIRLS',
    'PRE-ECNL',
    'PRE ECNL',
  ])
  if (distinct.size === 1) {
    const only = Array.from(distinct)[0]
    if (ACRONYM_MARKERS.has(only.toUpperCase())) {
      for (const r of out) r.division = null
    }
  }

  return out
}

// Parse a single <tr> from the standings table. Returns null when the
// row doesn't look like a standings row (insufficient cells, missing
// team span, non-numeric place — all expected for header/spacer rows).
function parseStandingsRow(rowHtml, division) {
  const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi
  const cells = []
  let c
  while ((c = cellRe.exec(rowHtml)) !== null) cells.push(c[1])
  if (cells.length < 11) return null

  const place = parseInt(stripTags(cells[0]).trim(), 10)
  if (Number.isNaN(place)) return null

  const cell1 = cells[1]
  const teamMatch = cell1.match(
    /<span\s+class="individual-team-item"[^>]*data-team-id="(\d+)"[^>]*>([\s\S]*?)<\/span>/i
  )
  if (!teamMatch) return null
  const teamId = parseInt(teamMatch[1], 10)
  const teamName = stripTags(teamMatch[2]).trim()

  // Each row has a single <img alt="team logo" src="..."> at the start
  // of the team-info cell. Source paths vary — /ClubImages/ for real club
  // logos, /PlayerForm/ or /PlayerImage/ as fallbacks when a club hasn't
  // uploaded its own (the filename usually still hints at the logo,
  // e.g. "73806358..._CFSC Logo no o.png" for Cleveland Force). We just
  // trust the URL and let the consumer render it.
  const logoMatch = cell1.match(/<img[^>]+src="([^"]+)"/i)
  const logoUrl = logoMatch ? logoMatch[1] : null

  // Also grab the data-club-id attribute that sits on the team span —
  // useful downstream for cross-team club-level rollups (one club may
  // have multiple teams in the standings). Falls back to null if the
  // attribute is missing.
  const clubMatch = cell1.match(
    /<span\s+class="individual-team-item"[^>]*data-club-id="(\d+)"/i
  )
  const clubId = clubMatch ? parseInt(clubMatch[1], 10) : null

  const qualMatch = cell1.match(
    /Qualification:\s*<\/span\s*>\s*<span[^>]*>([\s\S]*?)<\/span\s*>/i
  )
  const qualification = qualMatch ? stripTags(qualMatch[1]).trim() : null

  const num = (raw) => {
    const cleaned = stripTags(raw).trim()
    if (cleaned === '' || cleaned === '-') return null
    const n = parseFloat(cleaned)
    return Number.isNaN(n) ? null : n
  }
  const intOrNull = (raw) => {
    const n = num(raw)
    return n === null ? null : Math.round(n)
  }

  return {
    place: place,
    team_id: teamId,
    team_name: teamName,
    club_id: clubId,
    logo_url: logoUrl,
    qualification: qualification,
    division: division,
    gp: intOrNull(cells[2]),
    wins: intOrNull(cells[3]),
    losses: intOrNull(cells[4]),
    draws: intOrNull(cells[5]),
    gf: intOrNull(cells[6]),
    ga: intOrNull(cells[7]),
    gd: intOrNull(cells[8]),
    ppg: num(cells[9]),
    pts: intOrNull(cells[10]),
  }
}

// PROBE: brute-force search over a wide (org, season) grid to find the
// pair that returns the most populated qualifications for this team.
// Run once per program-of-unknown-constants — feed the result into
// KNOWN_STANDINGS_PAIRS and discovery for siblings is fast forever after.
//
// Two phases:
//   1. Find ANY working triple via current discovery (gets age_group_id).
//   2. With that age_group_id fixed, parallel-probe (org, season) over a
//      grid. Each call is one fetch, so we can run 30+ in parallel and
//      keep within Vercel Hobby's 10s timeout.
async function probeBestStandingsPair(team) {
  // Phase 1: bootstrap an age_group_id via existing discovery
  const eventId = team.athleteone_event_id
  const ourTeamId = team.athleteone_team_id
  let ageGroupId = team.athleteone_age_group_id

  if (!ageGroupId) {
    const bootstrap = await discoverStandingsParams(eventId, ourTeamId)
    if (!bootstrap) {
      return {
        ok: false,
        reason: 'could not find any working pair to bootstrap age_group_id',
      }
    }
    ageGroupId = bootstrap.age_group_id
  }

  // Phase 2: probe (org, season) grid with that age_group_id fixed
  const ORG_RANGE = Array.from({ length: 20 }, (_, i) => i + 1) // 1..20
  const SEASON_RANGE = Array.from({ length: 21 }, (_, i) => i + 60) // 60..80
  const pairs = []
  for (const org of ORG_RANGE) {
    for (const season of SEASON_RANGE) {
      pairs.push([org, season])
    }
  }

  const teamIdMarker = 'data-team-id="' + ourTeamId + '"'
  const results = []
  const BATCH = 30

  for (let i = 0; i < pairs.length; i += BATCH) {
    const batch = pairs.slice(i, i + BATCH)
    const responses = await Promise.all(
      batch.map(([org, season]) =>
        fetchConferenceStandings(eventId, org, season, ageGroupId)
      )
    )
    for (let j = 0; j < batch.length; j++) {
      const [org, season] = batch[j]
      const r = responses[j]
      if (!r.ok || !r.html.includes(teamIdMarker)) continue
      const rows = parseConferenceStandings(r.html)
      let score = 0
      for (const row of rows) {
        const q = (row.qualification || '').trim()
        if (q && !/^n\/?a$/i.test(q)) score++
      }
      results.push({ org, season, score, rows: rows.length })
    }
  }

  results.sort((a, b) => b.score - a.score || a.org - b.org)
  return {
    ok: true,
    age_group_id: ageGroupId,
    total_pairs_returning_data: results.length,
    top_5: results.slice(0, 5),
    winner: results[0] || null,
  }
}


// (org_id, season_id, age_group_id). Returns the triple or null.
//
// Strategy:
//   For each known (org_id, season_id) pair, find an age_group_id whose
//   response contains our team_id. Score that match by how many rows
//   have real (non-n/a) qualifications populated. After walking ALL
//   pairs, return the highest-scoring triple.
//
// Why scoring matters: AthleteOne ignores (org_id, season_id) for
// purposes of which TEAMS get returned — both (9,69) and (12,70) return
// the same boys roster when event_id is a boys event. But (org, season)
// DOES determine whether qualifications come back populated or as
// "n/a" for every row. Without scoring we'd cache the first matching
// pair and silently lose all postseason data.
//
// Tie-breaking when no pair has any real qualifications (preseason or
// no brackets yet): first pair in KNOWN_STANDINGS_PAIRS wins. Acceptable
// because team list is identical across pairs in that case.
async function discoverStandingsParams(eventId, ourTeamId) {
  const candidates = []

  for (const [orgId, seasonId] of KNOWN_STANDINGS_PAIRS) {
    const sentinel = await fetchConferenceStandings(
      eventId,
      orgId,
      seasonId,
      0
    )
    if (!sentinel.ok) continue

    // Find the age_group_id whose response contains ourTeamId.
    let ageGroupId = null
    let sourceHtml = null
    if (htmlContainsTeamId(sentinel.html, ourTeamId)) {
      ageGroupId = parseSelectedAgeGroup(sentinel.html)
      sourceHtml = sentinel.html
    }
    if (!ageGroupId) {
      const options = parseAgeGroupOptions(sentinel.html)
      for (const candidate of options) {
        const r = await fetchConferenceStandings(
          eventId,
          orgId,
          seasonId,
          candidate
        )
        if (r.ok && htmlContainsTeamId(r.html, ourTeamId)) {
          ageGroupId = candidate
          sourceHtml = r.html
          break
        }
      }
    }
    if (!ageGroupId || !sourceHtml) continue

    // Score by how many rows have real (non-n/a, non-empty)
    // qualifications. parseConferenceStandings returns rows with
    // qualification field already extracted.
    const rows = parseConferenceStandings(sourceHtml)
    let score = 0
    for (const row of rows) {
      const q = (row.qualification || '').trim()
      if (q && !/^n\/?a$/i.test(q)) score++
    }
    candidates.push({
      org_id: orgId,
      season_id: seasonId,
      age_group_id: ageGroupId,
      score: score,
    })
  }

  if (candidates.length === 0) return null

  // Pick highest score; ties broken by first-in-order (stable sort).
  candidates.sort((a, b) => b.score - a.score)
  const best = candidates[0]
  return {
    org_id: best.org_id,
    season_id: best.season_id,
    age_group_id: best.age_group_id,
  }
}

// Sync the full conference standings for one team into its metadata.
// Idempotent: with all three URL params cached (org/season/age_group),
// makes a single API call. Without any of them, auto-discovers all
// three together, persists in commit mode, then fetches. Resilient to
// partial cache state — if only some params are cached, falls back to
// full discovery.
async function syncConferenceStandings(supabase, team, commit) {
  if (!team.athleteone_event_id || !team.athleteone_team_id) {
    return { ok: false, reason: 'missing event/team id' }
  }
  let orgId = team.athleteone_standings_org_id || null
  let seasonId = team.athleteone_standings_season_id || null
  let ageGroupId = team.athleteone_age_group_id || null

  // Need all three to skip discovery. Otherwise re-discover the lot —
  // partial caches risk using mismatched (org/season) with an
  // age_group_id from a different namespace.
  if (!orgId || !seasonId || !ageGroupId) {
    const discovered = await discoverStandingsParams(
      team.athleteone_event_id,
      team.athleteone_team_id
    )
    if (!discovered) {
      return { ok: false, reason: 'could not discover standings params' }
    }
    orgId = discovered.org_id
    seasonId = discovered.season_id
    ageGroupId = discovered.age_group_id
    if (commit) {
      await supabase
        .from('teams')
        .update({
          athleteone_standings_org_id: orgId,
          athleteone_standings_season_id: seasonId,
          athleteone_age_group_id: ageGroupId,
        })
        .eq('id', team.id)
    }
  }

  const r = await fetchConferenceStandings(
    team.athleteone_event_id,
    orgId,
    seasonId,
    ageGroupId
  )
  if (!r.ok) return { ok: false, reason: r.error }
  const standings = parseConferenceStandings(r.html)
  if (standings.length === 0) {
    return { ok: false, reason: 'no rows parsed' }
  }

  return {
    ok: true,
    org_id: orgId,
    season_id: seasonId,
    age_group_id: ageGroupId,
    standings: standings,
  }
}
