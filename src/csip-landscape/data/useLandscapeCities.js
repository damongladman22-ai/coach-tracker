import { useEffect, useState } from 'react'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { cityDots, worldCityDots } from './landscapeCities'

/**
 * useLandscapeCities — hometown places for one division segment x season, from
 * program_benchmark_city (backlog G5, 2026-10-16), or with `world` the
 * international places from program_benchmark_world_city. Loads only when
 * `enabled` (the map's Cities view), since a division can have a few thousand places.
 *
 * Portable: takes the Supabase `client`. A failed read (for example before the
 * table exists) returns error and no dots; the map then says the view is not
 * available.
 *
 * Returns { loading, error, dots, placed, max, places }.
 */
const EMPTY = { loading: false, error: null, dots: [], placed: 0, max: 0, places: 0 }

export function useLandscapeCities(client, { division, gender, season, conference = 'ALL', enabled = true, world = false }) {
  const [state, setState] = useState(EMPTY)
  const key = enabled && client && division && gender && season != null ? `${world ? 'world' : 'us'}|${division}|${gender}|${conference}|${season}` : null

  useEffect(() => {
    if (!key) return
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))
    ;(async () => {
      try {
        const rows = world
          ? await fetchAllRows(client, 'program_benchmark_world_city', 'geonameid, country, city, map_x, map_y, n',
            q => q.eq('division', division).eq('program_gender', gender).eq('conference', conference)
              .eq('roster_season', season).order('geonameid'), 1000)
          : await fetchAllRows(client, 'program_benchmark_city', 'state, geoid, city, map_x, map_y, n',
            q => q.eq('division', division).eq('program_gender', gender).eq('conference', conference)
              .eq('roster_season', season).order('state').order('geoid'), 1000)
        if (cancelled) return
        setState({ loading: false, error: null, ...(world ? worldCityDots(rows) : cityDots(rows)) })
      } catch (e) {
        if (!cancelled) setState({ ...EMPTY, error: e?.message || String(e) })
      }
    })()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])

  return key ? state : EMPTY
}
