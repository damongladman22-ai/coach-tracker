import assert from 'node:assert/strict'
import { cityDots, worldCityDots, dotRadius, unplacedCount } from '../src/csip-landscape/data/landscapeCities.js'

const r = cityDots([
  { state: 'Ohio', geoid: '1', city: 'Dublin', map_x: 700, map_y: 250, n: 3 },
  { state: 'Texas', geoid: '2', city: 'Houston', map_x: '450.5', map_y: '500', n: '12' },
  { state: 'Ohio', geoid: '3', city: 'Avon', map_x: 690, map_y: 240, n: 3 },
  { state: 'Ohio', geoid: '4', city: 'Bad', map_x: null, map_y: 1, n: 5 },
])
assert.deepEqual(r.dots.map(d => d.label), ['Houston, TX', 'Avon, OH', 'Dublin, OH'], 'largest first, then name; unplaceable dropped')
assert.equal(r.placed, 18)
assert.equal(r.max, 12)
assert.equal(r.places, 3)
assert.equal(r.dots[0].x, 450.5, 'numbers coerced')
assert.equal(dotRadius(12, 12), 9)
assert.ok(dotRadius(1, 12) > 1.3 && dotRadius(1, 12) < 4)
assert.equal(dotRadius(1, 0), 0)
assert.equal(unplacedCount({ Ohio: 10, Texas: 12 }, 18), 4)
assert.equal(unplacedCount({ Ohio: 1 }, 5), 0, 'never below zero')
assert.deepEqual(cityDots(null), { dots: [], placed: 0, max: 0, places: 0 })

const w = worldCityDots([
  { geonameid: 1, country: 'Brazil', city: 'Sao Paulo ', map_x: '300.5', map_y: 100, n: 4 },
  { geonameid: 2, country: 'England', city: 'London', map_x: 480, map_y: -150, n: '9' },
  { geonameid: 3, country: 'Spain', city: 'Nowhere', map_x: null, map_y: 5, n: 2 },
])
assert.deepEqual(w.dots.map(d => d.label), ['London, England', 'Sao Paulo, Brazil'], 'largest first; trimmed; unplaceable dropped')
assert.equal(w.placed, 13)
assert.equal(w.max, 9)
assert.equal(w.places, 2)
assert.equal(w.dots[1].key, 'w|1')
assert.equal(w.dots[0].y, -150, 'negative map positions kept (the world map starts above zero)')
assert.equal(unplacedCount({ Brazil: 5, England: 10 }, 13), 2, 'world: country totals minus placed')
assert.deepEqual(worldCityDots(undefined), { dots: [], placed: 0, max: 0, places: 0 })

console.log('landscapeCities.test.mjs: all assertions passed')
