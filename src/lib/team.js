import { supabase } from './supabase'
import { getCurrentClubId } from './club'
import { getActiveSeasonId } from './season'

/**
 * Resolve a public team URL (/t/:teamSlug) to one teams row.
 *
 * WHY THIS EXISTS
 * ---------------
 * teams.slug is unique per (club_id, season_id, slug), so the SAME slug exists
 * once per season — "u17-girls-ecnl" is a different team every year. The public
 * URL carries no season, and the pages used to resolve it with a hard
 * `.eq('season_id', activeSeasonId)`. That had two failure modes, both live:
 *
 *   1. Any team from a past season returned "Team not found", because its slug
 *      does not exist in the active season. Every 2025-2026 team page broke the
 *      moment 2026-2027 was marked active.
 *   2. Worse, where the slug DOES exist in the active season, picking last
 *      season silently showed THIS season's team. A wrong page beats an error
 *      page for confusion.
 *
 * RESOLUTION ORDER
 * ----------------
 *   1. An explicit season from the URL (?season=2025-2026), matched against the
 *      season's slug OR its name — season slugs have proven unreliable (the
 *      2026-2027 season was created with the slug "2"), so name is accepted too.
 *   2. The active season.
 *   3. The most recent season that has this slug.
 *
 * Step 3 is what keeps old shared links working: a parent's saved /t/<slug>
 * link with no season parameter still lands somewhere real once that team's
 * season ends, instead of on an error.
 *
 * Returns { team, reason, error }. `reason` is for diagnostics and lets a
 * caller tell "this slug does not exist at all" from "it exists, but not in the
 * season you asked for".
 */

const DEFAULT_SELECT =
  '*, age_groups(name), programs(name), seasons(id, name, slug, start_date)'

export async function resolveTeamBySlug(teamSlug, seasonParam, select) {
  if (!teamSlug) return { team: null, reason: 'no-slug', error: null }

  const selectClause = select || DEFAULT_SELECT

  let query = supabase.from('teams').select(selectClause).eq('slug', teamSlug)

  // Scope to the current club when we know it. Slugs are only unique within a
  // club, so skipping this on a multi-tenant deployment could match another
  // club's team. If the club id is unavailable we still return a result rather
  // than failing closed — today's deployment is single-club.
  const clubId = await getCurrentClubId()
  if (clubId) query = query.eq('club_id', clubId)

  const { data, error } = await query
  if (error) return { team: null, reason: 'query-error', error }

  const rows = data || []
  if (rows.length === 0) return { team: null, reason: 'no-such-slug', error: null }

  // 1. Explicit season from the URL.
  if (seasonParam) {
    const want = String(seasonParam).trim().toLowerCase()
    const hit = rows.find(
      (r) =>
        String(r.seasons?.slug || '').toLowerCase() === want ||
        String(r.seasons?.name || '').toLowerCase() === want
    )
    if (hit) return { team: hit, reason: 'season-param', error: null }
  }

  // 2. The active season.
  const activeSeasonId = await getActiveSeasonId()
  if (activeSeasonId) {
    const hit = rows.find((r) => r.season_id === activeSeasonId)
    if (hit) return { team: hit, reason: 'active-season', error: null }
  }

  // 3. Most recent season carrying this slug. start_date is NOT NULL on
  // seasons, so the string compare is safe; the fallback keeps a row missing
  // its join from sorting to the front.
  const sorted = [...rows].sort((a, b) =>
    String(b.seasons?.start_date || '').localeCompare(
      String(a.seasons?.start_date || '')
    )
  )
  return { team: sorted[0], reason: 'latest-season', error: null }
}

/**
 * The season identifier to hang on an outgoing /t/ link, preferring the slug
 * and falling back to the name. Returns null when there is nothing useful to
 * add, so callers can leave the URL clean.
 */
export function seasonParamFor(team) {
  if (!team) return null
  return seasonParamForSeason(team.seasons)
}

/**
 * Same, for a seasons row you already hold (e.g. the dashboard's selected
 * season). Prefers the slug, but a slug like "2" carries no meaning to a reader
 * — the 2026-2027 season was created with exactly that — so the human-readable
 * name wins when the slug is that short. resolveTeamBySlug matches on either.
 */
export function seasonParamForSeason(season) {
  if (!season) return null
  const slug = season.slug
  const name = season.name
  if (slug && String(slug).length > 2) return String(slug)
  if (name) return String(name)
  return slug ? String(slug) : null
}

/**
 * Append ?season=… to a path, preserving any query string already there.
 */
export function withSeason(path, seasonParam) {
  if (!seasonParam) return path
  const sep = path.includes('?') ? '&' : '?'
  return path + sep + 'season=' + encodeURIComponent(seasonParam)
}
