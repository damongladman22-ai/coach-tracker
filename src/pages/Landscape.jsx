import { supabase } from '../lib/supabase'
import { useCsipLandscapeAccess } from '../csip-landscape/access/useCsipLandscapeAccess'
import LandscapeLocked from '../csip-landscape/access/LandscapeLocked'
import CSIPLandscape from '../csip-landscape/CSIPLandscape'
import { PageLoader } from '../components/LoadingStates'

/**
 * Landscape — PitchSide's thin host for the portable College Soccer Landscape module.
 *
 * Keeps PitchSide-specific concerns OUT of the module: runs the access gate with
 * the app's shared supabase client and injects the client + back-link target.
 *
 * Gate outcomes:
 *   checking → loader
 *   disabled → neutral "not available" (no redirect — redirecting races the auth
 *              handshake on cold loads; a static state is correct and safe)
 *   locked   → premium teaser
 *   allowed  → the landscape
 */
export default function Landscape() {
  const status = useCsipLandscapeAccess(supabase)

  if (status === 'checking') {
    return <PageLoader message="Loading…" />
  }

  if (status === 'disabled') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: '#F2F3F5', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #E5E8EB', borderRadius: 14,
          boxShadow: '0 8px 24px rgba(20,25,28,.06)', padding: '28px 30px', maxWidth: 420,
          textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, color: '#15191C' }}>Not available</h1>
          <p style={{ color: '#5C6B73', margin: 0 }}>This feature isn’t available on this account.</p>
        </div>
      </div>
    )
  }

  if (status === 'locked') {
    return <LandscapeLocked backTo="/directory" backLabel="Back to Coach Directory" />
  }

  return (
    <CSIPLandscape
      client={supabase}
      backTo="/directory"
      backLabel="Back to Coach Directory"
    />
  )
}
