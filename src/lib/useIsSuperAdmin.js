import { useEffect, useState } from 'react'
import { supabase } from './supabase'
import { getAdminRole } from './adminRole'

/**
 * useIsSuperAdmin — single source of truth for the platform-owner check.
 *
 * Returns 'checking' | 'allowed' | 'denied'. RLS is the real gate server-side;
 * this only drives what the UI shows (owner nav, owner pages, owner dashboard
 * tiles). Used by OwnerLayout and AdminDashboard so the role query lives in one
 * place instead of being copied per component.
 */
export function useIsSuperAdmin(session) {
  const [status, setStatus] = useState('checking')

  useEffect(() => {
    let cancelled = false
    const email = session?.user?.email
    if (!email) {
      setStatus('denied')
      return
    }
    // One shared request per email (lib/adminRole.js).
    getAdminRole(supabase, email).then(role => {
      if (cancelled) return
      setStatus(role === 'super_admin' ? 'allowed' : 'denied')
    })
    return () => {
      cancelled = true
    }
  }, [session])

  return status
}
