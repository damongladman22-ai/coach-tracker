import { useParams, useNavigate } from 'react-router-dom'
import { useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useCollegeProfilesAccess } from '../college-profiles/access/useCollegeProfilesAccess'
import ProfileLocked from '../college-profiles/access/ProfileLocked'
import CollegeProfile from '../college-profiles/CollegeProfile'
import { PageLoader } from '../components/LoadingStates'

/**
 * SchoolProfile — PitchSide's thin host for the portable College Profiles module.
 *
 * Keeps all PitchSide-specific concerns OUT of the module:
 *   - reads :schoolId from the route
 *   - runs the access gate with the app's shared supabase client + session
 *   - injects the app's client + back-link target into the module
 *
 * Gate outcomes:
 *   checking → loader
 *   disabled → not available to this viewer; send home (owner-bypass means the
 *              owner never lands here while the feature is globally off)
 *   locked   → premium teaser
 *   allowed  → the profile
 */
export default function SchoolProfile({ session }) {
  const { schoolId } = useParams()
  const navigate = useNavigate()
  const status = useCollegeProfilesAccess(supabase, session)

  useEffect(() => {
    if (status === 'disabled') navigate('/', { replace: true })
  }, [status, navigate])

  if (status === 'checking' || status === 'disabled') {
    return <PageLoader message="Loading…" />
  }
  if (status === 'locked') {
    return <ProfileLocked backTo="/directory" backLabel="Back to Coach Directory" />
  }
  return (
    <CollegeProfile
      client={supabase}
      schoolId={schoolId}
      backTo="/directory"
      backLabel="Back to Coach Directory"
    />
  )
}
