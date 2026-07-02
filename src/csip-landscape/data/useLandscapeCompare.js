import { useEffect, useState } from 'react'

/**
 * useLandscapeCompare — loads benchmark rows for up to four arbitrary segments
 * (division × gender × season, conference-level 'ALL') in one pass, so the
 * Compare lens can line them up. Called with a stable-length-agnostic array;
 * internally batches the reads (Promise.all) to avoid calling a hook per segment.
 *
 * Returns { loading, error, get(segIndex, dimension, bucket, metric) } where get
 * returns { median, p25, p75, n } or null when absent for that segment.
 */
const DIMENSIONS = ['overall', 'origin', 'position', 'class']
const METRICS = ['height_inches', 'roster_size', 'return_rate', 'newcomer_rate', 'share', 'count']

export function useLandscapeCompare(client, segments) {
  const key = JSON.stringify(segments)
  const [state, setState] = useState({ loading: true, error: null, indexes: [] })

  useEffect(() => {
    if (!client || !segments || segments.length === 0) {
      setState({ loading: false, error: null, indexes: [] })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const results = await Promise.all(segments.map(sg =>
          client
            .from('program_benchmarks')
            .select('dimension, bucket, metric, n, median, p25, p75')
            .eq('division', sg.division)
            .eq('program_gender', sg.gender)
            .eq('conference', 'ALL')
            .eq('roster_season', sg.season)
            .in('dimension', DIMENSIONS)
            .in('metric', METRICS)
        ))
        if (cancelled) return
        const bad = results.find(r => r.error)
        if (bad) throw bad.error

        const indexes = results.map(r => {
          const idx = {}
          for (const row of r.data || []) {
            idx[`${row.dimension}|${row.bucket}|${row.metric}`] = {
              median: row.median, p25: row.p25, p75: row.p75, n: row.n,
            }
          }
          return idx
        })
        setState({ loading: false, error: null, indexes })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), indexes: [] })
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key])

  const get = (i, dimension, bucket, metric) =>
    state.indexes[i]?.[`${dimension}|${bucket}|${metric}`] || null

  return { loading: state.loading, error: state.error, get }
}
