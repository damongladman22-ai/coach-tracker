import { useEffect, useState } from 'react'

/**
 * useLandscapeBenchmarks — loads the pre-computed benchmark backdrop for one
 * segment × season, division-level (conference='ALL').
 *
 * Portable: takes the Supabase `client` (never imports one). Reads only
 * program_benchmarks via the injected client — never app internals. One query
 * per selection; rows are indexed by `dimension|bucket|metric` for O(1) lookup.
 *
 * Later increments extend this (multi-season for Trend, multi-segment for
 * Compare, program_benchmark_bins for the height histogram, conference scope).
 *
 * Returns: { loading, error, get(dimension, bucket, metric), rows }
 *   get(...) → the matching benchmark row { n, mean, p25, median, p75, unit, agg_level } or null
 */
export function useLandscapeBenchmarks(client, { division, gender, season, conference = 'ALL' }) {
  const [state, setState] = useState({ loading: true, error: null, index: {}, rows: [] })

  useEffect(() => {
    if (!client || !division || !gender || season == null) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const { data, error } = await client
          .from('program_benchmarks')
          .select('dimension, bucket, metric, agg_level, unit, n, mean, p25, median, p75')
          .eq('division', division)
          .eq('program_gender', gender)
          .eq('conference', conference)
          .eq('roster_season', season)
        if (cancelled) return
        if (error) throw error
        const rows = data || []
        const index = {}
        for (const r of rows) index[`${r.dimension}|${r.bucket}|${r.metric}`] = r
        setState({ loading: false, error: null, index, rows })
      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, error: e?.message || String(e), index: {}, rows: [] })
        }
      }
    })()

    return () => { cancelled = true }
  }, [client, division, gender, season, conference])

  const get = (dimension, bucket, metric) =>
    state.index[`${dimension}|${bucket}|${metric}`] || null

  return { loading: state.loading, error: state.error, get, rows: state.rows }
}
