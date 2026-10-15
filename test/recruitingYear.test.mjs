// "What should we be doing now?" (src/lib/recruitingYear.js), offline.
import assert from 'node:assert/strict'
import { gradeNow, keyDates, recruitingYear } from '../src/lib/recruitingYear.js'

const oct2026 = new Date(2026, 9, 15)
assert.equal(gradeNow(2028, oct2026).label, 'junior year', 'class of 2028 in October 2026')
assert.equal(gradeNow(2027, oct2026).label, 'senior year')
assert.equal(gradeNow(2030, oct2026).label, 'freshman year')
assert.equal(gradeNow(2031, oct2026).label, 'middle school')
assert.equal(gradeNow(2026, oct2026).label, 'graduated')
assert.equal(gradeNow(2028, new Date(2026, 3, 1)).label, 'sophomore year', 'April: still the school year that began in August')
assert.equal(gradeNow(2028, new Date(2026, 5, 20)).label, 'the summer before junior year')

const d = keyDates(2028)
assert.equal(d[0].date, '2026-06-15')
assert.equal(d[1].date, '2026-08-01')
assert.equal(d[2].date, '2028-04-01')

const r = recruitingYear(2028, 'W', oct2026)
assert.equal(r.now, 'junior year (class of 2028)')
assert.ok(r.this_year.some(s => /Narrow your list/.test(s)))
assert.ok(r.next_up.length > 0)
assert.equal(r.key_dates[0].passed, true, 'June 15, 2026 has passed by October 2026')
assert.equal(r.key_dates[2].passed, false)
assert.match(r.commitment_timing, /Women/)
assert.match(r.source, /compliance office/)
assert.equal(recruitingYear(2031, 'W', oct2026).commitment_timing, undefined, 'too early to talk commitments')
assert.deepEqual(recruitingYear(2026, 'W', oct2026).this_year, [], 'graduated')

console.log('recruitingYear.test.mjs: all assertions passed')
