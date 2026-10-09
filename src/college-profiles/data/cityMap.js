/**
 * cityMap — the pure part of the Recruiting geography "Cities" view (backlog
 * G5, Damon 2026-10-09: "Profile map, U.S. cities"). Tested by
 * test/cityMap.test.mjs.
 *
 * A scope from geographyOverTime carries cities: {'state|city': players}. The
 * map positions come from the hometown_geocodes table (pipeline
 * build_hometown_geocodes.py): the U.S. Census point of each hometown,
 * projected onto this card's 960 x 600 U.S. map. About 97.5% of U.S.
 * players' hometowns are placed; the rest (regions like "Long Island", or a
 * name several towns in a state share) are counted but get no dot, and the
 * card says how many.
 */
export const STATE_ABBR = {
  Alabama: 'AL', Alaska: 'AK', Arizona: 'AZ', Arkansas: 'AR', California: 'CA', Colorado: 'CO',
  Connecticut: 'CT', Delaware: 'DE', 'District of Columbia': 'DC', Florida: 'FL', Georgia: 'GA',
  Hawaii: 'HI', Idaho: 'ID', Illinois: 'IL', Indiana: 'IN', Iowa: 'IA', Kansas: 'KS', Kentucky: 'KY',
  Louisiana: 'LA', Maine: 'ME', Maryland: 'MD', Massachusetts: 'MA', Michigan: 'MI', Minnesota: 'MN',
  Mississippi: 'MS', Missouri: 'MO', Montana: 'MT', Nebraska: 'NE', Nevada: 'NV', 'New Hampshire': 'NH',
  'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY', 'North Carolina': 'NC', 'North Dakota': 'ND',
  Ohio: 'OH', Oklahoma: 'OK', Oregon: 'OR', Pennsylvania: 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
  'South Dakota': 'SD', Tennessee: 'TN', Texas: 'TX', Utah: 'UT', Vermont: 'VT', Virginia: 'VA',
  Washington: 'WA', 'West Virginia': 'WV', Wisconsin: 'WI', Wyoming: 'WY', 'Puerto Rico': 'PR',
}

/** 'Ohio|Dublin' -> { state: 'Ohio', city: 'Dublin' } (a city may itself contain '|' only in theory). */
export function splitKey(k) {
  const i = k.indexOf('|')
  return { state: k.slice(0, i), city: k.slice(i + 1) }
}

/** Display label: 'Dublin, OH'. */
export function cityLabel(state, city) {
  return `${city.trim()}, ${STATE_ABBR[state.trim()] || state.trim()}`
}

/**
 * The cities of one scope, ready to draw.
 *   cities   {'state|city': players}
 *   points   Map('state|city' -> {x, y}) from useHometownGeocodes
 * Returns { dots, ranked, placed, unplaced, max }:
 *   dots     placed cities, largest first (so small dots draw on top)
 *   ranked   every city with a count, placed or not, most players first, then name
 *   placed / unplaced   players with / without a dot
 */
export function cityDots(cities, points) {
  const ranked = []
  let placed = 0, unplaced = 0, max = 0
  for (const [k, n] of Object.entries(cities || {})) {
    const { state, city } = splitKey(k)
    const p = points ? points.get(k) : null
    const row = { key: k, state, city, label: cityLabel(state, city), n, x: p ? p.x : null, y: p ? p.y : null }
    ranked.push(row)
    if (p) { placed += n; if (n > max) max = n } else unplaced += n
  }
  ranked.sort((a, b) => b.n - a.n || a.label.localeCompare(b.label))
  const dots = ranked.filter(r => r.x != null)
  return { dots, ranked, placed, unplaced, max }
}

/** Dot radius in map units (the map is 960 wide): area grows with players. */
export function dotRadius(n, max) {
  if (!max) return 0
  return 2.2 + 8.8 * Math.sqrt(n / max)
}
