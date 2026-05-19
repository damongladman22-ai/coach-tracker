import { supabase } from './supabase'

let cachedClubId = null
let cachedClub = null

/**
 * Gets the current club's ID from app_settings.default_club_id.
 * Cached after first call.
 *
 * Returns the integer club_id, or null if not configured.
 */
export async function getCurrentClubId() {
  if (cachedClubId !== null) return cachedClubId

  const { data, error } = await supabase
    .from('app_settings')
    .select('value')
    .eq('key', 'default_club_id')
    .maybeSingle()

  if (error || !data) {
    console.warn('default_club_id not set in app_settings')
    return null
  }

  cachedClubId = parseInt(data.value, 10)
  return cachedClubId
}

/**
 * Gets the full current club record (name, slug, branding fields, etc.)
 * Cached after first call.
 */
export async function getCurrentClub() {
  if (cachedClub) return cachedClub

  const clubId = await getCurrentClubId()
  if (!clubId) return null

  const { data, error } = await supabase
    .from('clubs')
    .select('*')
    .eq('id', clubId)
    .maybeSingle()

  if (error || !data) {
    console.warn('Could not load club record', error)
    return null
  }

  cachedClub = data
  return cachedClub
}

/**
 * Clears the cache. Call after updating club settings.
 */
export function clearClubCache() {
  cachedClubId = null
  cachedClub = null
}
