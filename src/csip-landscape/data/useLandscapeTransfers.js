import { useEffect, useState } from 'react'

/**
 * useLandscapeTransfers — traced transfer flows for one gender, from
 * program_transfer_flows (rebuilt by public.rebuild_transfer_metrics()).
 *
 * COUNTS ONLY, and only flows of 3 or more: smaller flows are not stored,
 * because a flow of one or two between two conferences can point at a specific
 * person. Every underlying player_transfers row is an unreviewed assertion, so
 * the table is aggregate by design.
 *
 * Loads every row for the gender (a few hundred at most) and lets the lens pick
 * the season: flows exist only for the transfer census window (the destination
 * seasons in the table), with roster_season 0 = the window pooled.
 *
 * Returns { loading, error, rows, seasons } — seasons = the real destination
 * seasons present, ascending.
 */
export function useLandscapeTransfers(client, { gender }) {
  const [state, setState] = useState({ loading: true, error: null, rows: [], seasons: [] })

  useEffect(() => {
    if (!client || !gender) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const { data, error } = await client
          .from('program_transfer_flows')
          .select('roster_season, level, from_group, to_group, from_division, to_division, move, n')
          .eq('program_gender', gender)
          .range(0, 4999)
        if (cancelled) return
        if (error) throw error
        const rows = data || []
        const seasons = [...new Set(rows.map(r => r.roster_season).filter(s => s !== 0))].sort((a, b) => a - b)
        setState({ loading: false, error: null, rows, seasons })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), rows: [], seasons: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, gender])

  return state
}
