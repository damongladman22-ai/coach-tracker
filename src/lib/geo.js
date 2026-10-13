// Distance search helpers (backlog F2, 2026-10-13: "schools in a 100 mile
// radius of a city or zip code"). Pure; no imports beyond findPrograms.js.
//
// placeKey() reduces a town name exactly as the pipeline's
// src/geo/census_places.key() does, so "St. Marys" here finds the geo_points
// row filed under "saint marys". Keep the two in step.
import { STATES, stateAbbr } from './findPrograms.js'

const ABBREV = { st: 'saint', ste: 'sainte', ft: 'fort', mt: 'mount', mtn: 'mountain', pt: 'point' }

export function placeKey(s) {
  const t = String(s || '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase()
    .replace(/&/g, ' and ').replace(/[’'`.]/g, '').replace(/[-/,]/g, ' ').replace(/[^a-z0-9 ]/g, ' ')
  const out = []
  for (const w0 of t.split(/\s+/).filter(Boolean)) {
    const w = ABBREV[w0] || w0
    if (out.length && out[out.length - 1] === 'mc') out[out.length - 1] = 'mc' + w
    else out.push(w)
  }
  return out.join(' ')
}

/** Great-circle distance in miles between two {lat, lon} points. */
export function milesBetween(a, b) {
  const r = Math.PI / 180
  const la1 = a.lat * r, la2 = b.lat * r, dla = (b.lat - a.lat) * r, dlo = (b.lon - a.lon) * r
  const h = Math.sin(dla / 2) ** 2 + Math.cos(la1) * Math.cos(la2) * Math.sin(dlo / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

const NAMES_LONGEST_FIRST = STATES.map(([a, n]) => [n.toLowerCase(), a]).sort((x, y) => y[0].length - x[0].length)

/**
 * What a person wrote -> { zip } or { city, state|null }.
 *   "43017", "43017-1234", "zip 43017"   -> { zip: '43017' }
 *   "Dublin, OH", "Dublin OH", "Dublin, Ohio", "dublin ohio" -> { city: 'dublin', state: 'OH' }
 *   "Columbus"                             -> { city: 'columbus', state: null }
 */
export function parseNear(text) {
  const raw = String(text || '').trim().replace(/,?\s*(usa|u\.s\.a\.?|united states)$/i, '').trim()
  const zip = raw.match(/\b(\d{5})(?:-\d{4})?\b/)
  if (zip) return { zip: zip[1] }
  let city = raw, state = null
  const parts = raw.split(',').map(x => x.trim()).filter(Boolean)
  if (parts.length >= 2 && stateAbbr(parts[parts.length - 1])) {
    state = stateAbbr(parts[parts.length - 1])
    city = parts.slice(0, -1).join(' ')
  } else {
    const m = raw.match(/^(.+?)\s+([A-Za-z]{2})\.?$/)
    if (m && stateAbbr(m[2])) {
      city = m[1]; state = stateAbbr(m[2])
    } else {
      const low = raw.toLowerCase()
      const hit = NAMES_LONGEST_FIRST.find(([n]) => low.endsWith(' ' + n) && low.length > n.length + 1)
      if (hit) { city = raw.slice(0, raw.length - hit[0].length); state = hit[1] }
    }
  }
  return { city: placeKey(city), state }
}
