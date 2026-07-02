import { useEffect, useState } from 'react'

/**
 * useLandscapeGeoTrend — loads recruiting geography for ONE segment across every
 * season in a single query, grouped by roster_season. Companion to
 * useLandscapeGeo (single season); powers the footprint-over-time choropleth and
 * the domestic-vs-international trend in the Trend lens.
 *
 * Returns: { loading, error, bySeason: { [season]: { states, countries, total,
 *   unknown, domestic, intl } } }
 */
export function useLandscapeGeoTrend(client, { division, gender, conference = 'ALL' }) {
  const [state, setState] = useState({ loading: true, error: null, bySeason: {} })

  useEffect(() => {
    if (!client || !division || !gender) return
    let cancelled = false
    setState({ loading: true, error: null, bySeason: {} })

    ;(async () => {
      try {
        const { data, error } = await client
          .from('program_benchmark_geo')
          .select('dimension, bucket, n, roster_season')
          .eq('division', division)
          .eq('program_gender', gender)
          .eq('conference', conference)
        if (cancelled) return
        if (error) throw error

        const bySeason = {}
        for (const r of data || []) {
          const s = r.roster_season
          if (!bySeason[s]) bySeason[s] = { states: {}, countries: {}, total: 0, unknown: 0, domestic: 0, intl: 0 }
          const slot = bySeason[s]
          if (r.dimension === 'state') { slot.states[r.bucket] = r.n; slot.domestic += r.n }
          else if (r.dimension === 'country') { slot.countries[r.bucket] = r.n; slot.intl += r.n }
          else if (r.dimension === 'meta') {
            if (r.bucket === 'total_players') slot.total = r.n
            else if (r.bucket === 'unknown') slot.unknown = r.n
          }
        }
        setState({ loading: false, error: null, bySeason })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), bySeason: {} })
      }
    })()

    return () => { cancelled = true }
  }, [client, division, gender, conference])

  return state
}
