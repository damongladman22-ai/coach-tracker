import assert from 'node:assert/strict'
import { cityDots, dotRadius, unplacedCount } from '../src/csip-landscape/data/landscapeCities.js'

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

console.log('landscapeCities.test.mjs: all assertions passed')
