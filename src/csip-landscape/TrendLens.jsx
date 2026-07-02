import { useState } from 'react'
import { pct, inchesToFtIn, whole, divShort, genderLabel, clampTip } from './data/landscapeFormat'

/**
 * TrendLens — Lens C. One segment (division × gender), one metric family, plotted
 * across 2021–2025 as the whole canvas. The family chips in the control bar drive
 * which metric shows. Single metrics draw a median line with a p25–p75 band;
 * composition and retention families draw one median line per bucket. Missing
 * seasons (retention has no 2021) render as a gap — the line simply starts later.
 */
const SEASONS = [2021, 2022, 2023, 2024, 2025]
const PALETTE = ['#0E7C6B', '#C6873B', '#3E6FB0', '#B0506B', '#6B9E4C']

function specFor(family) {
  switch (family) {
    case 'size':
      return {
        title: 'Height by position', kind: 'multi', viz: 'cards', dim: 'position', metric: 'height_inches', fmt: 'inches',
        yTitle: 'Median height', q: 'Are rosters getting taller — and where?',
        series: [{ bucket: 'GK', label: 'Goalkeepers' }, { bucket: 'D', label: 'Defenders' }, { bucket: 'M', label: 'Midfielders' }, { bucket: 'F', label: 'Forwards' }],
      }
    case 'roster':
      return { title: 'Roster size', kind: 'single', dim: 'overall', bucket: 'ALL', metric: 'roster_size', fmt: 'whole', yTitle: 'Median roster', q: 'Are rosters getting bigger?' }
    case 'geography':
      return { title: '% International', kind: 'single', dim: 'origin', bucket: 'international', metric: 'share', fmt: 'pct', yTitle: 'Median program share', q: 'Are rosters getting more international?' }
    case 'position':
      return {
        title: 'Position mix', kind: 'multi', dim: 'position', metric: 'share', fmt: 'pct', yTitle: 'Median program share', q: 'How is the position mix shifting?',
        series: [{ bucket: 'GK', label: 'Goalkeepers' }, { bucket: 'D', label: 'Defenders' }, { bucket: 'M', label: 'Midfielders' }, { bucket: 'F', label: 'Forwards' }],
      }
    case 'class':
      return {
        title: 'Class mix', kind: 'multi', dim: 'class', metric: 'share', fmt: 'pct', yTitle: 'Median program share', q: 'How is the class mix shifting?',
        series: [{ bucket: 'FR', label: 'Freshmen' }, { bucket: 'SO', label: 'Sophomores' }, { bucket: 'JR', label: 'Juniors' }, { bucket: 'SR', label: 'Seniors' }, { bucket: 'GR', label: 'Graduate' }],
      }
    case 'retention':
      return {
        title: 'Retention', kind: 'multi', dim: 'overall', fmt: 'pct', yTitle: 'Median rate', q: 'Is the squad turning over faster?',
        series: [{ bucket: 'ALL', metric: 'return_rate', label: 'Return rate' }, { bucket: 'ALL', metric: 'newcomer_rate', label: 'Newcomer rate' }],
      }
    default:
      return specFor('size')
  }
}

function fmtVal(v, fmt) {
  if (v == null) return '—'
  if (fmt === 'pct') return pct(v)
  if (fmt === 'inches') return inchesToFtIn(v)
  return whole(v)
}

/** Auto-zoomed mini line for a single series' median path. */
function Sparkline({ points, color }) {
  const W = 148, H = 44, pad = 7
  if (points.length < 2) return <svg viewBox={`0 0 ${W} ${H}`} className="csl-spark" />
  const vals = points.map(p => p.median)
  let lo = Math.min(...vals), hi = Math.max(...vals)
  if (lo === hi) { lo -= 0.5; hi += 0.5 }
  const ss = points.map(p => p.season)
  const xmin = Math.min(...ss), xmax = Math.max(...ss)
  const x = s => pad + (xmax === xmin ? 0 : (s - xmin) / (xmax - xmin)) * (W - 2 * pad)
  const y = v => pad + (1 - (v - lo) / (hi - lo)) * (H - 2 * pad)
  const d = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.season).toFixed(1)},${y(p.median).toFixed(1)}`).join(' ')
  const last = points[points.length - 1]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="csl-spark" xmlns="http://www.w3.org/2000/svg">
      <path d={d} className="csl-spark-line" style={{ stroke: color }} />
      <circle cx={x(last.season)} cy={y(last.median)} r={3.2} style={{ fill: color }} />
    </svg>
  )
}

function deltaFmt(d) {
  if (Math.abs(d) < 0.05) return 'no change'
  return `${d > 0 ? '+' : '−'}${Math.abs(d).toFixed(1)}″`
}

/** Small-multiple stat cards: one per series, big current value + Δ + sparkline. */
function StatCards({ seriesList, fmt }) {
  return (
    <div className="csl-tcards">
      {seriesList.map((se, i) => {
        const pts = se.points
        if (!pts.length) return <div className="csl-tcard" key={i} />
        const cur = pts[pts.length - 1], first = pts[0]
        const delta = cur.median - first.median
        const dir = Math.abs(delta) < 0.05 ? 'flat' : (delta > 0 ? 'up' : 'down')
        return (
          <div className="csl-tcard" key={i}>
            <span className="csl-tcard-lab" style={{ color: se.color }}>{se.label}</span>
            <div className="csl-tcard-val">{fmtVal(cur.median, fmt)}</div>
            <div className={`csl-tcard-delta csl-tcard-delta--${dir}`}>
              {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'} {deltaFmt(delta)}
              <span className="csl-tcard-since"> since {first.season}</span>
            </div>
            <Sparkline points={pts} color={se.color} />
          </div>
        )
      })}
    </div>
  )
}

export default function TrendLens({ trend, selection }) {
  const { division, gender, family } = selection
  const spec = specFor(family)
  const [tip, setTip] = useState(null)

  if (trend.loading) return <div className="csl-tl-loading">Loading trend…</div>
  if (trend.error) return <p className="csl-empty">Couldn’t load trend data.</p>

  const seriesList = (spec.kind === 'single'
    ? [{ label: spec.title, color: PALETTE[0], bucket: spec.bucket, metric: spec.metric }]
    : spec.series.map((se, i) => ({ label: se.label, color: PALETTE[i % PALETTE.length], bucket: se.bucket, metric: se.metric || spec.metric }))
  ).map(se => ({
    ...se,
    points: SEASONS.map(s => {
      const r = trend.get(s, spec.dim, se.bucket, se.metric)
      return r ? { season: s, ...r } : null
    }).filter(Boolean),
  }))

  const hasData = seriesList.some(se => se.points.length > 0)
  if (!hasData) return <p className="csl-empty">No trend data for this selection.</p>

  const head = (
    <div className="csl-tl-head">
      <div>
        <h3 className="csl-tl-title">{spec.title}</h3>
        <p className="csl-tl-q">{spec.q}</p>
      </div>
      <span className="csl-tl-seg">{divShort(division)} {genderLabel(gender)} · 2021–2025</span>
    </div>
  )

  if (spec.viz === 'cards') {
    return (
      <div className="csl-tlwrap">
        {head}
        <StatCards seriesList={seriesList} fmt={spec.fmt} />
        <p className="csl-note">
          Median height per position, each season. The number is 2025; the change is measured from that
          position’s first tracked season. Player-level; conference-level ‘ALL’ (division-wide).
        </p>
      </div>
    )
  }

  // y-domain from plotted values (band lows/highs for single)
  const vals = []
  seriesList.forEach(se => se.points.forEach(p => {
    vals.push(p.median)
    if (spec.kind === 'single') { if (p.p25 != null) vals.push(p.p25); if (p.p75 != null) vals.push(p.p75) }
  }))
  let lo = Math.min(...vals), hi = Math.max(...vals)
  const pad = (hi - lo) * 0.14 || Math.abs(hi) * 0.1 || 1
  lo -= pad; hi += pad
  if (spec.fmt === 'pct') lo = Math.max(0, lo)
  if (lo === hi) hi = lo + 1

  // geometry (viewBox units)
  const W = 720, H = 360, ml = 58, mr = 18, mt = 18, mb = 44
  const pw = W - ml - mr, ph = H - mt - mb
  const xFor = s => ml + (SEASONS.indexOf(s) / (SEASONS.length - 1)) * pw
  const yFor = v => mt + (1 - (v - lo) / (hi - lo)) * ph

  const ticks = Array.from({ length: 5 }, (_, i) => lo + (i / 4) * (hi - lo))
  const linePath = pts => pts.map((p, i) => `${i ? 'L' : 'M'}${xFor(p.season).toFixed(1)},${yFor(p.median).toFixed(1)}`).join(' ')
  const bandPath = pts => {
    if (pts.length < 2) return ''
    const up = pts.map(p => `${xFor(p.season).toFixed(1)},${yFor(p.p75 ?? p.median).toFixed(1)}`)
    const dn = [...pts].reverse().map(p => `${xFor(p.season).toFixed(1)},${yFor(p.p25 ?? p.median).toFixed(1)}`)
    return `M${up.join(' L')} L${dn.join(' L')} Z`
  }

  const single = spec.kind === 'single'
  const s0 = seriesList[0]

  return (
    <div className="csl-tlwrap">
      {head}

      <div className="csl-tl-chart">
        <svg viewBox={`0 0 ${W} ${H}`} xmlns="http://www.w3.org/2000/svg" role="img" aria-label={`${spec.title} trend`}>
          {/* gridlines + y labels */}
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={ml} y1={yFor(t)} x2={W - mr} y2={yFor(t)} className="csl-tl-grid" />
              <text x={ml - 8} y={yFor(t) + 3.5} className="csl-tl-ylab" textAnchor="end">{fmtVal(t, spec.fmt)}</text>
            </g>
          ))}
          {/* x labels */}
          {SEASONS.map(s => (
            <text key={s} x={xFor(s)} y={H - mb + 20} className="csl-tl-xlab" textAnchor="middle">{s}</text>
          ))}

          {/* single: band */}
          {single && s0.points.length > 1 && <path d={bandPath(s0.points)} className="csl-tl-band" style={{ fill: s0.color }} />}

          {/* lines */}
          {seriesList.map((se, si) => (
            <path key={si} d={linePath(se.points)} className="csl-tl-line" style={{ stroke: se.color }} />
          ))}

          {/* dots + hover targets */}
          {seriesList.map((se, si) => se.points.map(p => (
            <g key={`${si}-${p.season}`}>
              <circle cx={xFor(p.season)} cy={yFor(p.median)} r={3.4} className="csl-tl-dot" style={{ fill: se.color }} />
              <circle
                cx={xFor(p.season)} cy={yFor(p.median)} r={12} fill="transparent"
                onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, label: se.label, color: se.color, p })}
                onMouseLeave={() => setTip(null)}
              />
            </g>
          )))}

          {/* single: value labels above dots */}
          {single && s0.points.map(p => (
            <text key={`v-${p.season}`} x={xFor(p.season)} y={yFor(p.median) - 9} className="csl-tl-vlab" textAnchor="middle">
              {fmtVal(p.median, spec.fmt)}
            </text>
          ))}
        </svg>
      </div>

      {/* legend (multi) with latest value */}
      {!single && (
        <div className="csl-tl-legend">
          {seriesList.map((se, si) => {
            const last = se.points[se.points.length - 1]
            return (
              <span className="csl-tl-lk" key={si}>
                <i className="csl-tl-sw" style={{ background: se.color }} />
                {se.label}
                {last && <b className="csl-tl-lkv"> · {fmtVal(last.median, spec.fmt)} ({last.season})</b>}
              </span>
            )
          })}
        </div>
      )}

      <p className="csl-note">
        {single ? 'Median line with the p25–p75 middle-half band. ' : 'One median line per group. '}
        Median program per season; conference-level ‘ALL’ (division-wide). Hover a point for detail.
        {family === 'retention' && ' Retention needs a prior season, so it starts at 2022.'}
      </p>

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y, 210, 52)
        return (
          <div className="csl-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b style={{ color: tip.color }}>{tip.label}</b> · {tip.p.season}<br />
            {fmtVal(tip.p.median, spec.fmt)}
            {spec.kind === 'single' && tip.p.p25 != null && tip.p.p75 != null
              ? ` · ${fmtVal(tip.p.p25, spec.fmt)}–${fmtVal(tip.p.p75, spec.fmt)}` : ''}
            {tip.p.n != null ? ` · n=${tip.p.n.toLocaleString()}` : ''}
          </div>
        )
      })()}
    </div>
  )
}
