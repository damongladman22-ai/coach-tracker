import assert from 'node:assert/strict'
import { classOptions, quizQuestions, quizMessage, cleanScore } from '../src/ask/quiz.js'

assert.deepEqual(classOptions(new Date('2026-10-14')).map(o => o.value), ['2027', '2028', '2029', '2030'], 'autumn: seniors are the next class')
assert.deepEqual(classOptions(new Date('2027-03-01')).map(o => o.value), ['2027', '2028', '2029', '2030'], 'spring: seniors still in school')
assert.deepEqual(classOptions(new Date('2027-06-15')).map(o => o.value), ['2028', '2029', '2030', '2031'], 'June: the seniors have graduated')
assert.equal(quizQuestions().length, 13)

assert.equal(cleanScore('SAT', '1080'), 1080)
assert.equal(cleanScore('SAT', '2400'), null, 'old 2400 scale refused')
assert.equal(cleanScore('ACT', '21'), 21)
assert.equal(cleanScore('ACT', '40'), null)
assert.equal(cleanScore('none', '21'), null)

const chad = quizMessage({ gender: 'M', position: 'GK', hs_class: '2028', home: ' Columbus, OH ', distance: '240', state: 'out',
  level: 'D1', playing_time: 'balance', size: 'large', type: 'public', cost: 'any', test: 'ACT', score: '21', major: 'undecided' })
assert.ok(chad.startsWith('Quick quiz answers: '), 'the assistant recognises the quiz')
for (const bit of ["men's soccer", 'goalkeeper', 'class of 2028', 'Home: Columbus, OH.', 'about 4 hours', '(240 miles)',
  'Out of state only', 'NCAA D1 only', 'large (over 15,000', 'Public colleges', 'ACT 21', 'Major: undecided']) {
  assert.ok(chad.includes(bit), `has "${bit}"`)
}
assert.ok(!/Cost:/.test(chad), 'no cost line when cost is not a deciding factor')

const w = quizMessage({ gender: 'W', position: 'M', hs_class: '2029', home: '43017', distance: 'any', state: 'either',
  level: 'D2D3', playing_time: 'early', size: 'any', type: 'either', cost: '25000', test: 'none', major: 'nursing' })
assert.ok(w.includes("women's soccer") && w.includes('Distance: anywhere.') && w.includes('Cost: under $25,000'))
assert.ok(w.includes('No SAT or ACT score yet.') && w.includes('Intended major: nursing.') && w.includes('playing early'))
assert.ok(!/Out of state|Home state only|School size|Public|Private/.test(w))

console.log('quiz.test.mjs: all assertions passed')
