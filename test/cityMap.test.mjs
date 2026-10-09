/**
 * Tests for the G5 Cities view: src/college-profiles/data/cityMap.js and the
 * cities counts in metrics.geographyOverTime. Plain node, no deps.
 *
 *     npm test          (or: node test/cityMap.test.mjs)
 */
import { cityDots, cityLabel, splitKey, dotRadius, STATE_ABBR } from '../src/college-profiles/data/cityMap.js'
import { geographyOverTime, cityKey } from '../src/college-profiles/data/metrics.js'

let failed = 0
function check(name, cond, detail) {
  if (cond) { console.log('  ok   ' + name) }
  else { failed++; console.log('  FAIL ' + name + (detail ? '  -> ' + detail : '')) }
}

check('50 states + DC + PR', Object.keys(STATE_ABBR).length === 52)
check('key round trip', JSON.stringify(splitKey(cityKey('Ohio', 'Dublin'))) === '{"state":"Ohio","city":"Dublin"}')
check('label', cityLabel('Ohio', 'Dublin') === 'Dublin, OH' && cityLabel('Ontario', 'Toronto') === 'Toronto, Ontario')

// geographyOverTime counts cities with the stored strings, U.S. only
const us = (season, pid, state, city, country = 'United States') =>
  ({ roster_season: season, player_id: pid, hometown_state: state, hometown_city: city, hometown_country: country })
const rosters = [
  us(2025, 'a', 'Ohio', 'Dublin'), us(2026, 'a', 'Ohio', 'Dublin'),
  us(2026, 'b', 'Ohio', 'Dublin'), us(2026, 'c', 'Ohio', 'Columbus'),
  us(2026, 'd', 'Ohio', null),                     // state only: counts for Ohio, no city
  us(2026, 'e', null, 'London', 'England'),          // international: no city
  us(2026, 'f', 'Michigan', 'Ann Arbor', null),      // no country, has a state: U.S.
  us(2026, null, 'Ohio', 'Dublin'),                  // unlinked row: rosters only
]
const g = geographyOverTime(rosters, [2025, 2026])
check('roster view counts every row', g.byRoster[2026].cities['Ohio|Dublin'] === 3, JSON.stringify(g.byRoster[2026].cities))
check('state-only player has no city', !Object.keys(g.byRoster[2026].cities).some(k => k.startsWith('Ohio|null')) &&
  g.byRoster[2026].states.Ohio === 5)
check('international player has no city', !Object.keys(g.byRoster[2026].cities).some(k => k.includes('London')))
check('state with no country counts as U.S.', g.byRoster[2026].cities['Michigan|Ann Arbor'] === 1)
check('all-time counts each player once', g.all.cities['Ohio|Dublin'] === 2, JSON.stringify(g.all.cities))
check('recruiting class = first season seen', g.byRecruit[2025].cities['Ohio|Dublin'] === 1 &&
  g.byRecruit[2026].cities['Ohio|Dublin'] === 1)

// dots
const points = new Map([['Ohio|Dublin', { x: 730, y: 250 }], ['Ohio|Columbus', { x: 737, y: 253 }]])
const cd = cityDots({ 'Ohio|Dublin': 3, 'Ohio|Columbus': 1, 'Michigan|Ann Arbor': 1, 'New York|Long Island': 2 }, points)
check('placed and unplaced players', cd.placed === 4 && cd.unplaced === 3)
check('dots only for placed cities, largest first', cd.dots.map(d => d.city).join() === 'Dublin,Columbus')
check('ranked lists every city, most players then name', cd.ranked.map(d => d.city).join() === 'Dublin,Long Island,Ann Arbor,Columbus',
  cd.ranked.map(d => d.city).join())
check('max over placed only', cd.max === 3)
check('no cities', cityDots({}, points).dots.length === 0 && cityDots(undefined, null).ranked.length === 0)
check('radius grows with players and stays positive', dotRadius(1, 9) > 2 && dotRadius(9, 9) > dotRadius(4, 9) &&
  Math.abs(dotRadius(9, 9) - 11) < 1e-9 && dotRadius(1, 0) === 0)

console.log(failed ? `\n${failed} FAILED` : '\nall passed')
process.exit(failed ? 1 : 0)
