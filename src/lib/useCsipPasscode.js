import { useEffect, useState, useCallback } from 'react'

/**
 * useCsipPasscode — client side of the CSIP shared-passcode fence.
 *
 * The secret never lives here: this only calls the SECURITY DEFINER RPC
 * verify_csip_passcode(candidate), which returns true/false. On mount it
 * re-verifies the phrase saved in this browser's localStorage, so a rotation
 * (changing the stored hash in the DB) silently invalidates everyone on the old
 * phrase the next time they load. Enter once, survives refreshes, auto-expires
 * on rotation.
 *
 * `active` lets the caller skip all work for viewers who don't need the fence
 * (e.g. the platform owner, who bypasses it): when false the hook stays idle.
 *
 * RATE LIMIT (backlog P2, 2026-10-10): the database refuses a network after 10
 * wrong passcodes in 15 minutes (a correct one is never counted). The refusal
 * is an RPC error with hint 'rate_limited', not a false, so it is shown as its
 * own message, and a phrase already saved in this browser is NOT cleared on any
 * error: only a definite "wrong" (false) clears it. Before this, a parent who
 * had entered the right passcode would have been logged out by someone else's
 * wrong tries on the same Wi-Fi.
 *
 * Returns { status, error, submit }:
 *   status 'checking' | 'granted' | 'needed'
 *   submit(candidate) -> Promise<boolean>  (also flips status to 'granted' on success)
 */
const STORAGE_KEY = 'csip_passcode'

function isRateLimited(err) {
  return !!err && (err.hint === 'rate_limited' || /^Too many/.test(err.message || ''))
}
const RETRY_MSG = 'Couldn’t verify right now — try again.'

export function useCsipPasscode(client, active = true) {
  const [status, setStatus] = useState('checking')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!client || !active) { setStatus('checking'); return }
    let cancelled = false

    const check = async () => {
      let stored = null
      try { stored = window.localStorage.getItem(STORAGE_KEY) } catch (_e) { /* ignore */ }
      if (!stored) { if (!cancelled) setStatus('needed'); return }
      try {
        const { data, error: rpcErr } = await client.rpc('verify_csip_passcode', { candidate: stored })
        if (cancelled) return
        if (!rpcErr && data === true) {
          setStatus('granted')
        } else if (rpcErr) {
          // Keep the saved phrase: the check failed, it did not say "wrong".
          setError(isRateLimited(rpcErr) ? rpcErr.message : RETRY_MSG)
          setStatus('needed')
        } else {
          try { window.localStorage.removeItem(STORAGE_KEY) } catch (_e) { /* ignore */ }
          setStatus('needed')
        }
      } catch (_e) {
        if (!cancelled) setStatus('needed')
      }
    }

    check()
    return () => { cancelled = true }
  }, [client, active])

  const submit = useCallback(async (candidate) => {
    setError('')
    const phrase = (candidate || '').trim()
    if (!phrase) { setError('Enter the passcode.'); return false }
    try {
      const { data, error: rpcErr } = await client.rpc('verify_csip_passcode', { candidate: phrase })
      if (!rpcErr && data === true) {
        try { window.localStorage.setItem(STORAGE_KEY, phrase) } catch (_e) { /* ignore */ }
        setStatus('granted')
        return true
      }
      if (rpcErr) {
        setError(isRateLimited(rpcErr) ? rpcErr.message : RETRY_MSG)
        return false
      }
      setError('That passcode isn’t right.')
      return false
    } catch (_e) {
      setError(RETRY_MSG)
      return false
    }
  }, [client])

  return { status, error, submit }
}
