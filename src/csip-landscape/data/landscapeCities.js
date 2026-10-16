/**
 * landscapeCities — the pure part of the Landscape Recruiting geography
 * "Cities" view (backlog G5, Damon 2026-10-16: both, Landscape first).
 * Tested by test/landscapeCities.test.mjs.
 *
 * Rows come from program_benchmark_city (pipeline
 * out_sql/34_program_benchmark_city.sql): one per division x gender x season x
 * hometown place, with the place's position on the 960 x 600 U.S. map (the same
 * map and projection as the College Profile Cities view) and its players.
 */
import { cityLabel } from '../../college-profiles/data/cityMap.js'

/**
 * rows: [{ state, city, map_x, map_y, n }] -> { dots, placed, max, places }
 *   dots    every place, largest first (so small dots draw on top), with label
 *   placed  players with a dot
 */
export function cityDots(rows) {
  const dots = []
  let placed = 0, max = 0
  for (const r of rows || []) {
    const n = Number(r.n) || 0
    if (r.map_x == null || r.map_y == null || r.map_x === '' || r.map_y === '') continue
    const x = Number(r.map_x), y = Number(r.map_y)
    if (!n || !Number.isFinite(x) || !Number.isFinite(y)) continue
    dots.push({ key: `${r.state}|${r.geoid || r.city}`, state: r.state, city: r.city, label: cityLabel(r.state, r.city), n, x, y })
    placed += n
    if (n > max) max = n
  }
  dots.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  return { dots, placed, max, places: dots.length }
}

/**
 * Dot radius in map units. A division has thousands of places, so dots start
 * smaller than on a single program's map (1.3 there 2.2) and grow with the
 * square root of players, so area tracks players.
 */
export function dotRadius(n, max) {
  if (!max) return 0
  return 1.3 + 7.7 * Math.sqrt(n / max)
}

/** U.S. players with no dot: the state total minus those placed (never below zero). */
export function unplacedCount(states, placed) {
  const us = Object.values(states || {}).reduce((a, b) => a + (Number(b) || 0), 0)
  return Math.max(0, us - (placed || 0))
}
