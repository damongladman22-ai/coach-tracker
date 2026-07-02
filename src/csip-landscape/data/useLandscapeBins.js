import { useEffect, useState } from 'react'

/**
 * useLandscapeBins — loads histogram bins for a set of segments (division ×
 * gender × season, conference 'ALL') for one dimension+metric, so the density
 * cards can draw real distributions. Batches the reads (Promise.all) rather than
 * calling a hook per segment.
 *
 * Returns { loading, error, get(segIndex, bucket) } → array of
 * { lo, hi, count } sorted by lo (empty array when absent).
 */
export function useLandscapeBins(client, segments, dimension = 'position', metric = 'height_inches') {
  const key = JSON.stringify(segments) + '|' + dimension + '|' + metric
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
            .from('program_benchmark_bins')
            .select('bucket, bin_lower, bin_upper, count')
            .eq('division', sg.division)
            .eq('program_gender', sg.gender)
            .eq('conference', 'ALL')
            .eq('roster_season', sg.season)
            .eq('dimension', dimension)
            .eq('metric', metric)
        ))
        if (cancelled) return
        const bad = results.find(r => r.error)
        if (bad) throw bad.error

        const indexes = results.map(r => {
          const byBucket = {}
          for (const row of r.data || []) {
            ;(byBucket[row.bucket] = byBucket[row.bucket] || []).push({
              lo: Number(row.bin_lower), hi: Number(row.bin_upper), count: row.count,
            })
          }
          for (const b of Object.keys(byBucket)) byBucket[b].sort((a, c) => a.lo - c.lo)
          return byBucket
        })
        setState({ loading: false, error: null, indexes })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), indexes: [] })
      }
    })()

    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key])

  const get = (i, bucket) => state.indexes[i]?.[bucket] || []

  return { loading: state.loading, error: state.error, get }
}
