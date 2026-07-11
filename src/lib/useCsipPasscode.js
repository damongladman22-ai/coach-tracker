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
 * Returns { status, error, submit }:
 *   status 'checking' | 'granted' | 'needed'
 *   submit(candidate) -> Promise<boolean>  (also flips status to 'granted' on success)
 */
const STORAGE_KEY = 'csip_passcode'

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
      setError('That passcode isn’t right.')
      return false
    } catch (_e) {
      setError('Couldn’t verify right now — try again.')
      return false
    }
  }, [client])

  return { status, error, submit }
}
