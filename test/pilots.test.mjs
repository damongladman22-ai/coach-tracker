// Pilot access to Ask PitchSide (server/ask/pilots.js), with a fake database.
import assert from 'node:assert/strict'
import { newPilotCode, normCode, hashCode, codeHint, findPilot, limitMessage, pilotAdmin, PILOT_BUDGET_USD, BURST_PER_MINUTE, DEFAULT_DAILY_LIMIT } from '../server/ask/pilots.js'

// codes: 12 characters, no look-alike letters; typed with or without dashes or case, same hash
const codes = Array.from({ length: 200 }, newPilotCode)
assert.ok(codes.every(c => /^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/.test(c)), 'format, no 0 O 1 I L')
assert.equal(new Set(codes).size, codes.length, 'no repeats')
assert.equal(hashCode('abcd-efgh-jkmn'), hashCode('ABCDEFGHJKMN'))
assert.equal(normCode(' ab-cd '), 'ABCD')
assert.equal(codeHint('ABCD-EFGH-JKMN'), 'JKMN')
assert.equal(hashCode('X').length, 64)

// a tiny stand-in for the supabase-js builder over one table
function fakeDb(rows) {
  const db = {
    rows,
    from() {
      let r = db.rows.slice(), op = null, patch = null
      const q = {
        select() { return q },
        eq(c, v) { r = r.filter(x => x[c] === v); return q },
        insert(row) { op = 'insert'; patch = { id: '00000000-0000-0000-0000-00000000000' + (db.rows.length + 1), active: true, ...row }; return q },
        update(p) { op = 'update'; patch = p; return q },
        maybeSingle() { return Promise.resolve({ data: r[0] || null, error: null }) },
        single() {
          if (op === 'insert') { db.rows.push(patch); return Promise.resolve({ data: patch, error: null }) }
          return Promise.resolve({ data: r[0] || null, error: null })
        },
        then(res, rej) {
          if (op === 'update') r.forEach(x => Object.assign(x, patch))
          return Promise.resolve({ data: r, error: null }).then(res, rej)
        },
      }
      return q
    },
  }
  return db
}

// owner creates a pilot: the code is returned once, only its hash is stored
{
  const db = fakeDb([])
  let r = await pilotAdmin(db, { action: 'create', name: '  Jane Smith ', daily_limit: 10 }, 'owner@x.com')
  assert.equal(r.status, 200)
  const code = r.body.code
  assert.equal(db.rows[0].name, 'Jane Smith')
  assert.equal(db.rows[0].code_hash, hashCode(code))
  assert.ok(!JSON.stringify(db.rows).includes(normCode(code)), 'the code itself is never stored')
  assert.equal(db.rows[0].daily_limit, 10)

  // the link works; a wrong code does not; a switched-off pilot does not
  assert.equal((await findPilot(db, code.toLowerCase())).name, 'Jane Smith')
  assert.equal(await findPilot(db, 'AAAA-BBBB-CCCC'), null)
  assert.equal(await findPilot(db, 'short'), null)
  const id = db.rows[0].id
  r = await pilotAdmin(db, { action: 'update', id, active: false }, 'owner@x.com')
  assert.equal(r.status, 200)
  assert.equal(await findPilot(db, code), null, 'switched off')
  await pilotAdmin(db, { action: 'update', id, active: true }, 'owner@x.com')

  // a new link replaces the old one
  r = await pilotAdmin(db, { action: 'new_link', id }, 'owner@x.com')
  assert.equal(await findPilot(db, code), null, 'old link stops working')
  assert.equal((await findPilot(db, r.body.code)).name, 'Jane Smith')

  // bad input
  assert.equal((await pilotAdmin(db, { action: 'create', name: ' ' }, 'o')).status, 400)
  assert.equal((await pilotAdmin(db, { action: 'create', name: 'A', daily_limit: 0 }, 'o')).status, 400)
  assert.equal((await pilotAdmin(db, { action: 'update', id: 'nope', active: false }, 'o')).status, 400)
}

// limits: plain words, the budget first, then the day, then the minute
const p = { daily_limit: 150 }
assert.equal(DEFAULT_DAILY_LIMIT, 150)
assert.equal(limitMessage({ day: 149, minute: 0, spend: 10 }, p), null)
assert.ok(/150 questions in 24 hours/.test(limitMessage({ day: 150, minute: 0, spend: 10 }, p)))
assert.ok(/wait a moment/.test(limitMessage({ day: 3, minute: BURST_PER_MINUTE, spend: 10 }, p)))
assert.ok(/paused while we review the pilot/.test(limitMessage({ day: 0, minute: 0, spend: PILOT_BUDGET_USD }, p)))
console.log('pilots.test.mjs: all assertions passed')
