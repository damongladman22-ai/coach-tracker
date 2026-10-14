import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'

/**
 * Who may use Ask PitchSide in this browser (backlog F2).
 *
 *  - the owner (signed in, super_admin), as before;
 *  - a pilot: someone who opened a personal pilot link (…/ask?pilot=<code>,
 *    Damon 2026-10-14). The code is kept in this browser and sent to
 *    /api/ask in the X-Ask-Pilot header; no login. Club families otherwise use
 *    the site exactly as before (club passcode only).
 *
 * The server is the real gate (api/ask.js + server/ask/pilots.js): it checks
 * the code on every request. This file only decides what the page shows.
 */
const KEY = 'ask-pilot-code-v1'

export function getPilotCode() {
  try { return window.localStorage.getItem(KEY) || null } catch { return null }
}
function setPilotCode(c) {
  try { if (c) window.localStorage.setItem(KEY, c); else window.localStorage.removeItem(KEY) } catch { /* blocked */ }
}

// A pilot link puts the code in the address; keep it and take it out of the address bar.
function captureFromAddress() {
  try {
    const u = new URL(window.location.href)
    const code = u.searchParams.get('pilot')
    if (!code) return
    setPilotCode(code.trim())
    checked = null
    u.searchParams.delete('pilot')
    window.history.replaceState(window.history.state, '', u.pathname + (u.search || '') + u.hash)
  } catch { /* old browser */ }
}

/** Headers for /api/ask: the owner's sign-in token and/or the pilot code. */
export async function askHeaders(extra = {}) {
  const h = { ...extra }
  try {
    const { data } = await supabase.auth.getSession()
    if (data?.session?.access_token) h.Authorization = `Bearer ${data.session.access_token}`
  } catch { /* no session */ }
  const code = getPilotCode()
  if (code) h['X-Ask-Pilot'] = code
  return h
}

// One check per page load, shared by every component that asks.
let checked = null
function checkPilot() {
  if (!checked) {
    checked = (async () => {
      const code = getPilotCode()
      if (!code) return null
      try {
        const r = await fetch('/api/ask?pilot_check=1', { headers: { 'X-Ask-Pilot': code } })
        const j = await r.json().catch(() => ({}))
        if (r.ok && j.kind === 'pilot') return { name: j.name, leftToday: j.left_today, dailyLimit: j.daily_limit }
        if (r.status === 403) setPilotCode(null)   // switched off or replaced: forget it
        return null
      } catch { return null }
    })()
  }
  return checked
}

/** { status: 'checking' | 'owner' | 'pilot' | 'none', pilot: { name, leftToday, dailyLimit } | null } */
export function useAskAccess(session) {
  const owner = useIsSuperAdmin(session)
  const [pilot, setPilot] = useState({ done: false, info: null })
  useEffect(() => {
    captureFromAddress()
    let cancelled = false
    checkPilot().then(info => { if (!cancelled) setPilot({ done: true, info }) })
    return () => { cancelled = true }
  }, [])
  if (owner === 'allowed') return { status: 'owner', pilot: null }
  if (pilot.done && pilot.info) return { status: 'pilot', pilot: pilot.info }
  if (owner === 'checking' || !pilot.done) return { status: 'checking', pilot: null }
  return { status: 'none', pilot: null }
}
