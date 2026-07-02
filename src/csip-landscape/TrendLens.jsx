import { useState } from 'react'
import { pct, inchesToFtIn, whole, divShort, genderLabel } from './data/landscapeFormat'

/**
 * TrendLens — Lens C. One segment, one metric family, across 2021–2025.
 * Single metrics use an editorial area (hero current value + Δ, p25–p75 band +
 * median line); composition families use a stacked flow (counts stacked per
 * season, share·count on tap). Geography gets its own rich pass. Mobile-first:
 * all text is HTML; only shapes are SVG.
 */
const SEASONS_ALL = [2021, 2022, 2023, 2024, 2025]
const SF_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e34948']

function fmtVal(v, fmt) {
  if (v == null) return '—'
  if (fmt === 'pct') return pct(v)
  if (fmt === 'inches') return inchesToFtIn(v)
  return whole(v)
}
function deltaLabel(d, fmt) {
  const sign = d > 0 ? '+' : '−'
  const a = Math.abs(d)
  if (fmt === 'pct') { if (Math.round(a * 100) === 0) return 'no change'; return `${sign}${Math.round(a * 100)} pts` }
  if (fmt === 'inches') { if (a < 0.05) return 'no change'; return `${sign}${a.toFixed(1)}″` }
  if (Math.round(a) === 0) return 'no change'
  return `${sign}${Math.round(a)}`
}
const dirOf = d => (Math.abs(d) < 1e-9 ? 'flat' : d > 0 ? 'up' : 'down')

function seasonPoints(get, dim, bucket, metric) {
  return SEASONS_ALL
    .map(s => { const r = get(s, dim, bucket, metric); return r ? { season: s, ...r } : null })
    .filter(Boolean)
}

function EditorialArea({ points, fmt, color = '#2a78d6', label, compact }) {
  if (!points.length) return <div className="csl-ed"><p className="csl-empty">No data.</p></div>
  const last = points[points.length - 1], first = points[0]
  const delta = last.median - first.median
  const dir = dirOf(delta)

  const VBW = 600, VBH = compact ? 96 : 150, pad = 10
  let lo = Infinity, hi = -Infinity
  points.forEach(p => { lo = Math.min(lo, p.p25 ?? p.median); hi = Math.max(hi, p.p75 ?? p.median) })
  const padY = (hi - lo) * 0.18 || 1
  lo -= padY; hi += padY
  if (fmt === 'pct') lo = Math.max(0, lo)
  const x = s => pad + (SEASONS_ALL.indexOf(s) / (SEASONS_ALL.length - 1)) * (VBW - 2 * pad)
  const y = v => VBH - pad - (v - lo) / (hi - lo) * (VBH - 2 * pad)
  const up = points.map(p => `${x(p.season).toFixed(1)},${y(p.p75 ?? p.median).toFixed(1)}`)
  const dn = [...points].reverse().map(p => `${x(p.season).toFixed(1)},${y(p.p25 ?? p.median).toFixed(1)}`)
  const band = points.length > 1 ? `M${up.join(' L')} L${dn.join(' L')} Z` : ''
  const line = `M${points.map(p => `${x(p.season).toFixed(1)},${y(p.median).toFixed(1)}`).join(' L')}`

  return (
    <div className="csl-ed">
      {label && <div className="csl-ed-label">{label}</div>}
      <div className="csl-ed-hero">
        <span className={compact ? 'csl-ed-val--sm' : 'csl-ed-val'}>{fmtVal(last.median, fmt)}</span>
        <span className={`csl-ed-delta csl-ed-delta--${dir}`}>
          {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'} {deltaLabel(delta, fmt)}
          <span className="csl-ed-since"> since {first.season}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${VBW} ${VBH}`} className="csl-ed-svg" xmlns="http://www.w3.org/2000/svg">
        {band && <path d={band} fill={color} fillOpacity={0.12} />}
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
        <circle cx={x(last.season)} cy={y(last.median)} r={4} fill={color} />
      </svg>
      <div className="csl-ed-axis">
        {SEASONS_ALL.map((s, i) => (
          <span key={s} style={{
            left: `${(pad + (i / (SEASONS_ALL.length - 1)) * (VBW - 2 * pad)) / VBW * 100}%`,
            transform: i === 0 ? 'translateX(0)' : i === SEASONS_ALL.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
          }}>{s}</span>
        ))}
      </div>
    </div>
  )
}

function StackedFlow({ dim, groups, get }) {
  const seasons = SEASONS_ALL.filter(s => groups.some(g => get(s, dim, g.k, 'count')))
  const [active, setActive] = useState(seasons[seasons.length - 1])
  if (!seasons.length) return <p className="csl-empty">No data for this selection.</p>
  const act = seasons.includes(active) ? active : seasons[seasons.length - 1]

  const totals = {}
  seasons.forEach(s => { totals[s] = groups.reduce((a, g) => a + (get(s, dim, g.k, 'count')?.median || 0), 0) })

  const readGroups = groups.map(g => {
    const c = get(act, dim, g.k, 'count')?.median || 0
    const tot = totals[act] || 1
    return { ...g, c, share: c / tot }
  })

  return (
    <div className="csl-sf">
      <div className="csl-sf-legend">
        {groups.map((g, i) => (
          <span className="csl-sf-lk" key={g.k}><i className="csl-cmp-dot" style={{ background: SF_COLORS[i] }} />{g.label}</span>
        ))}
      </div>
      <div className="csl-sf-read">
        <b>{act}</b>
        {readGroups.map((g, i) => (
          <span key={g.k}>
            <span className="csl-sf-read-sh" style={{ color: SF_COLORS[i] }}>{pct(g.share)}</span>
            <span className="csl-sf-read-c"> · {Math.round(g.c)}</span>
          </span>
        ))}
      </div>
      <div className="csl-sf-flow">
        {seasons.map(s => {
          const tot = totals[s] || 1
          return (
            <div
              key={s}
              className={`csl-sf-col${s === act ? ' csl-sf-col--on' : ''}`}
              onMouseEnter={() => setActive(s)}
              onClick={() => setActive(s)}
            >
              {groups.map((g, i) => {
                const c = get(s, dim, g.k, 'count')?.median || 0
                const h = 100 * c / tot
                return (
                  <div key={g.k} className="csl-sf-seg" style={{ height: `${h}%`, background: SF_COLORS[i] }} />
                )
              })}
            </div>
          )
        })}
      </div>
      <div className="csl-sf-axis">
        {seasons.map(s => <div key={s} className={s === act ? 'csl-sf-ax--on' : ''}>{s}</div>)}
      </div>
    </div>
  )
}

const HPOS = [
  { k: 'GK', label: 'Goalkeepers' }, { k: 'D', label: 'Defenders' },
  { k: 'F', label: 'Forwards' }, { k: 'M', label: 'Midfielders' },
]

export default function TrendLens({ trend, selection }) {
  const { division, gender, family } = selection
  if (trend.loading) return <div className="csl-tl-loading">Loading trend…</div>
  if (trend.error) return <p className="csl-empty">Couldn’t load trend data.</p>
  const get = trend.get

  const seg = `${divShort(division)} ${genderLabel(gender)} · 2021–2025`
  const head = (title, q) => (
    <div className="csl-tl-head">
      <div>
        <h3 className="csl-tl-title">{title}</h3>
        <p className="csl-tl-q">{q}</p>
      </div>
      <span className="csl-tl-seg">{seg}</span>
    </div>
  )

  if (family === 'size') {
    return (
      <div className="csl-tlwrap">
        {head('Height by position', 'Are rosters getting taller — and where?')}
        <div className="csl-ed-grid">
          {HPOS.map((p, i) => (
            <div className="csl-cmp-panel" key={p.k}>
              <EditorialArea points={seasonPoints(get, 'position', p.k, 'height_inches')} fmt="inches" color={SF_COLORS[i]} label={p.label} compact />
            </div>
          ))}
        </div>
        <p className="csl-note">Median height per position each season, with the p25–p75 band. Change measured from that position’s first tracked season.</p>
      </div>
    )
  }

  if (family === 'roster') {
    return (
      <div className="csl-tlwrap">
        {head('Roster size', 'Are rosters getting bigger?')}
        <EditorialArea points={seasonPoints(get, 'overall', 'ALL', 'roster_size')} fmt="whole" color="#2a78d6" />
        <p className="csl-note">Median roster per season, with the p25–p75 band. Conference-level ‘ALL’ (division-wide).</p>
      </div>
    )
  }

  if (family === 'position' || family === 'class') {
    const groups = family === 'position'
      ? [{ k: 'GK', label: 'Goalkeepers' }, { k: 'D', label: 'Defenders' }, { k: 'M', label: 'Midfielders' }, { k: 'F', label: 'Forwards' }]
      : [{ k: 'FR', label: 'Freshmen' }, { k: 'SO', label: 'Sophomores' }, { k: 'JR', label: 'Juniors' }, { k: 'SR', label: 'Seniors' }, { k: 'GR', label: 'Graduate' }]
    return (
      <div className="csl-tlwrap">
        {head(family === 'position' ? 'Position mix' : 'Class mix', 'How the mix shifts, season by season')}
        <StackedFlow dim={family} groups={groups} get={get} />
        <p className="csl-note">Typical program composition each season (median counts stacked). Tap a season for its share and player count per group.</p>
      </div>
    )
  }

  if (family === 'retention') {
    return (
      <div className="csl-tlwrap">
        {head('Retention', 'Is the squad turning over faster?')}
        <div className="csl-ed-grid">
          <div className="csl-cmp-panel">
            <EditorialArea points={seasonPoints(get, 'overall', 'ALL', 'return_rate')} fmt="pct" color="#1baf7a" label="Return rate" compact />
          </div>
          <div className="csl-cmp-panel">
            <EditorialArea points={seasonPoints(get, 'overall', 'ALL', 'newcomer_rate')} fmt="pct" color="#eda100" label="Newcomer rate" compact />
          </div>
        </div>
        <p className="csl-note">Median program rate each season, with the p25–p75 band. Retention needs a prior season, so it starts at 2022.</p>
      </div>
    )
  }

  return (
    <div className="csl-tlwrap">
      {head('Recruiting geography', 'Where players come from — and how it’s shifting')}
      <div className="csl-soon">
        <p className="csl-eyebrow">Geography · over time</p>
        <p>A footprint map across the seasons plus the domestic vs. international trend is the next pass — richer than a single number.</p>
      </div>
    </div>
  )
}
