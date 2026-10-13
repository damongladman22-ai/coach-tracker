import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { supabase } from '../lib/supabase'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'
import { useCollegeProfileLogos } from '../college-profiles/access/useCollegeProfileLogos'
import { brandingFor } from '../college-profiles/data/schoolBranding'
import { PageLoader } from '../components/LoadingStates'
import OPLogo from '../components/OPLogo'
import { streamAsk, splitAnswer, lookupLabel, sourceLabels, programCards } from '../ask/askClient'
import { getFavorites } from '../hooks/useFavorite'

/**
 * Ask PitchSide — the consumer chat experience for the AI assistant (backlog F2).
 *
 * A full-page conversation in the College Soccer Intelligence shell:
 *  - answers stream in as they are written, rendered as Markdown (lists,
 *    tables, bold, links to program profiles);
 *  - while the model works, each look-up shows as a plain-words status line;
 *  - ranked program lists also appear as program cards (logo, division,
 *    the key number) built from the look-up rows themselves, so the headline
 *    numbers never depend on the model's wording;
 *  - "Based on" names the data behind every answer, and "Show the data" opens
 *    the rows; three follow-up suggestions follow each answer;
 *  - the conversation is kept in this browser and can be started over.
 *
 * Owner-only while in preview (Damon, 2026-10-13). /owner/ask stays as the
 * model test bench.
 */

const STORE_KEY = 'ask-pitchside-thread-v1'
const SUGGESTIONS = [
  { label: 'Openings', q: "Which Big Ten women's programs have the most estimated goalkeeper openings for the class of 2027?" },
  { label: 'Academic fit', q: "Women's D3 programs in Ohio or Pennsylvania with an average SAT around 1300 that offer nursing" },
  { label: 'Your team', q: 'Which college programs have watched our team play?' },
  { label: 'Results', q: "What are the top 10 NCAA D1 women's teams by RPI right now?" },
  { label: 'A program', q: "How has Ohio State women's soccer done over the last three seasons, and who coaches them?" },
  { label: 'Compare', q: 'Compare Kenyon and Denison for a student who wants to study biology and play soccer' },
]

const newId = () => Math.random().toString(36).slice(2, 10)

function loadThread() {
  try { const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]'); return Array.isArray(v) ? v : [] } catch { return [] }
}
function saveThread(msgs) {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(msgs.slice(-30))) } catch { /* storage full or blocked */ }
}

function monogram(name) {
  const w = String(name || '').replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  return (w.slice(0, 2).map(x => x[0]).join('') || '—').toUpperCase()
}

// ── pieces ──────────────────────────────────────────────────────────────────

function Crest({ id, name, logosEnabled, size = 40 }) {
  const url = logosEnabled ? brandingFor(id)?.logoUrl : null
  const [ok, setOk] = useState(true)
  const show = url && ok
  return (
    <div className="flex-shrink-0 grid place-items-center rounded-full overflow-hidden"
      style={{ width: size, height: size, background: show ? '#fff' : '#334155',
        boxShadow: show ? 'inset 0 0 0 1px #E5E8EB' : 'none' }}>
      {show
        ? <img src={url} alt="" onError={() => setOk(false)} style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 5 }} />
        : <span className="text-white font-bold text-xs">{monogram(name)}</span>}
    </div>
  )
}

const md = {
  a: ({ href, children }) => (href && href.startsWith('/')
    ? <Link to={href} className="text-[#1d4ed8] font-medium hover:underline">{children}</Link>
    : <a href={href} target="_blank" rel="noreferrer" className="text-[#1d4ed8] hover:underline">{children}</a>),
  p: ({ children }) => <p className="my-2 leading-relaxed">{children}</p>,
  ul: ({ children }) => <ul className="my-2 pl-5 list-disc space-y-1">{children}</ul>,
  ol: ({ children }) => <ol className="my-2 pl-5 list-decimal space-y-1">{children}</ol>,
  li: ({ children }) => <li className="leading-relaxed">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-gray-900">{children}</strong>,
  h1: ({ children }) => <h3 className="mt-4 mb-1 text-base font-semibold text-gray-900">{children}</h3>,
  h2: ({ children }) => <h3 className="mt-4 mb-1 text-base font-semibold text-gray-900">{children}</h3>,
  h3: ({ children }) => <h3 className="mt-4 mb-1 text-base font-semibold text-gray-900">{children}</h3>,
  table: ({ children }) => (
    <div className="my-3 overflow-x-auto rounded-lg border border-[#E5E8EB]">
      <table className="w-full text-sm border-collapse">{children}</table>
    </div>),
  thead: ({ children }) => <thead className="bg-[#F7F8FA] text-gray-600">{children}</thead>,
  th: ({ children }) => <th className="text-left font-semibold px-3 py-2 border-b border-[#E5E8EB] whitespace-nowrap">{children}</th>,
  td: ({ children }) => <td className="px-3 py-2 border-b border-[#F0F2F4] align-top">{children}</td>,
  hr: () => <hr className="my-3 border-[#E5E8EB]" />,
  code: ({ children }) => <code className="px-1 py-0.5 rounded bg-[#F2F3F5] text-[13px]">{children}</code>,
}

function ProgramCards({ items, logosEnabled }) {
  const [all, setAll] = useState(false)
  if (!items.length) return null
  const shown = all ? items : items.slice(0, 6)
  return (
    <div className="mt-3">
      <div className="grid sm:grid-cols-2 gap-2">
        {shown.map(p => {
          const big = p.card ? p.card.value : (p.rpi_rank != null ? `#${p.rpi_rank}` : p.record)
          const small = p.card ? p.card.label : (p.rpi_rank != null ? `RPI · ${p.record}` : 'record')
          return (
            <Link key={p.school_id} to={`/school/${p.school_id}`}
              className="flex items-center gap-3 bg-white border border-[#E5E8EB] rounded-xl px-3 py-2.5 hover:border-gray-400 hover:shadow-sm transition">
              <Crest id={p.school_id} name={p.school} logosEnabled={logosEnabled} />
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold text-gray-900 leading-snug line-clamp-2">{p.school}</div>
                <div className="text-xs text-gray-500 truncate">{[p.division, p.conference, p.state].filter(Boolean).join(' · ')}</div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-base font-semibold text-gray-900 leading-tight">{big ?? '—'}</div>
                <div className="text-[11px] text-gray-500 leading-tight whitespace-nowrap">{small}</div>
              </div>
            </Link>
          )
        })}
      </div>
      {items.length > 6 && (
        <button type="button" onClick={() => setAll(a => !a)}
          className="mt-2 text-sm text-[#1d4ed8] hover:underline">
          {all ? 'Show fewer' : `Show all ${items.length} programs`}
        </button>
      )}
    </div>
  )
}

function DataTable({ rows }) {
  if (!Array.isArray(rows) || !rows.length) return null
  const cols = Object.keys(rows[0]).filter(k => !['school_id', 'reasons'].includes(k))
  const cell = v => (v == null ? '' : typeof v === 'object' ? Object.entries(v).map(([k, x]) => `${k} ${x}`).join(', ') : String(v))
  return (
    <div className="overflow-x-auto rounded-lg border border-[#E5E8EB] my-2">
      <table className="w-full text-xs">
        <thead className="bg-[#F7F8FA] text-gray-600">
          <tr>{cols.map(c => <th key={c} className="text-left font-semibold px-2 py-1.5 whitespace-nowrap">{c.replace(/_/g, ' ')}</th>)}</tr>
        </thead>
        <tbody>
          {rows.slice(0, 25).map((r, i) => (
            <tr key={i} className="border-t border-[#F0F2F4]">
              {cols.map(c => <td key={c} className="px-2 py-1.5 align-top">{cell(r[c])}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function DataPanel({ lookups }) {
  const blocks = (lookups || []).filter(l => l.output && l.tool !== 'find_school')
  return (
    <div className="mt-2 space-y-3">
      {blocks.map((l, i) => {
        const o = l.output || {}
        const rows = o.programs || o.seasons || o.coaches || o.matches
        return (
          <div key={i}>
            <div className="text-xs font-semibold text-gray-600">{lookupLabel(l.tool, l.input)}</div>
            {o.error && <div className="text-xs text-red-600">{o.error}</div>}
            {rows ? <DataTable rows={rows} /> : (
              <pre className="text-[11px] bg-[#F7F8FA] rounded-lg p-2 overflow-x-auto whitespace-pre-wrap">{JSON.stringify(o, null, 2)}</pre>
            )}
          </div>
        )
      })}
    </div>
  )
}

function Thinking({ lookups }) {
  const last = lookups?.length ? lookups[lookups.length - 1] : null
  return (
    <div className="flex items-center gap-2 text-sm text-gray-500 py-1">
      <span className="inline-flex gap-1">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '0ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '150ms' }} />
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400 animate-bounce" style={{ animationDelay: '300ms' }} />
      </span>
      <span>{last ? `${lookupLabel(last.tool, last.input)}…` : 'Thinking…'}</span>
    </div>
  )
}

function Thumb({ up, on, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={up ? 'Good answer' : 'Bad answer'} aria-pressed={on}
      className={'p-0.5 rounded hover:text-gray-800 ' + (on ? 'text-gray-900' : '')}>
      <svg viewBox="0 0 24 24" className="w-4 h-4" fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
        style={up ? undefined : { transform: 'scaleY(-1)' }}>
        <path d="M7 10v11H4a1 1 0 0 1-1-1v-9a1 1 0 0 1 1-1h3zm0 0 4-7a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.4 7A2 2 0 0 1 17.6 21H7" />
      </svg>
    </button>
  )
}

function AssistantMessage({ m, logosEnabled, onFollowUp, onRate, busy }) {
  const [showData, setShowData] = useState(false)
  const [copied, setCopied] = useState(false)
  const { body, followups } = splitAnswer(m.content)
  const cards = useMemo(() => programCards(m.lookups), [m.lookups])
  const sources = sourceLabels(m.lookups)
  const streaming = m.status === 'streaming'

  return (
    <div className="flex gap-3">
      <div className="flex-shrink-0 mt-1"><OPLogo className="h-7 w-7" /></div>
      <div className="min-w-0 flex-1 text-[15px] text-gray-800">
        {streaming && !body && <Thinking lookups={m.lookups} />}
        {body && <ReactMarkdown remarkPlugins={[remarkGfm]} components={md}>{body}</ReactMarkdown>}
        {streaming && body && m.lookups?.some(l => !l.output) && <Thinking lookups={m.lookups} />}
        {m.status === 'error' && (
          <div className="mt-1 text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
            Sorry, that did not work. {m.error ? <span className="text-red-500">({m.error})</span> : null} Please try again.
          </div>
        )}

        {!streaming && <ProgramCards items={cards} logosEnabled={logosEnabled} />}

        {!streaming && m.status === 'done' && (
          <>
            <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
              {sources.length > 0 && <span>Sources: {sources.join(' · ')}</span>}
              {m.lookups?.some(l => l.tool !== 'find_school') && (
                <button type="button" onClick={() => setShowData(s => !s)} className="text-[#1d4ed8] hover:underline">
                  {showData ? 'Hide the data' : 'Show the data'}
                </button>
              )}
              <button type="button" className="hover:text-gray-800"
                onClick={() => { navigator.clipboard?.writeText(body); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
                {copied ? 'Copied' : 'Copy'}
              </button>
              {m.logId && (
                <span className="inline-flex items-center gap-1">
                  <Thumb up on={m.rating === 1} onClick={() => onRate(m, m.rating === 1 ? 0 : 1)} />
                  <Thumb on={m.rating === -1} onClick={() => onRate(m, m.rating === -1 ? 0 : -1)} />
                </span>
              )}
            </div>
            {showData && <DataPanel lookups={m.lookups} />}
            {followups.length > 0 && (
              <div className="mt-3 flex flex-col sm:flex-row sm:flex-wrap gap-2">
                {followups.map((f, i) => (
                  <button key={i} type="button" disabled={busy} onClick={() => onFollowUp(f)}
                    className="text-left text-sm bg-white border border-[#D9DEE3] rounded-full px-3.5 py-1.5 text-gray-700 hover:border-gray-500 hover:text-gray-900 disabled:opacity-50">
                    {f}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function EmptyState({ onPick }) {
  return (
    <div className="pt-10 sm:pt-16 pb-6 text-center">
      <OPLogo className="h-12 w-12 mx-auto" />
      <h1 className="mt-4 text-2xl sm:text-3xl font-semibold text-gray-900">Ask about any college soccer program</h1>
      <p className="mt-2 text-gray-500 max-w-xl mx-auto">
        Openings by position and class, results and RPI, transfers, coaching staffs and campus facts, answered from PitchSide&apos;s college data.
      </p>
      <div className="mt-8 grid sm:grid-cols-2 gap-3 text-left">
        {SUGGESTIONS.map(s => (
          <button key={s.q} type="button" onClick={() => onPick(s.q)}
            className="text-left bg-white border border-[#E5E8EB] rounded-xl px-4 py-3 hover:border-gray-400 hover:shadow-sm transition">
            <div className="text-[11px] font-semibold uppercase tracking-wider text-gray-400">{s.label}</div>
            <div className="mt-1 text-sm text-gray-800">{s.q}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── page ────────────────────────────────────────────────────────────────────

export default function AskPitchSide({ session }) {
  const owner = useIsSuperAdmin(session)
  const logosEnabled = useCollegeProfileLogos(supabase)
  const [msgs, setMsgs] = useState(loadThread)
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)
  const abortRef = useRef(null)
  const endRef = useRef(null)
  const boxRef = useRef(null)

  useEffect(() => { if (!busy) saveThread(msgs) }, [msgs, busy])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' }) }, [msgs])
  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 180) + 'px'
  }, [input])

  if (owner === 'checking') return <PageLoader message="Loading…" />
  if (owner !== 'allowed') {
    return (
      <div className="min-h-screen bg-[#F2F3F5]">
        <div className="max-w-3xl mx-auto px-4 py-16 text-center text-gray-600">Ask PitchSide is coming soon.</div>
      </div>
    )
  }

  const update = (id, fn) => setMsgs(list => list.map(m => (m.id === id ? fn(m) : m)))

  async function send(text) {
    const q = String(text || '').trim()
    if (!q || busy) return
    const user = { id: newId(), role: 'user', content: q }
    const bot = { id: newId(), role: 'assistant', content: '', lookups: [], status: 'streaming' }
    const history = [...msgs.filter(m => m.status !== 'error'), user]
      .map(m => ({ role: m.role, content: m.role === 'assistant' ? splitAnswer(m.content).body : m.content }))
    setMsgs(list => [...list, user, bot])
    setInput('')
    setBusy(true)
    const ctrl = new AbortController()
    abortRef.current = ctrl
    try {
      await streamAsk(history, {
        signal: ctrl.signal,
        context: { favoriteTeamIds: getFavorites() },
        onEvent: ev => {
          if (ev.t === 'text') update(bot.id, m => ({ ...m, content: m.content + ev.d }))
          else if (ev.t === 'lookup') update(bot.id, m => ({ ...m, lookups: [...m.lookups, { tool: ev.tool, input: ev.input }] }))
          else if (ev.t === 'data') update(bot.id, m => {
            const ls = [...m.lookups]
            const i = ls.findIndex(l => l.tool === ev.tool && !l.output)
            if (i >= 0) ls[i] = { ...ls[i], output: ev.output }
            else ls.push({ tool: ev.tool, input: ev.input, output: ev.output })
            return { ...m, lookups: ls }
          })
          else if (ev.t === 'error') update(bot.id, m => ({ ...m, status: 'error', error: ev.error }))
          else if (ev.t === 'done') update(bot.id, m => ({ ...m, logId: ev.log_id || null, status: m.status === 'error' ? 'error' : 'done' }))
        },
      })
      update(bot.id, m => (m.status === 'streaming' ? { ...m, status: m.content ? 'done' : 'error' } : m))
    } catch (e) {
      if (e?.name === 'AbortError') update(bot.id, m => ({ ...m, status: m.content ? 'done' : 'error', error: m.content ? null : 'stopped' }))
      else update(bot.id, m => ({ ...m, status: 'error', error: e.message || String(e) }))
    } finally {
      setBusy(false)
      abortRef.current = null
    }
  }

  async function rate(m, rating) {
    update(m.id, x => ({ ...x, rating }))
    try {
      const { data } = await supabase.auth.getSession()
      const token = data?.session?.access_token
      await fetch('/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
        body: JSON.stringify({ feedback: { log_id: m.logId, rating } }),
      })
    } catch { /* the rating is a nicety; never interrupt the chat for it */ }
  }

  const onKey = e => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); send(input) }
  }

  return (
    <div className="min-h-[calc(100vh-6.5rem)] bg-[#F2F3F5] flex flex-col">
      <div className="flex-1 w-full max-w-3xl mx-auto px-4">
        {msgs.length > 0 && (
          <div className="flex justify-end pt-3">
            <button type="button" disabled={busy}
              onClick={() => { setMsgs([]); saveThread([]) }}
              className="text-sm text-gray-600 border border-[#D9DEE3] bg-white rounded-full px-3 py-1 hover:border-gray-500 disabled:opacity-50">
              New chat
            </button>
          </div>
        )}
        {msgs.length === 0
          ? <EmptyState onPick={send} />
          : (
            <div className="py-4 space-y-6">
              {msgs.map(m => (m.role === 'user'
                ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] bg-[#0a1628] text-white rounded-2xl rounded-br-md px-4 py-2.5 text-[15px] whitespace-pre-wrap">{m.content}</div>
                  </div>)
                : <AssistantMessage key={m.id} m={m} logosEnabled={logosEnabled} onFollowUp={send} onRate={rate} busy={busy} />))}
              <div ref={endRef} style={{ scrollMarginBottom: 150 }} />
            </div>
          )}
      </div>

      <div className="sticky bottom-0 w-full bg-gradient-to-t from-[#F2F3F5] via-[#F2F3F5] to-transparent pt-4 pb-3">
        <div className="max-w-3xl mx-auto px-4">
          <div className="flex items-end gap-2 bg-white border border-[#D9DEE3] rounded-2xl shadow-sm px-3 py-2 focus-within:border-gray-500">
            <textarea ref={boxRef} rows={1} value={input} onChange={e => setInput(e.target.value)} onKeyDown={onKey}
              placeholder="Ask about programs, openings, records, transfers or coaches…"
              className="flex-1 resize-none outline-none text-[15px] leading-6 py-1.5 bg-transparent max-h-[180px]" />
            {busy
              ? (
                <button type="button" onClick={() => abortRef.current?.abort()} aria-label="Stop"
                  className="flex-shrink-0 h-9 w-9 rounded-full bg-gray-800 text-white grid place-items-center hover:bg-gray-700">
                  <span className="block w-3 h-3 bg-white rounded-sm" />
                </button>)
              : (
                <button type="button" onClick={() => send(input)} disabled={!input.trim()} aria-label="Send"
                  className="flex-shrink-0 h-9 w-9 rounded-full bg-[#0a1628] text-white grid place-items-center disabled:bg-gray-300">
                  <svg viewBox="0 0 24 24" className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 19V5M5 12l7-7 7 7" />
                  </svg>
                </button>)}
          </div>
          <p className="mt-1.5 text-center text-[11px] text-gray-400">
            Answers come from PitchSide data and can be wrong. Openings are estimates; check each program&apos;s page before you rely on them.
          </p>
        </div>
      </div>
    </div>
  )
}
