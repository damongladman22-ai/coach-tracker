import { useEffect, useMemo, useState } from 'react'
import { cityKey } from './metrics'

/**
 * useHometownGeocodes — map positions for a program's U.S. hometowns
 * (backlog G5). Reads hometown_geocodes (public read; pipeline
 * build_hometown_geocodes.py) for the distinct (state, city) pairs on the
 * program's rosters, in chunks so the request stays short.
 *
 *   rosters  every loaded roster row (all seasons)
 * Returns { loading, error, points } where points is
 *   Map('state|city' -> { x, y }) — x / y on the 960 x 600 profile map —
 * or null until loaded. A failure leaves points null and the card keeps its
 * state map.
 */
const CHUNK = 60
const US = new Set(['', 'United States', 'USA', 'US', 'U.S.', 'U.S.A.'])

function pairsOf(rosters) {
  const seen = new Map()
  for (const r of rosters || []) {
    const st = r.hometown_state, city = r.hometown_city
    if (!st || !st.trim() || !city || !city.trim()) continue
    if (!US.has((r.hometown_country || '').trim())) continue
    const k = cityKey(st, city)
    if (!seen.has(k)) seen.set(k, { state: st, city })
  }
  return [...seen.values()].sort((a, b) => (a.state + a.city).localeCompare(b.state + b.city))
}

export function useHometownGeocodes(client, rosters) {
  const pairs = useMemo(() => pairsOf(rosters), [rosters])
  const key = useMemo(() => pairs.map(p => cityKey(p.state, p.city)).join('\n'), [pairs])
  const [state, setState] = useState({ key: null, points: null, error: null })

  useEffect(() => {
    if (!client || !key) return
    let alive = true
    ;(async () => {
      const list = key.split('\n').map(k => { const i = k.indexOf('|'); return { state: k.slice(0, i), city: k.slice(i + 1) } })
      const points = new Map()
      try {
        for (let i = 0; i < list.length; i += CHUNK) {
          const part = list.slice(i, i + CHUNK)
          const { data, error } = await client
            .from('hometown_geocodes')
            .select('state, city, map_x, map_y')
            .in('state', [...new Set(part.map(p => p.state))])
            .in('city', [...new Set(part.map(p => p.city))])
          if (error) throw error
          for (const r of data || []) points.set(cityKey(r.state, r.city), { x: Number(r.map_x), y: Number(r.map_y) })
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
