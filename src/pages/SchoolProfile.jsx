import { useParams } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

/**
 * TEMPORARY DIAGNOSTIC build of SchoolProfile.
 * Prints exactly what the access gate would see. No redirect, so it always
 * renders. We restore the real host once we know the cause.
 */
export default function SchoolProfile({ session }) {
  const { schoolId } = useParams()
  const [info, setInfo] = useState({ phase: 'starting…' })

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const out = {}
      try {
        out.propEmail = session?.user?.email || null
        const { data: live } = await supabase.auth.getSession()
        out.liveEmail = live?.session?.user?.email || null
        const email = out.liveEmail || out.propEmail

        if (email) {
          const { data, error } = await supabase
            .from('allowed_admins').select('role').eq('email', email).maybeSingle()
          out.ownerRole = data?.role ?? null
          out.ownerError = error ? (error.message || String(error)) : null
        } else {
          out.ownerRole = null
          out.ownerError = 'no email available'
        }

        const { data: ps, error: psErr } = await supabase
          .from('platform_settings').select('value')
          .eq('key', 'college_profiles_enabled').maybeSingle()
        out.flagValue = ps?.value ?? null
        out.flagError = psErr ? (psErr.message || String(psErr)) : null
      } catch (e) {
        out.threw = e?.message || String(e)
      }
      if (!cancelled) setInfo({ phase: 'done', ...out })
    })()
    return () => { cancelled = true }
  }, [session])

  return (
    <div style={{ padding: 24, fontFamily: 'monospace', fontSize: 14, lineHeight: 1.6 }}>
      <h2 style={{ marginBottom: 8 }}>College Profiles — gate diagnostic</h2>
      <div>schoolId: {String(schoolId)}</div>
      <pre style={{ background: '#f4f4f5', padding: 16, borderRadius: 8, overflow: 'auto' }}>
{JSON.stringify(info, null, 2)}
      </pre>
    </div>
  )
}
