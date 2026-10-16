import assert from 'node:assert/strict'
import { normalizeAward, deadlineStatus, awardsByUnit, collegeAwards, shortLine, cardValue, upcomingDeadlines, daysUntil, hasAward } from '../src/lib/actionAwards.js'

const rows = [
  { unitid: 1, award_type: 'referral', name: 'Refer', amount: '500', per_year: false, amount_text: '$500 book credit', deadline: '2026-11-01', deadline_text: 'Referral form by Nov 1, 2026', checked: '2026-10-15' },
  { unitid: 1, award_type: 'visit', name: 'Visit Award', amount: '2000', per_year: true, amount_total: '8000', amount_text: '$2,000 a year ($8,000 over four years)', deadline: '2026-12-15', deadline_text: 'Visit by Dec 15, 2026', url: 'https://x.edu', checked: '2026-10-15', confidence: 'high' },
  { unitid: 2, award_type: 'none_found', checked: '2026-10-15', url: 'https://y.edu' },
  { unitid: 3, award_type: 'visit', name: 'Visit Grant', amount: 1000, per_year: true, amount_text: '$1,000 a year', deadline: null, deadline_text: 'No deadline stated', checked: '2026-10-15' },
  { unitid: 4, award_type: 'visit', name: 'Old', amount: 1000, per_year: false, amount_text: '$1,000 one time', deadline: '2026-10-01', deadline_text: 'Visit by Oct 1, 2026', checked: '2026-10-15' },
]
const today = '2026-10-15'

const n = normalizeAward(rows[1])
assert.equal(n.amount, 2000)
assert.equal(n.amount_total, 8000)
assert.equal(n.type, 'visit')
assert.equal(daysUntil('2026-11-01', today), 17)

assert.equal(deadlineStatus(normalizeAward(rows[0]), today), 'soon', '17 days away')
assert.equal(deadlineStatus(n, today), 'open')
assert.equal(deadlineStatus(normalizeAward(rows[3]), today), 'none')
assert.equal(deadlineStatus(normalizeAward(rows[4]), today), 'passed')

const by = awardsByUnit(rows)
assert.deepEqual(by.get(1).map(a => a.type), ['visit', 'referral'], 'visit awards first')

const c1 = collegeAwards(by.get(1), today)
assert.equal(c1.checked, true)
assert.equal(c1.nothing_published, false)
assert.equal(c1.checked_on, '2026-10-15')
assert.equal(c1.awards[0].label, 'Campus visit award')
assert.equal(collegeAwards(by.get(1), today, ['visit']).awards.length, 1)
assert.deepEqual(collegeAwards(by.get(2), today), { checked: true, checked_on: '2026-10-15', nothing_published: true, awards: [] })
assert.deepEqual(collegeAwards(undefined, today), { checked: false })

assert.equal(shortLine(by.get(1)[0], today), 'Campus visit award: $2,000 a year ($8,000 over four years); visit by Dec 15, 2026')
assert.equal(shortLine(by.get(3)[0], today), 'Campus visit award: $1,000 a year', 'no deadline words when none is stated')
assert.equal(shortLine(by.get(4)[0], today), 'Campus visit award: $1,000 one time; visit by Oct 1, 2026 (passed)')

assert.equal(hasAward(by.get(1)), true)
assert.equal(hasAward(by.get(1), ['visit']), true)
assert.equal(hasAward(by.get(1), ['fafsa']), false, 'only the kinds asked')
assert.equal(hasAward(by.get(2)), false, 'checked, nothing published')
assert.equal(hasAward(by.get(4), ['visit']), true, 'a passed deadline still counts: the award recurs')
assert.equal(hasAward(undefined), false, 'not checked')

assert.equal(cardValue(by.get(1)[0]), '$2,000/yr')
assert.equal(cardValue(by.get(4)[0]), '$1,000')
assert.equal(cardValue(null), '—')

const up = upcomingDeadlines([
  { school: 'A', awards: collegeAwards(by.get(1), today).awards },
  { school: 'D', awards: collegeAwards(by.get(4), today).awards },
], today)
assert.deepEqual(up.map(u => [u.school, u.deadline, u.days_left]), [['A', '2026-11-01', 17], ['A', '2026-12-15', 61]], 'passed and undated deadlines left out')

console.log('actionAwards.test.mjs: all assertions passed')
