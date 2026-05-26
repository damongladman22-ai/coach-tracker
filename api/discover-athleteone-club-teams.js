import { createClient } from '@supabase/supabase-js'

/**
 * Discover all AthleteOne teams for a (org, event, club) tuple.
 *
 * Calls AthleteOne's club-schedule endpoint, parses the HTML for every
 * <span class="individual-team-item"> that belongs to the target club, and
 * returns a deduped list of teams with parsed metadata.
 *
 * Also cross-references against PitchSide's teams table so the UI can show
 * which teams are new vs. already imported.
 *
 * Query params:
 *   eventId  (required)  AthleteOne event id (e.g., 3931 for ECNL Girls 2025-26)
 *   clubId   (required)  AthleteOne club id  (e.g., 437 for Ohio Premier)
 *   orgId    (optional)  AthleteOne org/competition id (e.g., 9 for ECNL Girls).
 *                        Required to dedup against existing PitchSide rows.
 *
 * Auth: same as ingest-athleteone — INGEST_SECRET or admin Supabase JWT.
 */

const ATHLETEONE_BASE =
  'https://api.athleteone.com/api/Script/get-club-schedules-by-eventID-and-clubID'

export default async function handler(req, res) {
  const supabase = createClient(
    process.env.VITE_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  )

  // Auth — same pattern as ingest-athleteone
  const authHeader = req.headers.authorization || ''
  const token = authHeader.replace(/^Bearer\s+/i, '')
  if (!token) {
    return res.status(401).json({ error: 'Missing authorization' })
  }

  let authorized = false
  if (process.env.INGEST_SECRET && token === process.env.INGEST_SECRET) {
    authorized = true
  }
  if (!authorized) {
    const { data: userData, error: userError } =
      await supabase.auth.getUser(token)
    if (!userError && userData?.user?.email) {
      const email = userData.user.email.toLowerCase()
      const { data: adminRow } = await supabase
        .from('allowed_admins')
        .select('email')
        .ilike('email', email)
        .maybeSingle()
      if (adminRow) authorized = true
    }
  }
  if (!authorized) {
    return res.status(401).json({ error: 'Unauthorized' })
  }

  const eventId = parseInt(req.query.eventId, 10)
  const clubId = parseInt(req.query.clubId, 10)
  const orgId = req.query.orgId ? parseInt(req.query.orgId, 10) : null

  if (!eventId || !clubId) {
    return res
      .status(400)
      .json({ error: 'eventId and clubId query params are required' })
  }

  const url = `${ATHLETEONE_BASE}/${eventId}/${clubId}`

  let response
  try {
    response = await fetch(url, {
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
      .json({ error: 'AthleteOne request failed: ' + err.message })
  }

  if (!response.ok) {
    return res
      .status(502)
      .json({ error: 'AthleteOne returned ' + response.status })
  }

  const html = await response.text()
  const teams = parseClubTeams(html, String(clubId))

  // Cross-reference against PitchSide teams to mark which ones already exist.
  // We match on the AthleteOne quad (org, event, club, team) to be precise.
  // orgId is required for this lookup — if not supplied, we skip the dedup
  // step and let the client know via the `dedup_skipped` flag.
  let dedupSkipped = false
  if (!orgId) {
    dedupSkipped = true
    for (const t of teams) {
      t.already_exists = null
      t.pitchside_team = null
    }
  } else if (teams.length > 0) {
    const teamIdsAsInts = teams
      .map((t) => parseInt(t.athleteone_team_id, 10))
      .filter((n) => Number.isFinite(n))

    const { data: existing, error: existingErr } = await supabase
      .from('teams')
      .select(
        'id, name, slug, season_id, athleteone_team_id, athleteone_org_id, athleteone_event_id, athleteone_club_id'
      )
      .eq('athleteone_org_id', orgId)
      .eq('athleteone_event_id', eventId)
      .eq('athleteone_club_id', clubId)
      .in('athleteone_team_id', teamIdsAsInts)

    if (existingErr) {
      // Soft-fail: still return the parsed list, just without the badges.
      dedupSkipped = true
      for (const t of teams) {
        t.already_exists = null
        t.pitchside_team = null
      }
    } else {
      const byId = new Map()
      for (const row of existing || []) {
        byId.set(String(row.athleteone_team_id), row)
      }
      for (const t of teams) {
        const match = byId.get(String(t.athleteone_team_id))
        if (match) {
          t.already_exists = true
          t.pitchside_team = {
            id: match.id,
            name: match.name,
            slug: match.slug,
            season_id: match.season_id,
          }
        } else {
          t.already_exists = false
          t.pitchside_team = null
        }
      }
    }
  }

  return res.status(200).json({
    count: teams.length,
    dedup_skipped: dedupSkipped,
    teams: teams,
  })
}

/**
 * Parse the club-schedule HTML to extract every team belonging to the target
 * club. Each game's HTML contains TWO <span class="individual-team-item">
 * elements — one for each side. We filter by data-club-id, dedupe by
 * data-team-id, and parse the visible name for age + gender hints.
 */
function parseClubTeams(html, clubIdStr) {
  // The span tags wrap text spanning newlines and have attributes in varied
  // order in some places. We're permissive about attribute order by capturing
  // the whole opening tag and then extracting attrs individually.
  const spanRe = /<span\s+class="individual-team-item"\b([^>]*)>([^<]+)<\/span>/gi

  const found = new Map() // team_id -> team object

  let m
  while ((m = spanRe.exec(html)) !== null) {
    const attrs = m[1]
    const innerText = m[2].trim()

    const teamId = extractAttr(attrs, 'data-team-id')
    const club = extractAttr(attrs, 'data-club-id')
    const event = extractAttr(attrs, 'data-event-id')
    const org = extractAttr(attrs, 'data-org-id')

    if (!teamId || club !== clubIdStr) continue
    if (found.has(teamId)) continue

    found.set(teamId, {
      athleteone_team_id: teamId,
      athleteone_event_id: event ? parseInt(event, 10) : null,
      athleteone_club_id: parseInt(club, 10),
      athleteone_org_id: org ? parseInt(org, 10) : null,
      athleteone_name: innerText,
      parsed: parseName(innerText),
    })
  }

  // Sort by parsed age + gender so the UI is predictable
  return Array.from(found.values()).sort((a, b) => {
    const aLabel = (a.parsed?.suggested_age_label || 'U99').slice(1)
    const bLabel = (b.parsed?.suggested_age_label || 'U99').slice(1)
    const aAge = parseInt(aLabel, 10) || 99
    const bAge = parseInt(bLabel, 10) || 99
    if (aAge !== bAge) return aAge - bAge
    const aGender = a.parsed?.gender || ''
    const bGender = b.parsed?.gender || ''
    return aGender.localeCompare(bGender)
  })
}

function extractAttr(attrs, name) {
  const re = new RegExp(name + '="([^"]*)"', 'i')
  const m = attrs.match(re)
  return m ? m[1] : null
}

/**
 * Parse an AthleteOne team name like "Ohio Premier ECNL G13" into structured
 * fields.
 *
 * Returns:
 *   league                    "ECNL" | "ECNL RL" | "NPL" | null
 *   gender                    "Girls" | "Boys" | null
 *   birth_year                e.g. 2013
 *   suggested_age_label       "U13", "U16", etc. (current season)
 *   suggested_pitchside_name  e.g. "U13 Girls ECNL"
 *   mixed_roster              true if the name has a "/" age range (e.g. G08/07)
 *
 * Conventions used:
 *   - "G" → Girls, "B" → Boys
 *   - Two-digit year is interpreted as 20XX (since youth soccer covers 2007–2014)
 *   - U-number = season_end_year − birth_year. The season is inferred from
 *     today's date: if Aug–Dec, season ends NEXT year; if Jan–Jul, season
 *     ends THIS year.
 */
function parseName(name) {
  const out = {
    league: null,
    gender: null,
    birth_year: null,
    suggested_age_label: null,
    suggested_pitchside_name: null,
    mixed_roster: false,
  }
  if (!name) return out

  // League detection. ECNL RL must be checked before bare ECNL.
  if (/\bECNL\s+RL\b/i.test(name)) out.league = 'ECNL RL'
  else if (/\bECNL\b/i.test(name)) out.league = 'ECNL'
  else if (/\bNPL\b/i.test(name)) out.league = 'NPL'
  else if (/\bOVPL\b/i.test(name)) out.league = 'OVPL'

  // Gender + year. Accepts "G13", "B11", "G08/07", or "G2013".
  const gy = name.match(/\b([GB])(\d{4}|\d{2})(?:\s*\/\s*(\d{2}))?\b/)
  if (gy) {
    out.gender = gy[1] === 'G' ? 'Girls' : 'Boys'
    let yearPart = gy[2]
    let birthYear = null
    if (yearPart.length === 4) {
      birthYear = parseInt(yearPart, 10)
    } else {
      birthYear = 2000 + parseInt(yearPart, 10)
    }
    if (gy[3]) {
      out.mixed_roster = true
      const second = 2000 + parseInt(gy[3], 10)
      // For mixed rosters, use the OLDER year (younger U-number, older players)
      birthYear = Math.min(birthYear, second)
    }
    out.birth_year = birthYear

    const now = new Date()
    const seasonEnd = now.getMonth() >= 7 ? now.getFullYear() + 1 : now.getFullYear()
    const uNumber = seasonEnd - birthYear
    if (uNumber > 0 && uNumber < 25) {
      out.suggested_age_label = 'U' + uNumber
    }
  }

  if (out.suggested_age_label && out.gender && out.league) {
    out.suggested_pitchside_name = `${out.suggested_age_label} ${out.gender} ${out.league}`
  } else if (out.suggested_age_label && out.gender) {
    out.suggested_pitchside_name = `${out.suggested_age_label} ${out.gender}`
  }

  return out
}
