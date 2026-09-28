import { useEffect, useState } from 'react'

/**
 * useProgramTransfers — this program's CONFIRMED transfer counts, from
 * program_transfer_summary (rebuilt by public.rebuild_transfer_metrics()).
 *
 * COUNTS ONLY, BY DESIGN. The underlying player_transfers rows are not readable
 * by the app: every one is an unreviewed assertion about a real person. This
 * table holds, per program and season, how many confirmed transfers arrived
 * ('in') or left ('out'), by the other program's division and by the direction
 * of the move (up / down / lateral).
 *
 * roster_season is the season the player appeared at the DESTINATION.
 *
 * `span` is the census window — the first and last season present anywhere in
 * the table — read rather than hard-coded, so it does not go stale when the
 * census is extended. A card uses it as the denominator's season range.
 *
 * NON-CRITICAL. A failure returns empty rows and never blanks the profile: the
 * card falls back to its class-year level, which needs no transfer data.
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, rows, span }.
 */
export function useProgramTransfers(client, schoolId) {
  const [state, setState] = useState({ loading: false, error: null, rows: [], span: null })

  useEffect(() => {
    if (!client || !schoolId) {
      setState({ loading: false, error: null, rows: [], span: null })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const [rowsRes, loRes, hiRes] = await Promise.all([
          client.from('program_transfer_summary')
            .select('roster_season, direction, counterpart_division, move, n')
            .eq('school_id', schoolId),
          client.from('program_transfer_summary')
            .select('roster_season').order('roster_season', { ascending: true }).limit(1),
          client.from('program_transfer_summary')
            .select('roster_season').order('roster_season', { ascending: false }).limit(1),
        ])
        if (cancelled) return
        if (rowsRes.error) throw rowsRes.error
        const lo = loRes.data?.[0]?.roster_season ?? null
        const hi = hiRes.data?.[0]?.roster_season ?? null
        setState({
          loading: false, error: null,
          rows: rowsRes.data || [],
          span: lo != null && hi != null ? [lo, hi] : null,
        })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), rows: [], span: null })
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  return state
}
