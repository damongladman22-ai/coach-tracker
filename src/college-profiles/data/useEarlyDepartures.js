import { useEffect, useState } from 'react'

/**
 * useEarlyDepartures — this program's early leavers and how many of them are
 * CONFIRMED at another college program the next season, from
 * program_early_departures (rebuilt by public.rebuild_early_departure_metrics()).
 *
 * COUNTS ONLY. One row per from_season: eligible, leavers, moved_on. The
 * definition of an early leaver is the one nonSeniorReturnRate() uses, and
 * leavers and moved_on come from the same rebuild, so the card never mixes a
 * count computed in the browser with one computed in the database.
 *
 * Only seasons inside the transfer census window exist in the table: outside
 * it no transfer could have been confirmed, and a zero there would be false.
 *
 * NON-CRITICAL. A failure returns no rows and the card simply omits the split.
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, rows }.
 */
export function useEarlyDepartures(client, schoolId) {
  const [state, setState] = useState({ loading: false, error: null, rows: [] })

  useEffect(() => {
    if (!client || !schoolId) {
      setState({ loading: false, error: null, rows: [] })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const res = await client.from('program_early_departures')
          .select('from_season, eligible, leavers, moved_on')
          .eq('school_id', schoolId)
          .order('from_season', { ascending: true })
        if (cancelled) return
        if (res.error) throw res.error
        setState({ loading: false, error: null, rows: res.data || [] })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), rows: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  return state
}
