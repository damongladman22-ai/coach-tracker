import { useEffect, useState } from 'react'
import { supabase } from './supabase'

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
    supabase
      .from('allowed_admins')
      .select('role')
      .eq('email', email)
      .maybeSingle()
      .then(({ data, error }) => {
        if (cancelled) return
        setStatus(!error && data?.role === 'super_admin' ? 'allowed' : 'denied')
      })
    return () => {
      cancelled = true
    }
  }, [session])

  return status
}
