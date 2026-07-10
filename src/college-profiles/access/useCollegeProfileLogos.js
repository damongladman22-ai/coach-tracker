import { useEffect, useState } from 'react'

/**
 * useCollegeProfileLogos — the logo kill switch for College Profiles.
 *
 * Portable: takes the Supabase `client` as an argument (never imports one), so
 * it runs inside PitchSide and in a future standalone shell.
 *
 * Reads a single global flag from platform_settings (key
 * 'college_profiles_logos_enabled') and returns a boolean:
 *   true  → school logos may render (the host passes logoUrl through)
 *   false → logos suppressed everywhere; the crest shows the monogram
 *
 * Default OFF (matches the college_profiles_enabled convention): a missing
 * table/row, a non-'true' value, or a read error all read as false. This is the
 * "wholesale turn off" switch — set the row to anything but 'true' (or delete
 * it) in the SQL editor and every profile reverts to monograms, no redeploy.
 *
 * No owner bypass and no auth dependency: unlike the access gate, this is a
 * plain global on/off (the feature itself is already owner-gated during pilot),
 * and platform_settings is anon-readable, so no session read is needed.
 */
export function useCollegeProfileLogos(client) {
  const [enabled, setEnabled] = useState(false)

  useEffect(() => {
    if (!client) { setEnabled(false); return }
    let cancelled = false

    const evaluate = async () => {
      const { data, error } = await client
        .from('platform_settings').select('value')
        .eq('key', 'college_profiles_logos_enabled').maybeSingle()
      if (cancelled) return
      setEnabled(!error && data?.value === 'true')
    }

    evaluate()

    return () => { cancelled = true }
  }, [client])

  return enabled
}
