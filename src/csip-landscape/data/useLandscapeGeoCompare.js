import { useEffect, useState } from 'react'

/**
 * useLandscapeGeoCompare — loads recruiting geography for each compare segment
 * (division × gender × season, conference ALL) in parallel. Companion to
 * useLandscapeGeo/useLandscapeGeoTrend; powers side-by-side footprint maps.
 *
 * Returns: { loading, error, data:[{states,countries,total,unknown,domestic,intl}], get(i) }
 */
export function useLandscapeGeoCompare(client, segments) {
  const [state, setState] = useState({ loading: true, error: null, data: [] })
  const key = JSON.stringify((segments || []).map(s => [s.division, s.gender, s.season]))

  useEffect(() => {
    if (!client || !segments?.length) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const results = await Promise.all(segments.map(async sg => {
          const { data, error } = await client
            .from('program_benchmark_geo')
            .select('dimension, bucket, n')
            .eq('division', sg.division)
            .eq('program_gender', sg.gender)
            .eq('conference', 'ALL')
            .eq('roster_season', sg.season)
          if (error) throw error
          const states = {}, countries = {}
          let total = 0, unknown = 0, domestic = 0, intl = 0
          for (const r of data || []) {
            if (r.dimension === 'state') { states[r.bucket] = r.n; domestic += r.n }
            else if (r.dimension === 'country') { countries[r.bucket] = r.n; intl += r.n }
            else if (r.dimension === 'meta') {
              if (r.bucket === 'total_players') total = r.n
              else if (r.bucket === 'unknown') unknown = r.n
            }
          }
          return { states, countries, total, unknown, domestic, intl }
        }))
        if (!cancelled) setState({ loading: false, error: null, data: results })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), data: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, key])

  return { ...state, get: i => state.data[i] }
}
