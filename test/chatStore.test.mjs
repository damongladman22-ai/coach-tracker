// Saved Ask PitchSide conversations (src/ask/chatStore.js), with an in-memory storage.
import assert from 'node:assert/strict'
import { loadChats, saveChats, putChat, dropChat, titleOf, whenLabel, KEY, MAX_CHATS } from '../src/ask/chatStore.js'

const mem = (init = {}, limit = Infinity) => {
  const m = new Map(Object.entries(init))
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > limit) throw new Error('QuotaExceeded'); m.set(k, String(v)) },
    removeItem: k => { m.delete(k) },
    has: k => m.has(k),
  }
}
const U = (c, id) => ({ id: id || c, role: 'user', content: c })
const A = (c, id) => ({ id: id || c, role: 'assistant', content: c, status: 'done' })

// the single pre-14-Oct chat becomes the first saved chat, with its program
{
  const s = mem({ 'ask-pitchside-thread-v1': JSON.stringify([U('Who coaches Iowa?'), A('Dean Ward.')]),
    'ask-pitchside-program-v1': JSON.stringify({ id: 'x', school: 'University of Iowa', gender: 'W' }) })
  const chats = loadChats(s)
  assert.equal(chats.length, 1)
  assert.equal(chats[0].title, 'Who coaches Iowa?')
  assert.equal(chats[0].program.school, 'University of Iowa')
  assert.ok(s.has(KEY) && !s.has('ask-pitchside-thread-v1'), 'migrated once, old keys removed')
  assert.equal(loadChats(s).length, 1)
}

// put: newest first, empty chats not saved, streaming replies left out, at most 30
{
  let c = putChat([], { id: 'a', msgs: [U('First question')] })
  c = putChat(c, { id: 'b', msgs: [U('Second'), { id: 'z', role: 'assistant', content: '', status: 'streaming' }] })
  assert.deepEqual(c.map(x => x.id), ['b', 'a'])
  assert.equal(c[0].msgs.length, 1, 'streaming reply not saved')
  c = putChat(c, { id: 'a', msgs: [U('First question'), A('ok')] })
  assert.deepEqual(c.map(x => x.id), ['a', 'b'], 'reopened chat moves to the top')
  assert.equal(putChat(c, { id: 'n', msgs: [] }).length, 2, 'empty chat not saved')
  for (let i = 0; i < 40; i++) c = putChat(c, { id: 'k' + i, msgs: [U('q' + i)] })
  assert.equal(c.length, MAX_CHATS)
  assert.deepEqual(dropChat(c, 'k39').length, MAX_CHATS - 1)
}

// storage full: oldest chats dropped until it fits; a broken value never throws
{
  const s = mem({}, 400)
  const chats = Array.from({ length: 5 }, (_, i) => ({ id: 'c' + i, title: 't', updatedAt: 1, msgs: [U('x'.repeat(60))] }))
  const kept = saveChats(s, chats)
  assert.ok(kept.length >= 1 && kept.length < 5 && kept[0].id === 'c0', 'newest kept')
  assert.deepEqual(loadChats(mem({ [KEY]: '{not json' })), [])
}

assert.equal(titleOf([U('  a   b ')]), 'a b')
assert.ok(titleOf([U('x'.repeat(100))]).endsWith('…'))
const now = new Date(2026, 9, 14, 12).getTime()
assert.equal(whenLabel(now - 3600e3, now), 'Today')
assert.equal(whenLabel(now - 86400e3, now), 'Yesterday')
assert.equal(whenLabel(new Date(2026, 9, 9).getTime(), now), 'Oct 9')
assert.equal(whenLabel(new Date(2025, 9, 9).getTime(), now), 'Oct 9, 2025')
console.log('chatStore.test.mjs: all assertions passed')
