import { useEffect, useState } from 'react'

/**
 * useLandscapeGeo — loads the pre-computed recruiting-geography distribution for
 * one segment × season from program_benchmark_geo (division-level or conference).
 *
 * Portable: takes the Supabase `client`; reads only the substrate table via the
 * injected client. Player-level counts by U.S. state and by country, plus the
 * segment total and unknown count (for denominators and an "unlisted" note).
 *
 * Returns: { loading, error, states:{name:count}, countries:{name:count}, total, unknown }
 */
export function useLandscapeGeo(client, { division, gender, season, conference = 'ALL' }) {
  const [state, setState] = useState({
    loading: true, error: null, states: {}, countries: {}, total: 0, unknown: 0,
  })

  useEffect(() => {
    if (!client || !division || !gender || season == null) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const { data, error } = await client
          .from('program_benchmark_geo')
          .select('dimension, bucket, n')
          .eq('division', division)
          .eq('program_gender', gender)
          .eq('conference', conference)
          .eq('roster_season', season)
        if (cancelled) return
        if (error) throw error

        const states = {}, countries = {}
        let total = 0, unknown = 0
        for (const r of data || []) {
          if (r.dimension === 'state') states[r.bucket] = r.n
          else if (r.dimension === 'country') countries[r.bucket] = r.n
          else if (r.dimension === 'meta') {
            if (r.bucket === 'total_players') total = r.n
            else if (r.bucket === 'unknown') unknown = r.n
          }
        }
        setState({ loading: false, error: null, states, countries, total, unknown })
      } catch (e) {
        if (!cancelled) {
          setState({ loading: false, error: e?.message || String(e), states: {}, countries: {}, total: 0, unknown: 0 })
        }
      }
    })()

    return () => { cancelled = true }
  }, [client, division, gender, season, conference])

  return state
}
