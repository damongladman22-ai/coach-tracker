import { useEffect, useState } from 'react'

/**
 * useDepartureOutlook — this program's expected early-departure rate for next
 * season, from program_departure_outlook (pipeline out_sql/20, rebuilt with
 * the Find programs outlook). Backlog G8, Damon 2026-10-09.
 *
 * One row per program: outlook_rate (the rate), transitions (back-to-back
 * season pairs behind it) and basis ('program', or 'division' when none are
 * tracked). Projected openings multiplies its early-leaver base by this rate,
 * exactly as Find programs does, so the card and the list agree.
 *
 * NON-CRITICAL. A failure or a missing row returns outlook null and the card
 * falls back to the program's raw own average (the pre-G8 behaviour).
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, outlook: { rate, transitions, basis } | null }.
 */
export function useDepartureOutlook(client, schoolId) {
  const [state, setState] = useState({ loading: !!(client && schoolId), error: null, outlook: null })

  useEffect(() => {
    if (!client || !schoolId) {
      setState({ loading: false, error: null, outlook: null })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const res = await client.from('program_departure_outlook')
          .select('outlook_rate, transitions, basis')
          .eq('school_id', schoolId)
          .maybeSingle()
        if (cancelled) return
        if (res.error) throw res.error
        const r = res.data
        setState({
          loading: false, error: null,
          outlook: r ? { rate: r.outlook_rate == null ? null : Number(r.outlook_rate), transitions: r.transitions, basis: r.basis } : null,
        })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), outlook: null })
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  return state
}
