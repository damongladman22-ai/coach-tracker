import { useEffect, useMemo, useState } from 'react'
import { cityKey } from './metrics'

/**
 * useWorldGeocodes — map positions for a program's international hometowns
 * (backlog G5 world cities, 2026-10-16). Reads world_hometown_geocodes (public
 * read; pipeline build_world_geocodes.py, GeoNames places, CC BY 4.0) for the
 * distinct (country, city) pairs on the program's rosters, in chunks.
 *
 *   rosters  every loaded roster row (all seasons)
 * Returns { loading, error, points } where points is
 *   Map('country|city' -> { x, y }) on the profile world map, or null until
 * loaded. A failure leaves points null and the card keeps its country map.
 */
const CHUNK = 60
const US = new Set(['', 'United States', 'USA', 'US', 'U.S.', 'U.S.A.'])

function pairsOf(rosters) {
  const seen = new Map()
  for (const r of rosters || []) {
    const country = (r.hometown_country || '').trim(), city = r.hometown_city
    if (US.has(country) || !city || !city.trim()) continue
    const k = cityKey(r.hometown_country, city)
    if (!seen.has(k)) seen.set(k, { country: r.hometown_country, city })
  }
  return [...seen.values()].sort((a, b) => (a.country + a.city).localeCompare(b.country + b.city))
}

export function useWorldGeocodes(client, rosters) {
  const pairs = useMemo(() => pairsOf(rosters), [rosters])
  const key = useMemo(() => pairs.map(p => cityKey(p.country, p.city)).join('\n'), [pairs])
  const [state, setState] = useState({ key: null, points: null, error: null })

  useEffect(() => {
    if (!client || !key) return
    let alive = true
    ;(async () => {
      const list = key.split('\n').map(k => { const i = k.indexOf('|'); return { country: k.slice(0, i), city: k.slice(i + 1) } })
      const points = new Map()
      try {
        for (let i = 0; i < list.length; i += CHUNK) {
          const part = list.slice(i, i + CHUNK)
          const { data, error } = await client
            .from('world_hometown_geocodes')
            .select('country, city, map_x, map_y')
            .in('country', [...new Set(part.map(p => p.country))])
            .in('city', [...new Set(part.map(p => p.city))])
          if (error) throw error
          for (const r of data || []) points.set(cityKey(r.country, r.city), { x: Number(r.map_x), y: Number(r.map_y) })
        }
        if (alive) setState({ key, points, error: null })
      } catch (e) {
        if (alive) setState({ key, points: null, error: e?.message || String(e) })
      }
    })()
    return () => { alive = false }
  }, [client, key])

  const ready = key !== '' && state.key === key
  return { loading: key !== '' && !ready, error: ready ? state.error : null, points: ready ? state.points : null }
}
