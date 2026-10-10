import { useEffect, useState } from 'react'
import { getAdminRole } from '../../lib/adminRole'

/**
 * useCollegeProfilesAccess — the two-layer gate for the College Profiles module.
 *
 * Portable: takes the Supabase `client` as an argument (never imports one), so
 * the same gate runs inside PitchSide and in a future standalone shell.
 *
 * Returns: 'checking' | 'allowed' | 'locked' | 'disabled'
 *   allowed  → render the profile
 *   locked   → enabled, but this viewer isn't entitled (premium teaser) [Layer 2 — stubbed]
 *   disabled → global kill switch off AND viewer isn't the platform owner
 *
 * Race-safety: reads the authoritative session via client.auth.getSession() and
 * re-evaluates on every auth-state change. A cold page load can briefly report
 * "no session" while the token refreshes; without re-evaluation the gate would
 * lock onto that empty first read. We never make the decision sticky.
 *
 * Interim posture (owner-bypass): while the global flag is off, the platform
 * owner (super_admin in allowed_admins) always gets 'allowed' — live for
 * QA/demo on real data, invisible to everyone else. A missing platform_settings
 * table/row simply reads as "off".
 */
export function useCollegeProfilesAccess(client) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    if (!client) { setStatus('checking'); return }
    let cancelled = false

    const evaluate = async () => {
      // Authoritative email (not a possibly-stale prop).
      let email = null
      try {
        const { data } = await client.auth.getSession()
        email = data?.session?.user?.email || null
      } catch (_e) { /* ignore */ }
      if (cancelled) return

      // Layer 0 — owner bypass.
      // One shared request per email (lib/adminRole.js).
      if (email) {
        const role = await getAdminRole(client, email)
        if (cancelled) return
        if (role === 'super_admin') { setStatus('allowed'); return }
      }

      // Layer 1 — global kill switch (platform_settings row). Missing table/row
      // or a value other than 'true' both read as off.
      const { data: ps, error: psErr } = await client
        .from('platform_settings').select('value')
        .eq('key', 'college_profiles_enabled').maybeSingle()
      if (cancelled) return
      const enabled = !psErr && ps?.value === 'true'
      if (!enabled) { setStatus('disabled'); return }

      // Layer 2 — per-subject entitlement. [STUB: open once enabled; real
      // club-vs-player wiring drops in here without touching the module.]
      setStatus('allowed')
    }

    evaluate()
    const { data: sub } = client.auth.onAuthStateChange(() => { evaluate() })

    return () => { cancelled = true; sub?.subscription?.unsubscribe?.() }
  }, [client])

  return status
}
