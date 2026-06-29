import { useEffect, useState } from 'react'

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
 * Interim posture (owner-bypass): while the global flag is off, the platform
 * owner (super_admin in allowed_admins) always gets 'allowed' — so the surface
 * is live for QA/demo on real data but invisible to everyone else. If the
 * platform_settings table/row doesn't exist yet, that simply reads as "off".
 */
export function useCollegeProfilesAccess(client, session) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    if (!client) { setStatus('checking'); return }

    ;(async () => {
      // Layer 0 — owner bypass.
      const email = session?.user?.email
      if (email) {
        const { data, error } = await client
          .from('allowed_admins').select('role').eq('email', email).maybeSingle()
        if (cancelled) return
        if (!error && data?.role === 'super_admin') { setStatus('allowed'); return }
      }

      // Layer 1 — global kill switch (platform_settings row).
      let enabled = false
      try {
        const { data, error } = await client
          .from('platform_settings').select('value')
          .eq('key', 'college_profiles_enabled').maybeSingle()
        if (!error && data?.value === 'true') enabled = true
      } catch (_e) { /* table absent → treated as off */ }
      if (cancelled) return
      if (!enabled) { setStatus('disabled'); return }

      // Layer 2 — per-subject entitlement. [STUB: open once enabled; real
      // club-vs-player wiring drops in here without touching the module.]
      setStatus('allowed')
    })()

    return () => { cancelled = true }
  }, [client, session])

  return status
}
