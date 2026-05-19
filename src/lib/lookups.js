import { supabase } from './supabase'
import { getCurrentClubId } from './club'

let cachedPrograms = null
let cachedAgeGroups = null
let cachedGameTypes = null

/**
 * Get the programs list for the current club, sorted by sort_order.
 */
export async function getPrograms() {
  if (cachedPrograms) return cachedPrograms

  const clubId = await getCurrentClubId()
  if (!clubId) return []

  const { data, error } = await supabase
    .from('programs')
    .select('*')
    .eq('club_id', clubId)
    .eq('active', true)
    .order('sort_order')

  if (error) {
    console.error('Error fetching programs:', error)
    return []
  }
  cachedPrograms = data || []
  return cachedPrograms
}

/**
 * Get the age groups list for the current club, sorted by sort_order.
 */
export async function getAgeGroups() {
  if (cachedAgeGroups) return cachedAgeGroups

  const clubId = await getCurrentClubId()
  if (!clubId) return []

  const { data, error } = await supabase
    .from('age_groups')
    .select('*')
    .eq('club_id', clubId)
    .eq('active', true)
    .order('sort_order')

  if (error) {
    console.error('Error fetching age groups:', error)
    return []
  }
  cachedAgeGroups = data || []
  return cachedAgeGroups
}

/**
 * Get the game types list for the current club, sorted by sort_order.
 */
export async function getGameTypes() {
  if (cachedGameTypes) return cachedGameTypes

  const clubId = await getCurrentClubId()
  if (!clubId) return []

  const { data, error } = await supabase
    .from('game_types')
    .select('*')
    .eq('club_id', clubId)
    .eq('active', true)
    .order('sort_order')

  if (error) {
    console.error('Error fetching game types:', error)
    return []
  }
  cachedGameTypes = data || []
  return cachedGameTypes
}

/**
 * Get the game_type_id for the "Showcase" type (most common default for new games).
 * Returns the first/default game_type if Showcase isn't found.
 */
export async function getDefaultGameTypeId() {
  const types = await getGameTypes()
  const showcase = types.find(t => t.name.toLowerCase() === 'showcase')
  if (showcase) return showcase.id
  return types[0]?.id || null
}

/**
 * Generate a slug from age group, gender, and program names.
 * E.g., "U16 Girls ECNL" -> "u16-girls-ecnl"
 */
export function generateTeamSlug(ageGroupName, gender, programName) {
  const raw = `${ageGroupName}-${gender}-${programName}`
  return raw.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
}

/**
 * Generate the auto display name for a team based on the chosen template:
 * "{age_group} {gender} {program}" -> "U16 Girls ECNL"
 */
export function generateTeamName(ageGroupName, gender, programName) {
  return `${ageGroupName} ${gender} ${programName}`
}

/**
 * Clears all lookup caches. Call after editing lookups.
 */
export function clearLookupCaches() {
  cachedPrograms = null
  cachedAgeGroups = null
  cachedGameTypes = null
}
