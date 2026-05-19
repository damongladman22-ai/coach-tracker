import { supabase } from './supabase'
import { getCurrentClubId } from './club'

let cachedActiveSeason = null

/**
 * Gets the currently active season (seasons.is_active = true).
 * Cached after first call.
 *
 * Returns the season record or null.
 */
export async function getActiveSeason() {
  if (cachedActiveSeason) return cachedActiveSeason

  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .eq('is_active', true)
    .order('start_date', { ascending: false })
    .limit(1)
    .maybeSingle()

  if (error || !data) {
    console.warn('No active season found')
    return null
  }

  cachedActiveSeason = data
  return cachedActiveSeason
}

/**
 * Gets the active season's ID. Convenience helper.
 */
export async function getActiveSeasonId() {
  const season = await getActiveSeason()
  return season ? season.id : null
}

/**
 * Lists all seasons, ordered by start_date descending (newest first).
 */
export async function listSeasons() {
  const { data, error } = await supabase
    .from('seasons')
    .select('*')
    .order('start_date', { ascending: false })

  if (error) {
    console.error('Error listing seasons:', error)
    return []
  }
  return data || []
}

/**
 * Clears the cache. Call after updating seasons.
 */
export function clearSeasonCache() {
  cachedActiveSeason = null
}
