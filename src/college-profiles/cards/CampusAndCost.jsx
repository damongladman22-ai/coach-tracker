import { useMemo, useState } from 'react'

/**
 * CampusAndCost — the college behind the program, from the U.S. Department of
 * Education's College Scorecard (backlog F8, 2026-10-07): size and setting,
 * cost and net price, admissions and outcomes, and majors.
 *
 * Presentational only — data comes from useCollegeFacts. Renders nothing when
 * the program has no federal college (joint teams such as Pomona-Pitzer, a
 * Canadian school). Every figure is null-safe: a missing value shows a dash or
 * its row is left out, never a zero.
 *
 * The federal college is named on the card because several programs share one
 * (men's and women's teams; branch campuses reported with their parent; the
 * Pennsylvania schools that merged in 2022).
 */

const LOCALE = {
  11: 'Large city', 12: 'Midsize city', 13: 'Small city',
  21: 'Large suburb', 22: 'Midsize suburb', 23: 'Small suburb',
  31: 'Town near a city', 32: 'Town', 33: 'Remote town',
  41: 'Rural, near a city', 42: 'Rural', 43: 'Remote rural',
}
const CONTROL = { 1: 'Public', 2: 'Private nonprofit', 3: 'Private for-profit' }
const LEVEL = { 2: 'Associate', 3: "Bachelor’s" }

const DASH = '—'
function money(x) { return x == null ? DASH : '$' + Math.round(x).toLocaleString('en-US') }
function pct(x) { return x == null ? DASH : Math.round(x * 100) + '%' }
function count(x) { return x == null ? DASH : Math.round(x).toLocaleString('en-US') }

function Row({ label, value, sub }) {
  if (value == null) return null
  return (
    <div className="cp-cc-row">
      <dt>{label}</dt>
      <dd>
        <span className="cp-num">{value}</span>
        {sub ? <span className="cp-cc-rowsub">{sub}</span> : null}
      </dd>
    </div>
  )
}

function Tile({ value, label, sub }) {
  return (
    <div className="cp-cc-tile">
      <span className="cp-cc-tv cp-num">{value}</span>
      <span className="cp-cc-tl">{label}</span>
      {sub ? <span className="cp-cc-ts">{sub}</span> : null}
    </div>
  )
}

function Majors({ majors }) {
  // A level is offered as a tab only when it is a real part of the college:
  // Ohio State lists 2 associate programs beside 120 bachelor's, Dallas College
  // 1 bachelor's beside 50 associate. Five programs, or the only level, qualifies.
  const levels = useMemo(() => {
    const n = new Map()
    for (const m of majors) n.set(m.level, (n.get(m.level) || 0) + 1)
    const all = [...n.keys()].sort((x, y) => y - x)
    const real = all.filter(l => n.get(l) >= 5)
    return real.length ? real : all
  }, [majors])
  const [level, setLevel] = useState(levels[0])
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(() => new Set())
  const activeLevel = levels.includes(level) ? level : levels[0]

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byFam = new Map()
    for (const m of majors) {
      if (m.level !== activeLevel) continue
      if (q && !m.title.toLowerCase().includes(q) && !m.family.toLowerCase().includes(q)) continue
      if (!byFam.has(m.familyCode)) byFam.set(m.familyCode, { code: m.familyCode, name: m.family, items: [], grads: 0 })
      const g = byFam.get(m.familyCode)
      g.items.push(m)
      g.grads += m.graduates || 0
    }
    const list = [...byFam.values()]
    for (const g of list) g.items.sort((a, b) => (b.graduates || 0) - (a.graduates || 0) || a.title.localeCompare(b.title))
    list.sort((a, b) => b.grads - a.grads || a.name.localeCompare(b.name))
    return list
  }, [majors, activeLevel, query])

  if (!majors.length) return null
  const total = groups.reduce((n, g) => n + g.items.length, 0)
  const maxGrads = Math.max(1, ...groups.map(g => g.grads))
  const searching = query.trim().length > 0

  const toggle = code => setOpen(prev => {
    const next = new Set(prev)
    if (next.has(code)) next.delete(code); else next.add(code)
    return next
  })

  return (
    <div className="cp-cc-majors">
      <div className="cp-cc-mhead">
        <p className="cp-eyebrow">Majors</p>
        {levels.length > 1 && (
          <div className="cp-peer-toggle" role="tablist" aria-label="Degree level">
            {levels.map(l => (
              <button key={l} type="button" role="tab" aria-selected={l === activeLevel}
                className={`cp-peer-tgl${l === activeLevel ? ' cp-peer-tgl--on' : ''}`}
                onClick={() => setLevel(l)}>{LEVEL[l]}</button>
            ))}
          </div>
        )}
        <input className="cp-cc-search" type="search" value={query} placeholder="Search majors"
          aria-label="Search majors" onChange={e => setQuery(e.target.value)} />
      </div>
      <p className="cp-cc-msum">
        {searching
          ? <><b>{total}</b> {total === 1 ? 'major matches' : 'majors match'} &ldquo;{query.trim()}&rdquo;</>
          : <><b>{total}</b> {LEVEL[activeLevel].toLowerCase()} {total === 1 ? 'program' : 'programs'} in <b>{groups.length}</b> {groups.length === 1 ? 'area' : 'areas'}. Bars show graduates over the last two years.</>}
      </p>
      {groups.length === 0 ? (
        <div className="cp-muted" style={{ fontSize: 13 }}>No majors match.</div>
      ) : (
        <ul className="cp-cc-fams">
          {groups.map(g => {
            const isOpen = searching || open.has(g.code)
            return (
              <li key={g.code} className={isOpen ? 'cp-cc-fam cp-cc-fam--open' : 'cp-cc-fam'}>
                <button type="button" className="cp-cc-famrow" aria-expanded={isOpen} onClick={() => toggle(g.code)}>
                  <span className="cp-cc-famnm">{g.name}</span>
                  <span className="cp-cc-famtrack" title={`${g.grads.toLocaleString('en-US')} graduates over the last two years`}><span className="cp-cc-famfill" style={{ width: `${(g.grads / maxGrads) * 100}%` }} /></span>
                  <span className="cp-cc-famn cp-num">{g.items.length}</span>
                  <span className="cp-cc-chev" aria-hidden="true">{isOpen ? '−' : '+'}</span>
                </button>
                {isOpen && (
                  <ul className="cp-cc-progs">
                    {g.items.map(m => (
                      <li key={m.cip + '-' + m.level}>{m.title}</li>
                    ))}
                  </ul>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

export default function CampusAndCost({ facts, majors }) {
  if (!facts) return null
  const f = facts
  const setting = LOCALE[f.locale] || null
  const control = CONTROL[f.control] || null
  const sameTuition = f.tuition_in_state != null && f.tuition_in_state === f.tuition_out_of_state
  const place = [f.city, f.state].filter(Boolean).join(', ')
  const twoYear = f.predominant_degree != null && f.predominant_degree <= 2

  return (
    <div className="cp-panel cp-cc">
      <h3 className="cp-panel-h">Campus and cost</h3>
      <p className="cp-panel-desc">
        Federal figures for <b>{f.federal_name}</b>{place ? ` (${place})` : ''}, from the U.S. Department of Education&rsquo;s College Scorecard.
        {(f.website || f.net_price_calculator) && (
          <span className="cp-cc-links">
            {f.website && <a href={f.website} target="_blank" rel="noreferrer">College website</a>}
            {f.website && f.net_price_calculator && <span className="cp-dot">&middot;</span>}
            {f.net_price_calculator && <a href={f.net_price_calculator} target="_blank" rel="noreferrer">Net price calculator</a>}
          </span>
        )}
      </p>

      <div className="cp-cc-tiles">
        <Tile value={count(f.undergrad_enrollment)} label="Undergraduates"
          sub={[control, setting].filter(Boolean).join(' · ')} />
        <Tile value={money(f.avg_net_price)} label="Average net price"
          sub={f.cost_of_attendance != null ? `${money(f.cost_of_attendance)} published cost` : null} />
        <Tile value={f.admission_rate != null ? pct(f.admission_rate) : (twoYear ? 'Open' : DASH)}
          label={f.admission_rate != null ? 'Admission rate' : (twoYear ? 'Admission' : 'Admission rate')}
          sub={f.admission_rate == null ? (twoYear ? 'No admission rate reported' : 'Not reported') : null} />
        <Tile value={pct(f.graduation_rate)} label="Graduation rate"
          sub={f.graduation_rate != null ? 'within 150% of normal time' : 'Not reported'} />
      </div>

      <div className="cp-cc-cols">
        <dl className="cp-cc-col">
          <p className="cp-eyebrow">Size and setting</p>
          <Row label="Undergraduates" value={f.undergrad_enrollment != null ? count(f.undergrad_enrollment) : null}
            sub={f.share_women != null ? `${pct(f.share_women)} women` : null} />
          <Row label="Type" value={control} />
          <Row label="Setting" value={setting} />
          <Row label="Location" value={place || null} />
        </dl>
        <dl className="cp-cc-col">
          <p className="cp-eyebrow">Cost per year</p>
          <Row label="Published cost" value={f.cost_of_attendance != null ? money(f.cost_of_attendance) : null}
            sub="tuition, housing, food, books" />
          {sameTuition
            ? <Row label="Tuition and fees" value={money(f.tuition_in_state)} />
            : <>
                <Row label="Tuition, in-state" value={f.tuition_in_state != null ? money(f.tuition_in_state) : null} />
                <Row label="Tuition, out-of-state" value={f.tuition_out_of_state != null ? money(f.tuition_out_of_state) : null} />
              </>}
          <Row label="Average net price" value={f.avg_net_price != null ? money(f.avg_net_price) : null}
            sub="after grants and scholarships" />
          <Row label="Net price, income up to $30k" value={f.net_price_low_income != null ? money(f.net_price_low_income) : null} />
          <Row label="Net price, income over $110k" value={f.net_price_high_income != null ? money(f.net_price_high_income) : null} />
        </dl>
        <dl className="cp-cc-col">
          <p className="cp-eyebrow">Admissions and outcomes</p>
          <Row label="Admission rate" value={f.admission_rate != null ? pct(f.admission_rate) : null} />
          <Row label="Average SAT" value={f.sat_average != null ? count(f.sat_average) : null} />
          <Row label="Return for second year" value={f.retention_rate != null ? pct(f.retention_rate) : null} />
          <Row label="Graduation rate" value={f.graduation_rate != null ? pct(f.graduation_rate) : null} />
          <Row label="Median earnings" value={f.median_earnings_10yr != null ? money(f.median_earnings_10yr) : null}
            sub="10 years after starting" />
        </dl>
      </div>

      <Majors majors={majors || []} />

      <p className="cp-cc-note">
        Net price is the average yearly cost after grants and scholarships for full-time first-year students who receive aid.
        Graduation rate counts students who finish within 150% of normal time (six years for a four-year degree).
        Majors are programs that awarded degrees in the two most recent years reported.
        Source: {f.source_release}.
      </p>
    </div>
  )
}
