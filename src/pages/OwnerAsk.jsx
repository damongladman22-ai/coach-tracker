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
