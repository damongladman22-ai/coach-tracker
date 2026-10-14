import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import OwnerLayout from '../components/OwnerLayout'
import { ASK_TEST_QUESTIONS } from '../lib/askTestQuestions'

/**
 * Ask PitchSide (backlog F2 prototype, owner only, 2026-10-13).
 *
 * Two parts:
 *  - Ask: one question, one model. Shows the answer, every look-up the model
 *    ran with the rows it got back, tokens, time and estimated cost.
 *  - Bake-off: the 20 questions in lib/askTestQuestions.js on several models,
 *    one after another, with an automatic check that the expected look-ups
 *    were used. The answers are judged by eye.
 *
 * All model calls go through /api/ask (Vercel AI Gateway); this page never
 * holds a key. Cost = the gateway's list price for the model x tokens used.
 */

async function authHeaders() {
  const { data } = await supabase.auth.getSession()
  const token = data?.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function askApi(question, model) {
  const r = await fetch('/api/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ question, model }),
  })
  const j = await r.json().catch(() => ({ error: `HTTP ${r.status}` }))
  if (!r.ok && !j.error) j.error = `HTTP ${r.status}`
  return j
}

function costOf(res, price) {
  if (res?.gateway_cost != null) return Number(res.gateway_cost)
  if (!price || !res?.usage) return null
  const i = res.usage.input_tokens || 0
  const o = res.usage.output_tokens || 0
  return (i * price.input_per_m + o * price.output_per_m) / 1e6
}

const money = x => (x == null ? '—' : x < 0.01 ? `${(x * 100).toFixed(2)}¢` : `$${x.toFixed(3)}`)
const secs = ms => (ms == null ? '—' : `${(ms / 1000).toFixed(1)}s`)

function checkLookups(test, res) {
  const used = new Set((res?.lookups || []).map(l => l.tool))
  // Program look-ups can take the college name directly (2026-10-13), which
  // replaces the find_school step.
  if ((res?.lookups || []).some(l => l.input?.school)) used.add('find_school')
  if (res?.error) return { ok: false, text: 'error' }
  if (test.none) return used.size === 0 ? { ok: true, text: 'no look-ups (expected)' } : { ok: null, text: `used ${[...used].join(', ')}` }
  const missing = test.expect.filter(t => !used.has(t))
  return missing.length ? { ok: false, text: `missing ${missing.join(', ')}` } : { ok: true, text: [...used].join(', ') }
}

function Lookups({ lookups }) {
  if (!lookups?.length) return <div className="text-sm text-gray-500">No look-ups were run.</div>
  return (
    <div className="space-y-2">
      {lookups.map((l, i) => (
        <details key={i} className="border rounded bg-gray-50">
          <summary className="cursor-pointer px-3 py-2 text-sm">
            <span className="font-mono font-semibold">{l.tool}</span>
            <span className="text-gray-500"> {JSON.stringify(l.input)} · {l.ms} ms</span>
          </summary>
          <pre className="text-xs px-3 pb-3 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(l.output, null, 2)}</pre>
        </details>
      ))}
    </div>
  )
}

// ── Pilot usage: trends and real-world use (server/ask/usage.js) ───────────
const usd = x => (x == null ? '—' : x < 0.01 ? `$${x.toFixed(4)}` : `$${x.toFixed(2)}`)
const SOURCE_LABEL = { typed: 'Typed', suggestion: 'Suggested question', followup: 'Follow-up chip', 'not recorded': 'Not recorded (before 14 Oct)' }

function Tile({ label, value, sub }) {
  return (
    <div className="border rounded-lg px-3 py-2">
      <div className="text-xs text-gray-500">{label}</div>
      <div className="text-xl font-semibold text-gray-900 tabular-nums">{value}</div>
      {sub && <div className="text-xs text-gray-500">{sub}</div>}
    </div>
  )
}

function DailyBars({ days }) {
  const [hover, setHover] = useState(null)
  const max = Math.max(1, ...days.map(d => d.questions))
  const h = d => `${Math.round((d.questions / max) * 100)}%`
  const label = d => new Date(d.day + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
  const shown = hover != null ? days[hover] : null
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs text-gray-500 mb-1">
        <span>Questions per day, last 30 days</span>
        <span className="tabular-nums">{shown ? `${label(shown)}: ${shown.questions} questions · ${shown.pilots} pilots · ${usd(shown.cost_usd)}` : `most in a day: ${max}`}</span>
      </div>
      <div className="flex items-end gap-[2px] h-28 border-b border-gray-200" onMouseLeave={() => setHover(null)} role="img"
        aria-label="Questions per day for the last 30 days">
        {days.map((d, i) => (
          <div key={d.day} className="flex-1 h-full flex items-end cursor-default" onMouseEnter={() => setHover(i)}
            title={`${label(d)}: ${d.questions} questions, ${d.pilots} pilots, ${usd(d.cost_usd)}`}>
            <div className={`w-full rounded-t ${hover === i ? 'bg-[#1d4ed8]' : 'bg-[#3b6fd8]'}`} style={{ height: d.questions ? h(d) : 0, minHeight: d.questions ? 2 : 0 }} />
          </div>
        ))}
      </div>
      <div className="flex justify-between text-[11px] text-gray-400 mt-1"><span>{days[0] && label(days[0])}</span><span>{days.at(-1) && label(days.at(-1))}</span></div>
    </div>
  )
}

function CountList({ title, items, total, labels = {} }) {
  return (
    <div>
      <div className="text-xs text-gray-500 mb-1">{title}</div>
      {items.length === 0 ? <div className="text-sm text-gray-400">None yet</div> : (
        <ul className="space-y-1">
          {items.map(it => (
            <li key={it.label} className="text-sm">
              <div className="flex justify-between gap-2"><span className="text-gray-800">{labels[it.label] || it.label}</span>
                <span className="tabular-nums text-gray-600">{it.n} · {Math.round((it.n / Math.max(1, total)) * 100)}%</span></div>
              <div className="h-1.5 bg-gray-100 rounded"><div className="h-1.5 bg-[#3b6fd8] rounded" style={{ width: `${(it.n / Math.max(1, total)) * 100}%` }} /></div>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function PilotUsage() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [mine, setMine] = useState(false)
  async function load(all = mine) {
    setErr(null)
    try {
      const r = await fetch(`/api/ask?usage=${all ? 'all' : 'pilots'}`, { headers: await authHeaders() })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e) { setErr(e.message || String(e)) }
  }
  useEffect(() => { load(mine) }, [mine])   // eslint-disable-line react-hooks/exhaustive-deps

  const d = data
  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold text-gray-800">Pilot usage</h2>
        <div className="flex items-center gap-3 text-sm">
          <label className="flex items-center gap-1.5 text-gray-600">
            <input type="checkbox" checked={mine} onChange={e => setMine(e.target.checked)} /> Include my own questions
          </label>
          <button onClick={() => load()} className="text-blue-600 hover:underline">Refresh</button>
        </div>
      </div>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {d && (
        <>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="Pilot spend" value={usd(d.spend_usd)} sub={d.budget_usd ? `of $${d.budget_usd} budget · ${usd(d.avg_cost_usd)} a question` : null} />
            <Tile label="Questions" value={d.questions.toLocaleString()} sub={`${d.conversations} conversations · ${d.questions_per_conversation ? d.questions_per_conversation.toFixed(1) : '—'} per conversation`} />
            <Tile label="Pilots" value={`${d.active_pilots_7d} active`} sub={`in the last 7 days · ${d.returning_pilots} of ${d.pilots_with_questions} came back on another day`} />
            <Tile label="Answer speed" value={d.median_ms ? `${(d.median_ms / 1000).toFixed(1)} s` : '—'} sub={d.p90_ms ? `typical · 1 in 10 slower than ${(d.p90_ms / 1000).toFixed(1)} s` : null} />
          </div>
          <DailyBars days={d.by_day} />
          <div className="grid sm:grid-cols-3 gap-4">
            <CountList title="What they ask about" items={d.topics} total={d.questions} />
            <CountList title="How the answer went" items={d.status} total={d.questions} />
            <CountList title="How the question started" items={d.sources} total={d.questions} labels={SOURCE_LABEL} />
          </div>
          <div className="text-sm text-gray-600">Thumbs up {d.thumbs_up} · thumbs down {d.thumbs_down} · conversations with a follow-up question {d.conversations_with_followups} of {d.conversations}</div>
          {d.per_pilot.length > 0 && (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="py-1.5 pr-2">Pilot</th><th className="pr-2">Questions</th><th className="pr-2">Conversations</th><th className="pr-2">Days used</th>
                <th className="pr-2">Not fully answered</th><th className="pr-2">👍 / 👎</th><th className="pr-2">Spend</th><th>Last used</th>
              </tr></thead>
              <tbody>
                {d.per_pilot.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{p.name}</td><td className="pr-2 tabular-nums">{p.questions}</td><td className="pr-2 tabular-nums">{p.conversations}</td>
                    <td className="pr-2 tabular-nums">{p.active_days}</td><td className="pr-2 tabular-nums">{p.not_answered}</td>
                    <td className="pr-2 tabular-nums">{p.thumbs_up} / {p.thumbs_down}</td><td className="pr-2 tabular-nums">{usd(p.cost_usd)}</td>
                    <td className="text-gray-500">{p.last_used ? new Date(p.last_used).toLocaleString() : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-xs text-gray-400">Chat questions only (not this test bench). Spend, conversations and how a question started are recorded from 14 October; earlier questions show as not recorded.</p>
        </>
      )}
    </div>
  )
}

// ── Pilot access (personal pilot links, no login; Damon 2026-10-14) ─────────
function pilotLink(code) {
  return `${window.location.origin}/ask?pilot=${encodeURIComponent(code)}`
}

function NewLink({ code, name, onDone }) {
  const link = pilotLink(code)
  const [copied, setCopied] = useState(false)
  return (
    <div className="border border-emerald-200 bg-emerald-50 rounded-lg p-3 text-sm space-y-2">
      <div className="text-emerald-900 font-medium">Link for {name}. Copy it now: it is shown only once.</div>
      <div className="flex flex-wrap items-center gap-2">
        <code className="bg-white border rounded px-2 py-1 text-xs break-all">{link}</code>
        <button type="button" className="px-2 py-1 rounded border bg-white text-sm"
          onClick={() => { navigator.clipboard?.writeText(link).then(() => setCopied(true), () => {}) }}>
          {copied ? 'Copied' : 'Copy link'}
        </button>
        <button type="button" className="text-sm text-gray-600 hover:underline" onClick={onDone}>Done</button>
      </div>
      <div className="text-xs text-emerald-900">
        The pilot opens it once on their phone or computer (after the club passcode, if asked); the Ask tab then stays on in that browser.
        Anyone with the link can use this pilot&apos;s allowance, so send it only to them.
      </div>
    </div>
  )
}

function PilotAccess() {
  const [data, setData] = useState(null)
  const [err, setErr] = useState(null)
  const [name, setName] = useState('')
  const [limit, setLimit] = useState(150)
  const [shown, setShown] = useState(null)   // { code, name }
  const [busy, setBusy] = useState(false)

  async function load() {
    setErr(null)
    try {
      const r = await fetch('/api/ask?pilots=1', { headers: await authHeaders() })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setData(j)
    } catch (e) { setErr(e.message || String(e)) }
  }
  useEffect(() => { load() }, [])

  async function act(payload) {
    setBusy(true); setErr(null)
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ pilot_admin: payload }) })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      await load()
      return j
    } catch (e) { setErr(e.message || String(e)); return null } finally { setBusy(false) }
  }

  async function create(e) {
    e.preventDefault()
    const j = await act({ action: 'create', name, daily_limit: Number(limit) })
    if (j?.code) { setShown({ code: j.code, name: j.pilot.name }); setName('') }
  }

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Pilot access</h2>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Refresh</button>
      </div>
      <p className="text-sm text-gray-600">
        Each pilot gets a private link: no login, their own daily question limit, every question tagged with their name.
        Switch a pilot off, or give them a new link (the old one stops working), at any time.
      </p>
      {err && <div className="text-sm text-red-600">{err}</div>}
      {shown && <NewLink code={shown.code} name={shown.name} onDone={() => setShown(null)} />}
      <form onSubmit={create} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <div className="text-xs text-gray-500">Pilot name</div>
          <input value={name} onChange={e => setName(e.target.value)} maxLength={60} placeholder="e.g. Jane Smith (U15 parent)"
            className="border rounded px-2 py-1.5 text-sm w-64" />
        </label>
        <label className="text-sm">
          <div className="text-xs text-gray-500">Questions per 24 hours</div>
          <input type="number" min={1} max={500} value={limit} onChange={e => setLimit(e.target.value)} className="border rounded px-2 py-1.5 text-sm w-24" />
        </label>
        <button type="submit" disabled={busy || !name.trim()} className="px-3 py-1.5 rounded bg-[#0a1628] text-white text-sm disabled:opacity-50">Create pilot link</button>
      </form>
      {data && (
        <>
          <div className="text-sm text-gray-600">
            Pilot spend so far: ${Number(data.spend_usd || 0).toFixed(2)} of ${data.budget_usd} budget
            {data.spend_usd >= data.budget_usd ? ' (pilots paused: budget reached)' : ''}.
          </div>
          {data.pilots.length === 0 ? <div className="text-sm text-gray-500">No pilots yet.</div> : (
            <table className="w-full text-sm">
              <thead><tr className="text-left text-gray-500 border-b">
                <th className="py-1.5 pr-2">Pilot</th><th className="pr-2">Link ends</th><th className="pr-2">Last 24 h</th>
                <th className="pr-2">Total</th><th className="pr-2">Last used</th><th className="pr-2">Status</th><th />
              </tr></thead>
              <tbody>
                {data.pilots.map(p => (
                  <tr key={p.id} className="border-b last:border-0">
                    <td className="py-1.5 pr-2">{p.name}</td>
                    <td className="pr-2 font-mono text-xs">…{p.code_hint}</td>
                    <td className="pr-2">{p.today} / {p.daily_limit}</td>
                    <td className="pr-2">{p.total}</td>
                    <td className="pr-2 text-gray-500">{p.last_used_at ? new Date(p.last_used_at).toLocaleString() : 'never'}</td>
                    <td className="pr-2">{p.active ? <span className="text-green-700">On</span> : <span className="text-gray-500">Off</span>}</td>
                    <td className="text-right whitespace-nowrap space-x-3">
                      <button type="button" disabled={busy} className="text-blue-600 hover:underline disabled:opacity-50"
                        onClick={() => act({ action: 'update', id: p.id, active: !p.active })}>{p.active ? 'Switch off' : 'Switch on'}</button>
                      <button type="button" disabled={busy} className="text-blue-600 hover:underline disabled:opacity-50"
                        onClick={async () => { const j = await act({ action: 'new_link', id: p.id }); if (j?.code) setShown({ code: j.code, name: p.name }) }}>New link</button>
                      <button type="button" disabled={busy} className="text-blue-600 hover:underline disabled:opacity-50"
                        onClick={() => { const v = window.prompt(`Questions per 24 hours for ${p.name}`, String(p.daily_limit)); if (v) act({ action: 'update', id: p.id, daily_limit: Number(v) }) }}>Limit</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </>
      )}
    </div>
  )
}

// ── Question log (every question asked in /ask, newest first) ─────────────
const LOG_FILTERS = [
  ['', 'All'], ['unavailable', 'Not answerable'], ['partial', 'Partial'],
  ['clarify', 'Clarifying'], ['error', 'Errors'], ['down', 'Thumbs down'], ['pilots', 'Pilots only'],
]
const STATUS_STYLE = {
  answered: 'bg-green-100 text-green-800', partial: 'bg-amber-100 text-amber-800',
  unavailable: 'bg-red-100 text-red-800', clarify: 'bg-blue-100 text-blue-800',
  error: 'bg-gray-200 text-gray-800',
}

function QuestionLog() {
  const [rows, setRows] = useState(null)
  const [err, setErr] = useState(null)
  const [filter, setFilter] = useState('')

  async function load() {
    setErr(null)
    try {
      const r = await fetch('/api/ask?log=1', { headers: await authHeaders() })
      const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows || [])
    } catch (e) {
      setErr(e.message || String(e))
    }
  }
  useEffect(() => { load() }, [])

  const all = rows || []
  const counts = all.reduce((c, r) => { c[r.status || 'unknown'] = (c[r.status || 'unknown'] || 0) + 1; return c }, {})
  const gaps = Object.entries(all.filter(r => r.gap && (r.status === 'unavailable' || r.status === 'partial'))
    .reduce((c, r) => { const g = r.gap.toLowerCase(); c[g] = (c[g] || 0) + 1; return c }, {}))
    .sort((a, b) => b[1] - a[1]).slice(0, 12)
  const shown = all.filter(r => !filter || (filter === 'down' ? r.rating === -1 : filter === 'pilots' ? !!r.pilot_name : r.status === filter))

  return (
    <div className="bg-white rounded-lg shadow p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-gray-800">Question log</h2>
        <button onClick={load} className="text-sm text-blue-600 hover:underline">Refresh</button>
      </div>
      {err && <div className="text-sm text-red-600">Could not load the log: {err}</div>}
      {rows && (
        <>
          <div className="text-sm text-gray-600">
            Last {all.length} questions ·{' '}
            {Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}
            {' '}· thumbs up {all.filter(r => r.rating === 1).length} · thumbs down {all.filter(r => r.rating === -1).length}
          </div>
          {gaps.length > 0 && (
            <div className="text-sm">
              <div className="font-medium text-gray-700 mb-1">Data gaps named by the assistant</div>
              <div className="flex flex-wrap gap-2">
                {gaps.map(([g, n]) => (
                  <span key={g} className="px-2 py-0.5 rounded bg-red-50 text-red-800 border border-red-200">{g} · {n}</span>
                ))}
              </div>
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            {LOG_FILTERS.map(([k, label]) => (
              <button key={k || 'all'} onClick={() => setFilter(k)}
                className={`px-2 py-1 rounded text-sm border ${filter === k ? 'bg-gray-800 text-white' : 'bg-white text-gray-700'}`}>
                {label}
              </button>
            ))}
          </div>
          {shown.length === 0 ? <div className="text-sm text-gray-500">Nothing here yet.</div> : (
            <div className="divide-y border rounded">
              {shown.map(r => (
                <details key={r.id} className="p-2 text-sm">
                  <summary className="cursor-pointer flex flex-wrap items-center gap-2">
                    <span className="text-gray-400 font-mono text-xs">{new Date(r.created_at).toLocaleString()}</span>
                    <span className={`px-1.5 rounded text-xs ${STATUS_STYLE[r.status] || 'bg-gray-100'}`}>{r.status || '?'}</span>
                    {r.pilot_name && <span className="px-1.5 rounded text-xs bg-indigo-100 text-indigo-800">{r.pilot_name}</span>}
                    {r.rating === 1 && <span title="Thumbs up">👍</span>}
                    {r.rating === -1 && <span title="Thumbs down">👎</span>}
                    <span className="text-gray-800">{r.question}</span>
                    {r.gap && <span className="text-gray-500">— {r.gap}</span>}
                  </summary>
                  <div className="mt-2 space-y-2 pl-2">
                    <div className="text-xs text-gray-500">
                      {r.pilot_name ? `Pilot: ${r.pilot_name}` : r.user_email} · {r.surface} · turn {r.turn} · {r.model} · {secs(r.ms)}
                      {' '}· look-ups: {(r.lookups || []).map(l => l.tool).join(', ') || 'none'}
                    </div>
                    {r.error ? <div className="text-red-600">Error: {r.error}</div>
                      : <div className="whitespace-pre-wrap text-gray-700">{r.answer}</div>}
                  </div>
                </details>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

export default function OwnerAsk({ session }) {
  const [models, setModels] = useState([])
  const [modelsError, setModelsError] = useState(null)
  const [credits, setCredits] = useState(null)
  const [model, setModel] = useState('')
  const [question, setQuestion] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState(null)

  const [benchModels, setBenchModels] = useState([])
  const [benchQs, setBenchQs] = useState(() => new Set(ASK_TEST_QUESTIONS.map(t => t.id)))
  const [bench, setBench] = useState({})          // `${id}|${model}` -> result
  const [benchRun, setBenchRun] = useState(null)  // { done, total } while running
  const [filter, setFilter] = useState('')

  const priceOf = useMemo(() => Object.fromEntries(models.map(m => [m.id, m])), [models])

  useEffect(() => {
    ;(async () => {
      try {
        const r = await fetch('/api/ask?models=1', { headers: await authHeaders() })
        const j = await r.json()
        if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
        setModels(j.models || [])
        setCredits(j.credits || null)
        setModel(j.default_model || '')
      } catch (e) {
        setModelsError(e.message || String(e))
      }
    })()
  }, [])

  async function onAsk(e) {
    e.preventDefault()
    if (!question.trim() || !model) return
    setBusy(true)
    setResult(null)
    setResult(await askApi(question.trim(), model))
    setBusy(false)
  }

  async function runBench() {
    const qs = ASK_TEST_QUESTIONS.filter(t => benchQs.has(t.id))
    const jobs = []
    for (const t of qs) for (const m of benchModels) jobs.push([t, m])
    if (!jobs.length) return
    setBenchRun({ done: 0, total: jobs.length })
    for (let i = 0; i < jobs.length; i++) {
      const [t, m] = jobs[i]
      const res = await askApi(t.q, m)
      setBench(b => ({ ...b, [`${t.id}|${m}`]: res }))
      setBenchRun({ done: i + 1, total: jobs.length })
    }
    setBenchRun(null)
  }

  const summary = benchModels.map(m => {
    const rows = ASK_TEST_QUESTIONS.map(t => [t, bench[`${t.id}|${m}`]]).filter(([, r]) => r)
    const checks = rows.map(([t, r]) => checkLookups(t, r))
    const costs = rows.map(([, r]) => costOf(r, priceOf[m])).filter(x => x != null)
    const times = rows.map(([, r]) => r.ms).filter(x => x != null)
    return {
      model: m,
      runs: rows.length,
      lookupsOk: checks.filter(c => c.ok === true).length,
      errors: rows.filter(([, r]) => r.error).length,
      avgCost: costs.length ? costs.reduce((a, b) => a + b, 0) / costs.length : null,
      avgMs: times.length ? times.reduce((a, b) => a + b, 0) / times.length : null,
    }
  })

  const shownModels = models.filter(m => !filter || m.id.toLowerCase().includes(filter.toLowerCase()))

  return (
    <OwnerLayout session={session} title="Ask PitchSide (prototype)">
      <div className="space-y-6 max-w-5xl">
        <div className="bg-white rounded-lg shadow p-4 text-sm text-gray-600">
          Owner-only prototype of the AI assistant (backlog F2). The model can only run PitchSide&apos;s fixed, read-only
          look-ups and explain what they return; every look-up is listed under the answer. Models are reached through
          Vercel AI Gateway{credits ? <> · gateway credit balance ${Number(credits.balance).toFixed(2)}</> : null}.
          {modelsError && <div className="mt-2 text-red-600">Could not load the model list: {modelsError}</div>}
        </div>

        <PilotUsage />

        <PilotAccess />

        <QuestionLog />

        {/* ── Ask ─────────────────────────────────────────────── */}
        <form onSubmit={onAsk} className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-800">Ask</h2>
          <textarea
            value={question}
            onChange={e => setQuestion(e.target.value)}
            rows={3}
            placeholder="e.g. Which Big Ten women's programs have the most goalkeeper openings for the class of 2027?"
            className="w-full px-3 py-2 border border-gray-300 rounded-lg"
          />
          <div className="flex flex-wrap items-center gap-3">
            <select value={model} onChange={e => setModel(e.target.value)} className="px-3 py-2 border border-gray-300 rounded-lg text-sm max-w-md">
              {!models.some(m => m.id === model) && model && <option value={model}>{model}</option>}
              {models.map(m => (
                <option key={m.id} value={m.id}>{m.id} — ${m.input_per_m.toFixed(2)} / ${m.output_per_m.toFixed(2)} per M</option>
              ))}
            </select>
            <button type="submit" disabled={busy || !question.trim()} className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-blue-300">
              {busy ? 'Thinking…' : 'Ask'}
            </button>
            {busy && <span className="text-sm text-gray-500">This can take 10–30 seconds.</span>}
          </div>

          {result && (
            <div className="border-t pt-3 space-y-3">
              {result.error
                ? <div className="text-red-600 text-sm">Error: {result.error}</div>
                : <div className="whitespace-pre-wrap text-gray-900">{result.answer}</div>}
              <div className="text-xs text-gray-500">
                {result.model} · {secs(result.ms)} · {result.usage?.input_tokens ?? '—'} tokens in / {result.usage?.output_tokens ?? '—'} out
                · est. cost {money(costOf(result, priceOf[result.model]))}
              </div>
              <div>
                <div className="text-sm font-medium text-gray-700 mb-1">Look-ups used</div>
                <Lookups lookups={result.lookups} />
              </div>
            </div>
          )}
        </form>

        {/* ── Bake-off ────────────────────────────────────────── */}
        <div className="bg-white rounded-lg shadow p-4 space-y-3">
          <h2 className="text-lg font-semibold text-gray-800">Bake-off</h2>
          <p className="text-sm text-gray-600">
            Pick the models, then run. Each question runs on each model, one at a time. &quot;Look-ups&quot; is checked
            automatically; whether the answer is right is for you to judge (open a cell to read it).
          </p>
          <div className="flex items-center gap-2">
            <input value={filter} onChange={e => setFilter(e.target.value)} placeholder="Filter models (e.g. anthropic, gpt, gemini)"
              className="px-3 py-1.5 border border-gray-300 rounded-lg text-sm w-80" />
            <span className="text-xs text-gray-500">{benchModels.length} chosen</span>
          </div>
          <div className="max-h-48 overflow-y-auto border rounded p-2 grid sm:grid-cols-2 gap-1 text-sm">
            {shownModels.map(m => (
              <label key={m.id} className="flex items-center gap-2">
                <input type="checkbox" checked={benchModels.includes(m.id)}
                  onChange={e => setBenchModels(b => e.target.checked ? [...b, m.id] : b.filter(x => x !== m.id))} />
                <span className="font-mono">{m.id}</span>
                <span className="text-gray-400 text-xs">${m.input_per_m.toFixed(2)}/${m.output_per_m.toFixed(2)}</span>
              </label>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" onClick={runBench} disabled={!!benchRun || !benchModels.length || !benchQs.size}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:bg-blue-300">
              {benchRun ? `Running ${benchRun.done} of ${benchRun.total}…` : `Run ${benchQs.size} questions × ${benchModels.length} models`}
            </button>
            <button type="button" onClick={() => setBench({})} disabled={!!benchRun} className="px-3 py-2 border rounded-lg text-sm">Clear results</button>
            <button type="button" disabled={!Object.keys(bench).length}
              onClick={() => navigator.clipboard?.writeText(JSON.stringify(bench, null, 2))}
              className="px-3 py-2 border rounded-lg text-sm">Copy results (JSON)</button>
          </div>

          {summary.some(s => s.runs) && (
            <table className="w-full text-sm border">
              <thead className="bg-gray-50">
                <tr><th className="text-left p-2">Model</th><th className="p-2">Answered</th><th className="p-2">Right look-ups</th>
                  <th className="p-2">Errors</th><th className="p-2">Avg cost</th><th className="p-2">Avg time</th></tr>
              </thead>
              <tbody>
                {summary.map(s => (
                  <tr key={s.model} className="border-t">
                    <td className="p-2 font-mono">{s.model}</td><td className="p-2 text-center">{s.runs}</td>
                    <td className="p-2 text-center">{s.lookupsOk} / {s.runs}</td><td className="p-2 text-center">{s.errors}</td>
                    <td className="p-2 text-center">{money(s.avgCost)}</td><td className="p-2 text-center">{secs(s.avgMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <div className="space-y-2">
            {ASK_TEST_QUESTIONS.map(t => (
              <div key={t.id} className="border rounded">
                <label className="flex items-start gap-2 p-2 bg-gray-50 text-sm">
                  <input type="checkbox" className="mt-1" checked={benchQs.has(t.id)}
                    onChange={e => setBenchQs(s => { const n = new Set(s); e.target.checked ? n.add(t.id) : n.delete(t.id); return n })} />
                  <span><b>{t.id}.</b> {t.q} <span className="text-gray-400">
                    — expects {t.none ? 'no look-ups (honest "not available")' : t.expect.join(' + ')}</span></span>
                </label>
                {benchModels.map(m => {
                  const r = bench[`${t.id}|${m}`]
                  if (!r) return null
                  const c = checkLookups(t, r)
                  return (
                    <details key={m} className="border-t px-2 py-1 text-sm">
                      <summary className="cursor-pointer">
                        <span className={c.ok === true ? 'text-green-700' : c.ok === false ? 'text-red-600' : 'text-amber-600'}>
                          {c.ok === true ? '✓' : c.ok === false ? '✗' : '?'}
                        </span>{' '}
                        <span className="font-mono">{m}</span>
                        <span className="text-gray-500"> · {c.text} · {secs(r.ms)} · {money(costOf(r, priceOf[m]))}</span>
                      </summary>
                      <div className="py-2 space-y-2">
                        {r.error ? <div className="text-red-600">Error: {r.error}</div>
                          : <div className="whitespace-pre-wrap">{r.answer}</div>}
                        <Lookups lookups={r.lookups} />
                      </div>
                    </details>
                  )
                })}
              </div>
            ))}
          </div>
        </div>
      </div>
    </OwnerLayout>
  )
}
