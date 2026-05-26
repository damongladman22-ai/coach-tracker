/**
 * AthleteOne Ingest Endpoint
 * ===========================
 * Fetches per-team data from api.athleteone.com via theecnl.com's public
 * API and upserts into PitchSide's team_players, team_staff, and team
 * metadata. Games sync is gated per-team by teams.athleteone_sync_games.
 *
 * Endpoints:
 *   GET  /api/ingest-athleteone                          → all teams, DRY RUN
 *   GET  /api/ingest-athleteone?teamId=1                 → just team id=1, DRY RUN
 *   GET  /api/ingest-athleteone?commit=true              → all teams, COMMIT
 *   GET  /api/ingest-athleteone?teamId=1&commit=true     → just team id=1, COMMIT
 *
 * Auth:
 *   Authorization: Bearer <INGEST_SECRET>
 *
 * Required Vercel env vars:
 *   VITE_SUPABASE_URL              (already in your project)
 *   SUPABASE_SERVICE_ROLE_KEY      (Supabase Dashboard → Settings → API → service_role)
 *   INGEST_SECRET                  (any long random string you mint)
 *
 * Dependencies: none beyond @supabase/supabase-js (already in your project)
 */
import { createClient } from '@supabase/supabase-js';

const ATHLETEONE_BASE = 'https://api.athleteone.com/api/Script/get-individual-team-info';

const FETCH_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Referer: 'https://theecnl.com/',
  Origin: 'https://theecnl.com',
  Accept: '*/*',
  'Accept-Language': 'en-US,en;q=0.9',
};

export default async function handler(req, res) {
  // ----- Auth -----
  const authHeader = req.headers.authorization || '';
  const expected = `Bearer ${process.env.INGEST_SECRET}`;
  if (!process.env.INGEST_SECRET || authHeader !== expected) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabaseUrl = process.env.VITE_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) {
    return res.status(500).json({
      error: 'Missing env vars: VITE_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY',
    });
  }

  const supabase = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false },
  });

  // ----- Mode -----
  const commit = String(req.query.commit || '').toLowerCase() === 'true';
  const teamFilter = req.query.teamId ? parseInt(req.query.teamId, 10) : null;

  // ----- Fetch teams to ingest -----
  let teamsQuery = supabase
    .from('teams')
    .select(
      'id, name, athleteone_org_id, athleteone_event_id, athleteone_team_id, ' +
      'athleteone_club_id, athleteone_sync_games'
    )
    .not('athleteone_team_id', 'is', null);

  if (teamFilter) teamsQuery = teamsQuery.eq('id', teamFilter);

  const { data: teams, error: teamsErr } = await teamsQuery;
  if (teamsErr) return res.status(500).json({ error: teamsErr.message });
  if (!teams || teams.length === 0) {
    return res.status(200).json({
      message: 'No teams with AthleteOne IDs set',
      teams_processed: 0,
    });
  }

  const results = [];

  for (const team of teams) {
    const url =
      `${ATHLETEONE_BASE}/${team.athleteone_org_id}/${team.athleteone_event_id}` +
      `/${team.athleteone_club_id}/${team.athleteone_team_id}`;

    try {
      const response = await fetch(url, { headers: FETCH_HEADERS });
      if (!response.ok) {
        results.push({
          team_id: team.id,
          name: team.name,
          error: `HTTP ${response.status}`,
        });
        continue;
      }

      const html = await response.text();
      const parsed = parseTeamInfo(html);

      const summary = {
        team_id: team.id,
        name: team.name,
        url,
        bytes: html.length,
        parsed: {
          standings: parsed.standings,
          players_count: parsed.players.length,
          staff_count: parsed.staff.length,
          players_sample: parsed.players.slice(0, 3),
          staff_sample: parsed.staff.slice(0, 3),
        },
      };

      if (!commit) {
        summary.mode = 'dry-run (no DB writes)';
        results.push(summary);
        continue;
      }

      // ===== COMMIT MODE =====
      const teamUpdate = await supabase
        .from('teams')
        .update({
          athleteone_metadata: parsed.standings,
          athleteone_last_synced_at: new Date().toISOString(),
        })
        .eq('id', team.id);

      const playerResult = await upsertRoster(
        supabase,
        'team_players',
        'athleteone_player_id',
        team.id,
        parsed.players.map((p, i) => ({
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
          updated_at: new Date().toISOString(),
        }))
      );

      const staffResult = await upsertRoster(
        supabase,
        'team_staff',
        'athleteone_staff_id',
        team.id,
        parsed.staff.map((s, i) => ({
          team_id: team.id,
          athleteone_staff_id: s.athleteone_staff_id,
          last_name: s.last_name,
          first_name: s.first_name,
          title: s.title,
          email: s.email,
          photo_url: s.photo_url,
          active: true,
          sort_order: i,
          updated_at: new Date().toISOString(),
        }))
      );

      summary.games = team.athleteone_sync_games
        ? 'sync enabled but parser not built yet (Sprint 2)'
        : 'sync disabled for this team';
      summary.mode = 'committed';
      summary.committed = {
        team_metadata: teamUpdate.error
          ? `error: ${teamUpdate.error.message}`
          : 'ok',
        players: playerResult,
        staff: staffResult,
      };

      results.push(summary);
    } catch (err) {
      results.push({
        team_id: team.id,
        name: team.name,
        error: err.message,
        stack: err.stack?.split('\n').slice(0, 5),
      });
    }
  }

  return res.status(200).json({
    mode: commit ? 'committed' : 'dry-run',
    teams_processed: results.length,
    results,
  });
}

// =====================================================================
// HTML parsing (regex-based - no DOM library needed)
// =====================================================================
//
// AthleteOne's team-info response is server-generated HTML with a stable
// template. The rosters/staff live in:
//   <table id="players-table-content"><tbody>...rows...</tbody></table>
//   <table id="staffs-table-content"><tbody>...rows...</tbody></table>
//
// Each row's shape:
//   <tr>
//     <td>...
//       <img src=".../PlayerImage/First_Last_<32hex>.ext" />
//       <span>Last, First</span>          ← name
//       <span>Position OR Title</span>    ← role
//       <span>GradYear OR Email</span>    ← detail
//       ...<span>#NN</span>               ← jersey OR athleteone ID
//     </td>
//   </tr>
// =====================================================================

function parseTeamInfo(html) {
  return {
    standings: parseStandings(html),
    players: parseRosterRows(html, 'players-table-content', 'player'),
    staff: parseRosterRows(html, 'staffs-table-content', 'staff'),
  };
}

function parseStandings(html) {
  const out = {
    record_w: null,
    record_l: null,
    record_t: null,
    standings_position: null,
    standings_total: null,
    last_five: null,
    parse_warnings: [],
    synced_at: new Date().toISOString(),
  };

  // Locate the Standings section: <h3>Standings</h3> ... up until the next <h3>
  const standingsSection = html.match(
    /<h3[^>]*>\s*Standings\s*<\/h3>([\s\S]*?)(?=<h3|$)/i
  );
  const scope = standingsSection ? standingsSection[1] : html;
  if (!standingsSection) {
    out.parse_warnings.push('No <h3>Standings</h3> heading found; scanning whole document');
  }

  // Record (W-L-T)
  const recordMatch = scope.match(/(\d+)\s*-\s*(\d+)\s*-\s*(\d+)/);
  if (recordMatch) {
    out.record_w = parseInt(recordMatch[1], 10);
    out.record_l = parseInt(recordMatch[2], 10);
    out.record_t = parseInt(recordMatch[3], 10);
  }

  // Position: "3rd of 12" or "Place: 3" or "Rank: 3"
  const placeOfMatch = scope.match(/(\d+)(?:st|nd|rd|th)\s+of\s+(\d+)/i);
  if (placeOfMatch) {
    out.standings_position = parseInt(placeOfMatch[1], 10);
    out.standings_total = parseInt(placeOfMatch[2], 10);
  } else {
    const placeMatch = scope.match(/(?:Place|Rank|Position)[:\s]+(\d+)/i);
    if (placeMatch) out.standings_position = parseInt(placeMatch[1], 10);
  }

  // Last 5 (sequence of W/L/D/T characters or icons)
  // AthleteOne sometimes renders this as a string like "WWLDL"
  const last5Match = scope.match(/Last\s*5[^<]{0,40}?([WLDT]{3,5})/i);
  if (last5Match) out.last_five = last5Match[1];

  return out;
}

function parseRosterRows(html, tableId, kind) {
  const tableMatch = html.match(
    new RegExp(`<table[^>]*id="${tableId}"[^>]*>([\\s\\S]*?)<\\/table>`, 'i')
  );
  if (!tableMatch) return [];

  const tableHtml = tableMatch[1];
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/g)];

  const rows = [];
  for (const [, rowHtml] of rowMatches) {
    if (/<th\b/i.test(rowHtml)) continue; // skip header rows

    // Photo URL
    const imgMatch = rowHtml.match(/<img[^>]*src="([^"]+)"/i);
    const photoUrl = imgMatch ? imgMatch[1] : null;

    // All <span> contents in document order
    const spanContents = [...rowHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => stripTags(m[1]).trim())
      .filter((s) => s.length > 0);

    if (spanContents.length < 2) continue; // malformed

    const fullName = spanContents[0]; // "Last, First"
    const middleField = spanContents[1] || ''; // position OR title
    const lastField = spanContents[2] || ''; // grad year OR email
    const trailing = spanContents[spanContents.length - 1] || ''; // "#NN" or "#NNNNNN"

    const [lastName, firstName] = splitFullName(fullName);
    if (!lastName || !firstName) continue;

    const trailingId = trailing.replace(/^#/, '').trim();

    if (kind === 'player') {
      // Photo hash → stable player ID
      let athleteOnePlayerId = null;
      if (photoUrl) {
        const hashMatch = photoUrl.match(/_([a-f0-9]{32})\.[a-zA-Z]+$/i);
        if (hashMatch) athleteOnePlayerId = hashMatch[1];
      }
      if (!athleteOnePlayerId) {
        athleteOnePlayerId = `synth:${normalize(lastName)}:${normalize(firstName)}:${lastField || 0}`;
      }

      const gradYear = /^\d{4}$/.test(lastField) ? parseInt(lastField, 10) : null;
      const jerseyNumber = /^\d+$/.test(trailingId) ? parseInt(trailingId, 10) : null;

      rows.push({
        athleteone_player_id: athleteOnePlayerId,
        last_name: lastName,
        first_name: firstName,
        position: middleField || null,
        grad_year: gradYear,
        jersey_number: jerseyNumber,
        photo_url: photoUrl,
      });
    } else {
      // staff: trailing span is the visible #ID
      const athleteOneStaffId = /^\d+$/.test(trailingId)
        ? trailingId
        : `synth:${normalize(lastName)}:${normalize(firstName)}`;

      rows.push({
        athleteone_staff_id: athleteOneStaffId,
        last_name: lastName,
        first_name: firstName,
        title: middleField || null,
        email: looksLikeEmail(lastField) ? lastField : null,
        photo_url: photoUrl,
      });
    }
  }
  return rows;
}

// =====================================================================
// DB upsert helpers
// =====================================================================

async function upsertRoster(supabase, table, idCol, teamId, rows) {
  if (rows.length === 0) {
    const { error } = await supabase
      .from(table)
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('team_id', teamId);
    return { upserted: 0, deactivated: error ? `error: ${error.message}` : 'all' };
  }

  const { error: upErr } = await supabase
    .from(table)
    .upsert(rows, { onConflict: `team_id,${idCol}` });
  if (upErr) return { error: upErr.message };

  const incomingIds = rows.map((r) => r[idCol]).filter(Boolean);
  let deactivatedCount = 0;
  if (incomingIds.length > 0) {
    const { data: deactivated, error: deErr } = await supabase
      .from(table)
      .update({ active: false, updated_at: new Date().toISOString() })
      .eq('team_id', teamId)
      .not(idCol, 'in', `(${incomingIds.map((v) => `"${v}"`).join(',')})`)
      .select('id');
    if (deErr) return { upserted: rows.length, deactivate_error: deErr.message };
    deactivatedCount = deactivated?.length || 0;
  }

  return { upserted: rows.length, deactivated: deactivatedCount };
}

// =====================================================================
// Small utilities
// =====================================================================

function stripTags(s) {
  return String(s || '').replace(/<[^>]*>/g, '');
}

function splitFullName(full) {
  if (!full) return [null, null];
  const idx = full.indexOf(',');
  if (idx === -1) return [full.trim(), ''];
  return [full.slice(0, idx).trim(), full.slice(idx + 1).trim()];
}

function looksLikeEmail(s) {
  return typeof s === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function normalize(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');
}
