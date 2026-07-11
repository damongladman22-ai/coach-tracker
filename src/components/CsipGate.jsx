import { Outlet } from 'react-router-dom'
import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'
import { useCsipPasscode } from '../lib/useCsipPasscode'
import { PageLoader } from './LoadingStates'

/**
 * CsipGate — a single passcode fence wrapping every CSIP surface (College
 * Profiles + Landscape) as a react-router layout route. Renders <Outlet /> once
 * access is granted, so all child routes sit behind one gate.
 *
 * Order of checks:
 *   owner (super_admin) → straight through, never sees the passcode
 *   non-owner           → shared passcode prompt until verified (once per browser)
 *
 * This is the AUDIENCE fence only. Each host page still runs its own kill-switch
 * gate (college_profiles_enabled / csip_landscape_enabled), so turning a surface
 * dark is independent of the passcode.
 */
export default function CsipGate({ session }) {
  const owner = useIsSuperAdmin(session)               // 'checking' | 'allowed' | 'denied'
  const gate = useCsipPasscode(supabase, owner === 'denied')  // active only for non-owners

  if (owner === 'checking') return <PageLoader message="Loading…" />
  if (owner === 'allowed') return <Outlet />           // owner bypass
  if (gate.status === 'checking') return <PageLoader message="Loading…" />
  if (gate.status === 'granted') return <Outlet />
  return <PasscodePrompt gate={gate} />
}

function PasscodePrompt({ gate }) {
  const [value, setValue] = useState('')
  const [busy, setBusy] = useState(false)

  const onSubmit = async () => {
    if (busy) return
    setBusy(true)
    await gate.submit(value)
    setBusy(false)
  }
  const onKeyDown = (e) => { if (e.key === 'Enter') onSubmit() }

  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
      background: '#F2F3F5', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
      <div style={{ background: '#fff', border: '1px solid #E5E8EB', borderRadius: 14,
        boxShadow: '0 8px 24px rgba(20,25,28,.06)', padding: '28px 30px', maxWidth: 420, width: '100%' }}>
        <p style={{ margin: '0 0 6px', fontSize: 11, fontWeight: 700, letterSpacing: '.12em',
          textTransform: 'uppercase', color: '#85939B' }}>College Soccer Intelligence</p>
        <h1 style={{ margin: '0 0 8px', fontSize: 22, color: '#15191C' }}>Enter access passcode</h1>
        <p style={{ color: '#5C6B73', margin: '0 0 18px', fontSize: 14, lineHeight: 1.4 }}>
          This area is in preview for our club. Enter the passcode shared by your club to continue.
        </p>
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Passcode"
          autoFocus
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          style={{ width: '100%', boxSizing: 'border-box', padding: '11px 12px', fontSize: 15,
            border: '1px solid #D4D9DD', borderRadius: 9, outline: 'none', marginBottom: 10 }}
        />
        {gate.error && (
          <p style={{ color: '#B00020', margin: '0 0 10px', fontSize: 13 }}>{gate.error}</p>
        )}
        <button
          type="button"
          onClick={onSubmit}
          disabled={busy}
          style={{ width: '100%', padding: '11px 12px', fontSize: 15, fontWeight: 600,
            color: '#fff', background: busy ? '#8A9299' : '#15191C', border: 'none',
            borderRadius: 9, cursor: busy ? 'default' : 'pointer' }}
        >
          {busy ? 'Checking…' : 'Continue'}
        </button>
      </div>
    </div>
  )
}
