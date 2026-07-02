import { useEffect, useState } from 'react'

/**
 * useLandscapeTrend — loads every per-season benchmark row for one segment
 * (division × gender, conference-level 'ALL') across 2021–2025, for the metric
 * families the Trend lens can plot. Pooled season 0 is excluded (the Trend axis
 * is the real seasons).
 *
 * Returns { loading, error, get(season, dimension, bucket, metric) } where get
 * returns { median, p25, p75, n, unit } or null when that cell is absent (e.g.
 * retention has no 2021 — the line renders a gap there).
 */
const DIMENSIONS = ['overall', 'origin', 'position', 'class']
const METRICS = ['height_inches', 'roster_size', 'return_rate', 'newcomer_rate', 'share', 'count']

export function useLandscapeTrend(client, { division, gender, conference = 'ALL' }) {
  const [state, setState] = useState({ loading: true, error: null, index: {} })

  useEffect(() => {
    if (!client || !division || !gender) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const { data, error } = await client
          .from('program_benchmarks')
          .select('roster_season, dimension, bucket, metric, n, median, p25, p75, unit')
          .eq('division', division)
          .eq('program_gender', gender)
          .eq('conference', conference)
          .neq('roster_season', 0)
          .in('dimension', DIMENSIONS)
          .in('metric', METRICS)
        if (cancelled) return
        if (error) throw error

        const index = {}
        for (const r of data || []) {
          index[`${r.roster_season}|${r.dimension}|${r.bucket}|${r.metric}`] = {
            median: r.median, p25: r.p25, p75: r.p75, n: r.n, unit: r.unit,
          }
        }
        setState({ loading: false, error: null, index })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), index: {} })
      }
    })()

    return () => { cancelled = true }
  }, [client, division, gender, conference])

  const get = (season, dimension, bucket, metric) =>
    state.index[`${season}|${dimension}|${bucket}|${metric}`] || null

  return { loading: state.loading, error: state.error, get }
}
