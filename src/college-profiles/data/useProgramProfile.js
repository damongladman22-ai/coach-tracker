import { useEffect, useState } from 'react'

/**
 * useProgramProfile — the single data load for a program profile.
 *
 * Portable: takes the Supabase `client` (never imports one). Loads the school
 * row, every active roster row across all seasons (the cross-season spine the
 * metrics read), the active coaching staff, and the school's source links —
 * once — then derives the basics the cards share. Metrics compute from whatever
 * seasons exist (coverage-agnostic).
 *
 * school_sources holds the official-site URLs (kind='roster' etc.); the schools
 * table's athletics_url is unpopulated, so the outbound links are derived here:
 * a direct roster link and the site homepage (roster URL's origin).
 *
 * Returns: { loading, error, school, rosters, coaches,
 *            seasons, currentSeason, currentRoster, lastSyncedRaw,
 *            rosterUrl, homeUrl }
 */
export function useProgramProfile(client, schoolId) {
  const [state, setState] = useState({
    loading: true, error: null, school: null, rosters: [], coaches: [], sources: [],
  })

  useEffect(() => {
    if (!client || !schoolId) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const [schoolRes, rostersRes, coachesRes, sourcesRes] = await Promise.all([
          client.from('schools').select('*').eq('id', schoolId).single(),
          client.from('college_rosters')
            .select('id, roster_season, player_name, player_id, jersey_number, position, raw_position, class_year, grad_year, hometown_city, hometown_state, hometown_country, club_team, height_inches, last_synced_at')
            .eq('school_id', schoolId).eq('is_active', true)
            .order('roster_season', { ascending: true }),
          client.from('coaches')
            .select('id, first_name, last_name, title, email, phone')
            .eq('school_id', schoolId).eq('is_active', true),
          client.from('school_sources').select('kind, url').eq('school_id', schoolId),
        ])
        if (cancelled) return
        if (schoolRes.error) throw schoolRes.error
        if (rostersRes.error) throw rostersRes.error
        if (coachesRes.error) throw coachesRes.error
        // school_sources is non-critical: a failure here shouldn't blank the profile.
        setState({
          loading: false, error: null,
          school: schoolRes.data,
          rosters: rostersRes.data || [],
          coaches: coachesRes.data || [],
          sources: sourcesRes.error ? [] : (sourcesRes.data || []),
        })
      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, error: e?.message || String(e), school: null, rosters: [], coaches: [], sources: [] })
        }
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  // --- derived basics (coverage-agnostic) ---
  const seasons = [...new Set(state.rosters.map(r => r.roster_season))].sort((a, b) => a - b)
  const currentSeason = seasons.length ? seasons[seasons.length - 1] : null
  const currentRoster = state.rosters.filter(r => r.roster_season === currentSeason)
  const lastSyncedRaw = state.rosters.reduce(
    (max, r) => (r.last_synced_at && (!max || r.last_synced_at > max)) ? r.last_synced_at : max,
    null,
  )

  // --- outbound official-site links (derived from school_sources) ---
  const rosterSource = state.sources.find(s => s.kind === 'roster' && s.url) || state.sources.find(s => s.url)
  const rosterUrl = rosterSource?.url || null
  let homeUrl = null
  if (rosterUrl) {
    try { homeUrl = new URL(rosterUrl).origin } catch (_e) { homeUrl = null }
  }

  return { ...state, seasons, currentSeason, currentRoster, lastSyncedRaw, rosterUrl, homeUrl }
}
