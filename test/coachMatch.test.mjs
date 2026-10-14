import assert from 'node:assert/strict'
import {
  normNamePart, coachNameKey, indexCoachesByName, classifyNewCoach, fillMissingFields,
} from '../src/lib/coachMatch.js'

let n = 0
const t = (name, fn) => { fn(); n++ }

t('names normalise: trim, collapse spaces, ignore case', () => {
  assert.equal(normNamePart('  Krissy   Ann '), 'krissy ann')
  assert.equal(normNamePart(null), '')
  assert.equal(coachNameKey('s1', ' Tim ', 'BARRERA'), coachNameKey('s1', 'tim', 'Barrera'))
})

t('different programs never match', () => {
  assert.notEqual(coachNameKey('s1', 'Tim', 'Barrera'), coachNameKey('s2', 'Tim', 'Barrera'))
})

t('near-miss spellings do not match (strict)', () => {
  assert.notEqual(coachNameKey('s1', 'Hayley', 'Dowd'), coachNameKey('s1', 'Haley', 'Dowd'))
  assert.notEqual(coachNameKey('s1', 'Juan', 'Mascaro'), coachNameKey('s1', 'Juan', 'Mascaro Jr.'))
})

t('index groups every record by key', () => {
  const idx = indexCoachesByName([
    { id: 'a', school_id: 's1', first_name: 'Tim', last_name: 'Barrera', is_active: false },
    { id: 'b', school_id: 's1', first_name: 'tim ', last_name: 'barrera', is_active: true },
    { id: 'c', school_id: 's2', first_name: 'Tim', last_name: 'Barrera', is_active: false },
  ])
  assert.equal(idx.get(coachNameKey('s1', 'Tim', 'Barrera')).length, 2)
  assert.equal(idx.get(coachNameKey('s2', 'Tim', 'Barrera')).length, 1)
})

t('classify: nobody -> new', () => {
  assert.equal(classifyNewCoach([]).status, 'new')
  assert.equal(classifyNewCoach(undefined).status, 'new')
})

t('classify: one inactive -> reactivate that record', () => {
  const r = classifyNewCoach([{ id: 'a', is_active: false }])
  assert.equal(r.status, 'inactive')
  assert.equal(r.coach.id, 'a')
})

t('classify: any active -> already listed (null counts as active)', () => {
  assert.equal(classifyNewCoach([{ id: 'a', is_active: false }, { id: 'b', is_active: true }]).status, 'active')
  assert.equal(classifyNewCoach([{ id: 'a', is_active: null }]).status, 'active')
})

t('classify: two inactive -> ambiguous, refuse', () => {
  const r = classifyNewCoach([{ id: 'a', is_active: false }, { id: 'b', is_active: false }])
  assert.equal(r.status, 'ambiguous')
  assert.equal(r.count, 2)
})

t('fill only missing fields', () => {
  assert.deepEqual(
    fillMissingFields({ title: 'Head Coach', email: '', phone: null }, { title: 'Assistant', email: ' a@b.edu ', phone: '555' }),
    { email: 'a@b.edu', phone: '555' },
  )
  assert.deepEqual(fillMissingFields({ title: 'X' }, {}), {})
})

console.log(`coachMatch: ${n} tests passed`)
