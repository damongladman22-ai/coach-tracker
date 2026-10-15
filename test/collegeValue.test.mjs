import assert from 'node:assert/strict'
import { valueLine, orderPrograms, ORDERS } from '../src/lib/collegeValue.js'

assert.equal(valueLine({ median_earnings_10yr: 75537, median_debt: 23250, median_debt_monthly: '245.84' }),
  'Median earnings $75,537 (10 years after starting) · median debt at graduation $23,250, about $246 a month')
assert.equal(valueLine({ median_earnings_10yr: null, median_debt: '19000' }), 'Median debt at graduation $19,000')
assert.equal(valueLine({ median_earnings_10yr: 50000 }), 'Median earnings $50,000 (10 years after starting)')
assert.equal(valueLine({}), null)
assert.equal(valueLine(null), null)

const list = [{ school_id: 'a' }, { school_id: 'b' }, { school_id: 'c' }, { school_id: 'd' }]
const F = { a: { median_earnings_10yr: 40000, median_debt: 30000 }, b: { median_earnings_10yr: 70000, median_debt: null },
  c: null, d: { median_earnings_10yr: 70000, median_debt: 20000 } }
const of = id => F[id]
assert.deepEqual(orderPrograms(list, 'openings', of).map(r => r.school_id), ['a', 'b', 'c', 'd'], 'openings keeps the ranking')
assert.deepEqual(orderPrograms(list, 'earnings', of).map(r => r.school_id), ['b', 'd', 'a', 'c'], 'highest first; ties keep openings order; missing last')
assert.deepEqual(orderPrograms(list, 'debt', of).map(r => r.school_id), ['d', 'a', 'b', 'c'], 'lowest first; missing last in openings order')
assert.equal(ORDERS[0].key, 'openings')

console.log('collegeValue.test.mjs: all assertions passed')
