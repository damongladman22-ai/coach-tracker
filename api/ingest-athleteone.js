/**
 * AthleteOne Ingest Endpoint
 * ===========================
 * Fetches per-team data from api.athleteone.com via theecnl.com's public
 * API and upserts into PitchSide's team_players, team_staff, and team
 * metadata. Games sync is gated per-team by teams.athleteone_sync_games.
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

  const commit = String(req.query.commit || '').toLowerCase() === 'true';
  const teamFilter = req.query.teamId ? parseInt(req.query.teamId, 10) : null;

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
// HTML parsing
// =====================================================================

function parseTeamInfo(html) {
  return {
    standings: parseStandings(html),
    players: parseRosterRows(html, 'players-table-content', 'player'),
    staff: parseRosterRows(html, 'staffs-table-content', 'staff'),
  };
}

/**
 * The standings section in get-individual-team-info has this structure:
 *
 *   <h3>Standings</h3>
 *   <table>
 *     <thead><tr><th>PLACE</th><th>WINS</th><th>LOSSES</th><th>DRAWS</th></tr></thead>
 *     <tbody><tr><td>1st</td><td>15</td><td>4</td><td>6</td></tr></tbody>
 *   </table>
 *
 * We parse the first data row's 4 cells: place, wins, losses, draws.
 */
function parseStandings(html) {
  const out = {
    record_w: null,
    record_l: null,
    record_t: null,
    standings_position: null,
    standings_total: null, // not exposed in this endpoint
    last_five: null,        // not exposed in this endpoint
    parse_warnings: [],
    synced_at: new Date().toISOString(),
  };

  // Find the Standings <h3>
  const headingIdx = html.search(/<h3[^>]*>\s*Standings\s*<\/h3>/i);
  if (headingIdx === -1) {
    out.parse_warnings.push('No <h3>Standings</h3> heading found');
    return out;
  }

  // Scope to the area immediately after the heading
  const scope = html.substring(headingIdx, headingIdx + 4000);

  // Find the standings table
  const tableMatch = scope.match(/<table[^>]*>([\s\S]*?)<\/table>/i);
  if (!tableMatch) {
    out.parse_warnings.push('No <table> found after Standings heading');
    return out;
  }
  const tableHtml = tableMatch[1];

  // Get the tbody
  const tbodyMatch = tableHtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/i);
  if (!tbodyMatch) {
    out.parse_warnings.push('No <tbody> in Standings table');
    return out;
  }
  const tbodyHtml = tbodyMatch[1];

  // First data row
  const trMatch = tbodyHtml.match(/<tr[^>]*>([\s\S]*?)<\/tr>/i);
  if (!trMatch) {
    out.parse_warnings.push('No data row in Standings tbody');
    return out;
  }
  const trHtml = trMatch[1];

  // Extract all <td> cells
  const cells = [...trHtml.matchAll(/<td[^>]*>([\s\S]*?)<\/td>/gi)]
    .map((m) => stripTags(m[1]).trim());

  if (cells.length < 4) {
    out.parse_warnings.push(
      `Expected 4 standings cells (place/wins/losses/draws), got ${cells.length}`
    );
    return out;
  }

  // PLACE (e.g. "1st", "12th")
  const placeMatch = cells[0].match(/^(\d+)/);
  if (placeMatch) out.standings_position = parseInt(placeMatch[1], 10);

  // WINS / LOSSES / DRAWS
  if (/^\d+$/.test(cells[1])) out.record_w = parseInt(cells[1], 10);
  if (/^\d+$/.test(cells[2])) out.record_l = parseInt(cells[2], 10);
  if (/^\d+$/.test(cells[3])) out.record_t = parseInt(cells[3], 10);

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
    if (/<th\b/i.test(rowHtml)) continue;

    const imgMatch = rowHtml.match(/<img[^>]*src="([^"]+)"/i);
    const photoUrl = imgMatch ? imgMatch[1] : null;

    const spanContents = [...rowHtml.matchAll(/<span[^>]*>([\s\S]*?)<\/span>/g)]
      .map((m) => stripTags(m[1]).trim())
      .filter((s) => s.length > 0);

    if (spanContents.length < 2) continue;

    const fullName = spanContents[0];
    const middleField = spanContents[1] || '';
    const lastField = spanContents[2] || '';
    const trailing = spanContents[spanContents.length - 1] || '';

    const [lastName, firstName] = splitFullName(fullName);
    if (!lastName || !firstName) continue;

    const trailingId = trailing.replace(/^#/, '').trim();

    if (kind === 'player') {
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
// Utilities
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
