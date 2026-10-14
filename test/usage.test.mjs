// Pilot usage summary (server/ask/usage.js).
import assert from 'node:assert/strict'
import { summarizeUsage, topicOf } from '../server/ask/usage.js'

assert.equal(topicOf([{ tool: 'find_programs', input: { position: 'GK', hs_class: 2027 } }]), 'Openings')
assert.equal(topicOf([{ tool: 'find_programs', input: { near: '43017' } }]), 'Distance')
assert.equal(topicOf([{ tool: 'find_programs', input: { major: 'nursing' } }]), 'Academic fit')
assert.equal(topicOf([{ tool: 'programs_watching_team', input: {} }]), 'Your team')
assert.equal(topicOf([{ tool: 'program_coaches', input: { school: 'Kenyon' } }]), 'Coaches')
assert.equal(topicOf([]), 'No look-up')

const now = Date.parse('2026-10-20T12:00:00Z')
const R = (o) => ({ status: 'answered', ms: 4000, cost_usd: 0.001, lookups: [], ...o })
const rows = [
  R({ created_at: '2026-10-20T10:00:00Z', pilot_id: 'a', conversation_id: 'c1', source: 'typed', rating: 1, lookups: [{ tool: 'program_coaches', input: {} }] }),
  R({ created_at: '2026-10-20T10:01:00Z', pilot_id: 'a', conversation_id: 'c1', source: 'followup', ms: 6000 }),
  R({ created_at: '2026-10-18T09:00:00Z', pilot_id: 'a', conversation_id: 'c2', source: 'suggestion', status: 'unavailable', rating: -1 }),
  R({ created_at: '2026-10-19T09:00:00Z', pilot_id: 'b', conversation_id: 'c3', source: 'typed', cost_usd: 0.002 }),
  R({ created_at: '2026-09-01T09:00:00Z', pilot_id: 'b', conversation_id: 'c4', source: 'typed' }),
]
const s = summarizeUsage(rows, [{ id: 'a', name: 'Ann' }, { id: 'b', name: 'Bo' }], { now, days: 7, budget: 50 })
assert.equal(s.questions, 5)
assert.ok(Math.abs(s.spend_usd - 0.006) < 1e-9)
assert.equal(s.budget_usd, 50)
assert.equal(s.conversations, 4)
assert.equal(s.questions_per_conversation, 5 / 4)
assert.equal(s.conversations_with_followups, 1)
assert.equal(s.active_pilots_7d, 2)
assert.equal(s.returning_pilots, 2, 'Ann on 2 days, Bo on 2 days')
assert.equal(s.by_day.length, 7)
assert.deepEqual(s.by_day.at(-1), { day: '2026-10-20', questions: 2, pilots: 1, cost_usd: 0.002 })
assert.equal(s.by_day.find(d => d.day === '2026-09-01'), undefined, 'outside the window')
assert.equal(s.thumbs_up, 1)
assert.equal(s.thumbs_down, 1)
assert.equal(s.median_ms, 4000)
assert.deepEqual(s.status[0], { label: 'answered', n: 4 })
assert.deepEqual(s.sources[0], { label: 'typed', n: 3 })
assert.equal(s.topics.find(t => t.label === 'Coaches').n, 1)
const ann = s.per_pilot.find(p => p.name === 'Ann')
assert.deepEqual([ann.questions, ann.conversations, ann.active_days, ann.thumbs_up, ann.thumbs_down, ann.not_answered], [3, 2, 2, 1, 1, 1])
console.log('usage.test.mjs: all assertions passed')
