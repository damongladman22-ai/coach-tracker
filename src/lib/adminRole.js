/**
 * The signed-in user's role in allowed_admins, fetched once per email per page
 * load and shared (performance pass, 2026-10-09).
 *
 * The same "is this the owner?" question was asked by useIsSuperAdmin (CsipGate,
 * AdminLayout, OwnerLayout) and by the College Profiles and Landscape access
 * hooks, and each of those asks again when Supabase reports the initial
 * session, so one College Profile view sent it four times. They now share one
 * request. A failed request is not remembered, so the next caller retries.
 * RLS remains the real gate; this only drives what the UI shows.
 */
const cache = new Map()   // email -> Promise<role | null>

export function getAdminRole(client, email) {
  if (!client || !email) return Promise.resolve(null)
  if (!cache.has(email)) {
    const p = client.from('allowed_admins').select('role').eq('email', email).maybeSingle()
      .then(({ data, error }) => {
        if (error) { cache.delete(email); return null }
        return data?.role ?? null
      }, () => { cache.delete(email); return null })
    cache.set(email, p)
  }
  return cache.get(email)
}

/** Forget cached roles (after an admin change, or on sign-out). */
export function clearAdminRoleCache() {
  cache.clear()
}
