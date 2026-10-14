// Distance search over geo_points (pipeline out_sql/25_geo_points.sql), shared
// by Ask PitchSide (api/ask.js) and the Find programs page. Takes a
// supabase-js client; reads only public reference tables.
import { parseNear, placeKey } from './geo.js'
import { stateAbbr } from './findPrograms.js'

/**
 * "Dublin, OH" / "43017" / "Columbus" ->
 *   { point: { name, state, lat, lon } }
 *   { ambiguous: ['Columbus, OH', 'Columbus, GA', …] }   (town in several states, none given)
 *   { error: 'plain-words reason' }
 */
export async function locatePlace(client, near) {
  const p = parseNear(near)
  if (p.zip) {
    const { data, error } = await client.from('geo_points').select('name,state,lat,lon').eq('kind', 'zip').eq('key', p.zip).limit(1)
    if (error) throw new Error(error.message)
    return data?.[0] ? { point: data[0] } : { error: `No location found for ZIP code ${p.zip}. Try the town and state instead.` }
  }
  if (!p.city) return { error: 'Type a town and state, or a ZIP code.' }
  let q = client.from('geo_points').select('name,state,lat,lon,land_sqmi').eq('kind', 'place').eq('key', p.city)
  if (p.state) q = q.eq('state', p.state)
  const { data, error } = await q.order('land_sqmi', { ascending: false }).limit(12)
  if (error) throw new Error(error.message)
  if (!data?.length) return { error: `Could not find "${String(near).trim()}"${p.state ? '' : ' (no state given)'}. Try a ZIP code, or a nearby larger town with its state.` }
  if (data.length > 1 && !p.state) return { ambiguous: data.map(d => d.name) }
  return { point: data[0] }
}

/**
 * Where each program is: its college's College Scorecard point when known,
 * else its own town found in geo_points.
 *   schools: [{ id, city, state }]   facts: Map(school_id -> { latitude, longitude })
 * Returns Map(school_id -> { lat, lon }).
 */
export async function programPoints(client, schools, facts) {
  const pts = new Map(), want = new Map()
  for (const s of schools) {
    const f = facts.get(s.id)
    if (f?.latitude != null && f?.longitude != null) { pts.set(s.id, { lat: Number(f.latitude), lon: Number(f.longitude) }); continue }
    const st = stateAbbr(s.state), k = placeKey(s.city)
    if (st && k) want.set(s.id, [st, k])
  }
  const keys = [...new Set([...want.values()].map(([, k]) => k))]
  const found = new Map()
  const chunks = []
  for (let i = 0; i < keys.length; i += 150) chunks.push(keys.slice(i, i + 150))
  // All chunks at once rather than one after another.
  const results = await Promise.all(chunks.map(c =>
    client.from('geo_points').select('state,key,lat,lon').eq('kind', 'place').in('key', c)))
  for (const { data, error } of results) {
    if (error) throw new Error(error.message)
    for (const g of data || []) found.set(g.state + '|' + g.key, { lat: g.lat, lon: g.lon })
  }
  for (const [id, [st, k]] of want) { const g = found.get(st + '|' + k); if (g) pts.set(id, g) }
  return pts
}
