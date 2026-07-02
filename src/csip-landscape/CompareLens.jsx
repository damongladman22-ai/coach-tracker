import { useState } from 'react'
import {
  DIVISIONS, GENDERS, SEASONS, pct, inchesToFtIn, whole, divShort, genderLabel, seasonLabel,
} from './data/landscapeFormat'
import { useLandscapeBins } from './data/useLandscapeBins'

/**
 * CompareLens — Lens B. Assemble 2–4 arbitrary segments (division × gender ×
 * season) and line them up. Height is a ridgeline of the real per-position
 * distributions (program_benchmark_bins); the other families are large-type
 * horizontal comparison bars. Colour = segment everywhere; hover to isolate.
 */
export const CMP_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#e34948']

const HPOS = [
  { k: 'GK', label: 'Goalkeepers' }, { k: 'D', label: 'Defenders' },
  { k: 'F', label: 'Forwards' }, { k: 'M', label: 'Midfielders' },
]

const VALUE_CARDS = [
  { key: 'roster', anchor: 'csl-sec-roster', title: 'Roster size', hint: 'median', fmt: 'whole', dim: 'overall', bucket: 'ALL', metric: 'roster_size' },
  { key: 'intl', anchor: 'csl-sec-intl', title: '% International', hint: 'median program share', fmt: 'pct', dim: 'origin', bucket: 'international', metric: 'share' },
]
const GROUP_CARDS = [
  {
    key: 'position', anchor: 'csl-sec-position', title: 'Position mix', hint: 'median program share', fmt: 'pct',
    groups: [
      { label: 'Goalkeepers', dim: 'position', bucket: 'GK', metric: 'share' },
      { label: 'Defenders', dim: 'position', bucket: 'D', metric: 'share' },
      { label: 'Midfielders', dim: 'position', bucket: 'M', metric: 'share' },
      { label: 'Forwards', dim: 'position', bucket: 'F', metric: 'share' },
    ],
  },
  {
    key: 'class', anchor: 'csl-sec-class', title: 'Class mix', hint: 'median program share', fmt: 'pct',
    groups: [
      { label: 'Freshmen', dim: 'class', bucket: 'FR', metric: 'share' },
      { label: 'Sophomores', dim: 'class', bucket: 'SO', metric: 'share' },
      { label: 'Juniors', dim: 'class', bucket: 'JR', metric: 'share' },
      { label: 'Seniors', dim: 'class', bucket: 'SR', metric: 'share' },
      { label: 'Graduate', dim: 'class', bucket: 'GR', metric: 'share' },
    ],
  },
  {
    key: 'retention', anchor: 'csl-sec-retention', title: 'Retention', hint: 'median rate', fmt: 'pct',
    groups: [
      { label: 'Return rate', dim: 'overall', bucket: 'ALL', metric: 'return_rate' },
      { label: 'Newcomer rate', dim: 'overall', bucket: 'ALL', metric: 'newcomer_rate' },
    ],
  },
]

function fmtVal(v, fmt) {
  if (v == null) return '—'
  if (fmt === 'pct') return pct(v)
  if (fmt === 'inches') return inchesToFtIn(v)
  return whole(v)
}
const segLabel = sg => `${divShort(sg.division)} ${genderLabel(sg.gender)} · ${seasonLabel(sg.season)}`
const dimOf = (hovered, i) => (hovered != null && hovered !== i ? 0.28 : 1)

function smoothPath(pts) {
  if (pts.length < 2) return pts.length ? `M${pts[0][0]},${pts[0][1]}` : ''
  let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || pts[i + 1]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`
  }
  return d
}
function medianFromBins(bins) {
  const total = bins.reduce((a, b) => a + b.count, 0)
  if (!total) return null
  let cum = 0
  const half = total / 2
  for (const b of bins) {
    if (cum + b.count >= half) return b.lo + ((half - cum) / b.count) * (b.hi - b.lo)
    cum += b.count
  }
  return bins[bins.length - 1].hi
}

function RidgeHeight({ segments, bins, hovered }) {
  if (bins.loading) return <div className="csl-tl-loading">Loading distributions…</div>
  if (bins.error) return <p className="csl-empty">Couldn’t load height distributions.</p>

  let lo = Infinity, hi = -Infinity
  segments.forEach((s, i) => HPOS.forEach(p => bins.get(i, p.k).forEach(b => {
    if (b.count > 0) { if (b.lo < lo) lo = b.lo; if (b.hi > hi) hi = b.hi }
  })))
  if (!isFinite(lo)) return <p className="csl-empty">No height distribution for these segments.</p>

  const W = 680, padL = 124, padR = 128, rowH = 96, rideH = 76, topPad = 12, axisH = 32
  const H = topPad + HPOS.length * rowH + axisH
  const x = v => padL + (v - lo) / (hi - lo) * (W - padL - padR)
  const ticks = Array.from({ length: 6 }, (_, i) => Math.round(lo + (i / 5) * (hi - lo)))

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="csl-ridge" xmlns="http://www.w3.org/2000/svg">
      {ticks.map((t, ti) => (
        <line key={ti} x1={x(t)} y1={topPad} x2={x(t)} y2={H - axisH} stroke="var(--line)" strokeWidth="0.5" />
      ))}
      {HPOS.map((p, ri) => {
        const baseY = topPad + ri * rowH + rideH
        const order = segments
          .map((s, i) => ({ i, med: medianFromBins(bins.get(i, p.k)) }))
          .filter(o => o.med != null)
          .sort((a, b) => b.med - a.med)
        return (
          <g key={p.k}>
            <text x={padL - 14} y={baseY - rideH * 0.42} textAnchor="end" className="csl-ridge-row">{p.label}</text>
            <line x1={padL} y1={baseY} x2={W - padR} y2={baseY} stroke="var(--line)" strokeWidth="1" />
            {order.map(o => {
              const bs = bins.get(o.i, p.k)
              const peak = Math.max(...bs.map(b => b.count)) || 1
              const tops = bs.map(b => [x((b.lo + b.hi) / 2), baseY - (b.count / peak) * rideH])
              const first = tops[0][0], last = tops[tops.length - 1][0]
              const area = `${smoothPath(tops)} L${last.toFixed(1)},${baseY} L${first.toFixed(1)},${baseY} Z`
              const mx = x(o.med), my = baseY - rideH
              return (
                <g key={o.i} style={{ opacity: dimOf(hovered, o.i), transition: 'opacity .18s' }}>
                  <path d={area} fill={CMP_COLORS[o.i]} fillOpacity={0.16} stroke={CMP_COLORS[o.i]} strokeWidth={2} strokeLinejoin="round" />
                  <line x1={mx} y1={baseY} x2={mx} y2={my + 4} stroke={CMP_COLORS[o.i]} strokeWidth={1.5} strokeDasharray="3 3" opacity={0.8} />
                  <circle cx={mx} cy={my + 4} r={3.5} fill={CMP_COLORS[o.i]} />
                </g>
              )
            })}
            <text x={W - padR + 10} y={baseY - rideH - 2} className="csl-ridge-read">
              {segments.map((s, i) => {
                const m = medianFromBins(bins.get(i, p.k))
                if (m == null) return null
                return (
                  <tspan key={i} fill={CMP_COLORS[i]} style={{ opacity: dimOf(hovered, i) }}>
                    {i > 0 ? '  ' : ''}{inchesToFtIn(m)}
                  </tspan>
                )
              })}
            </text>
          </g>
        )
      })}
      {ticks.map((t, ti) => (
        <text key={ti} x={x(t)} y={H - 9} textAnchor="middle" className="csl-ridge-ax">{inchesToFtIn(t)}</text>
      ))}
    </svg>
  )
}

function ValueCard({ card, segments, get, hovered }) {
  const vals = segments.map((s, i) => get(i, card.dim, card.bucket, card.metric)?.median ?? null)
  const max = Math.max(...vals.filter(v => v != null), 0.0001) * 1.15
  return (
    <section className="csl-cmp-panel" id={card.anchor}>
      <div className="csl-cmp-panel-h">
        <h3 className="csl-cmp-panel-title">{card.title}</h3>
        <span className="csl-cmp-panel-hint">{card.hint}</span>
      </div>
      <div className="csl-vbars">
        {segments.map((sg, i) => (
          <div className="csl-hbar-row" key={i} style={{ opacity: dimOf(hovered, i) }}>
            <span className="csl-hbar-key"><i className="csl-cmp-dot" style={{ background: CMP_COLORS[i] }} />{divShort(sg.division)}</span>
            <span className="csl-hbar-track">
              <span className="csl-hbar-fill" style={{ width: vals[i] == null ? 0 : `${100 * vals[i] / max}%`, background: CMP_COLORS[i] }} />
            </span>
            <span className="csl-hbar-val csl-hbar-val--big">{fmtVal(vals[i], card.fmt)}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function GroupCard({ card, segments, get, hovered }) {
  let max = 0
  card.groups.forEach(g => segments.forEach((s, i) => {
    const v = get(i, g.dim, g.bucket, g.metric)?.median
    if (v != null && v > max) max = v
  }))
  max = (max || 0.0001) * 1.12
  return (
    <section className="csl-cmp-panel" id={card.anchor}>
      <div className="csl-cmp-panel-h">
        <h3 className="csl-cmp-panel-title">{card.title}</h3>
        <span className="csl-cmp-panel-hint">{card.hint}</span>
      </div>
      <div className="csl-gcard">
        {card.groups.map(g => (
          <div className="csl-gcard-grp" key={g.label}>
            <div className="csl-gcard-glab">{g.label}</div>
            {segments.map((sg, i) => {
              const v = get(i, g.dim, g.bucket, g.metric)?.median ?? null
              return (
                <div className="csl-hbar-row" key={i} style={{ opacity: dimOf(hovered, i) }}>
                  <span className="csl-hbar-track">
                    <span className="csl-hbar-fill" style={{ width: v == null ? 0 : `${100 * v / max}%`, background: CMP_COLORS[i] }} />
                  </span>
                  <span className="csl-hbar-val" style={{ color: CMP_COLORS[i] }}>{fmtVal(v, card.fmt)}</span>
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </section>
  )
}

export default function CompareLens({ client, compare, segments, setSegments }) {
  const [hovered, setHovered] = useState(null)
  const bins = useLandscapeBins(client, segments, 'position', 'height_inches')

  const addSegment = () => {
    if (segments.length >= 4) return
    setSegments([...segments, { ...segments[segments.length - 1] }])
  }
  const removeSegment = i => setSegments(segments.filter((_, j) => j !== i))
  const patchSegment = (i, patch) => setSegments(segments.map((s, j) => j === i ? { ...s, ...patch } : s))

  return (
    <div className="csl-cmp">
      <div className="csl-cmp-builder">
        {segments.map((sg, i) => (
          <div className="csl-cmp-seg" key={i}>
            <i className="csl-cmp-dot" style={{ background: CMP_COLORS[i] }} />
            <select className="csl-cmp-sel" value={sg.division} onChange={e => patchSegment(i, { division: e.target.value })}>
              {DIVISIONS.map(d => <option key={d} value={d}>{divShort(d)}</option>)}
            </select>
            <select className="csl-cmp-sel" value={sg.gender} onChange={e => patchSegment(i, { gender: e.target.value })}>
              {GENDERS.map(g => <option key={g.key} value={g.key}>{g.label}</option>)}
            </select>
            <select className="csl-cmp-sel" value={sg.season} onChange={e => patchSegment(i, { season: Number(e.target.value) })}>
              {SEASONS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
            {segments.length > 1 && (
              <button type="button" className="csl-cmp-x" onClick={() => removeSegment(i)} aria-label="Remove segment">×</button>
            )}
          </div>
        ))}
        {segments.length < 4 && (
          <button type="button" className="csl-cmp-add" onClick={addSegment}>+ Add segment</button>
        )}
      </div>

      {compare.loading ? (
        <div className="csl-tl-loading">Loading comparison…</div>
      ) : compare.error ? (
        <p className="csl-empty">Couldn’t load comparison data.</p>
      ) : (
        <>
          <div className="csl-cmp-legend">
            {segments.map((sg, i) => (
              <span
                className="csl-cmp-lk" key={i}
                style={{ opacity: dimOf(hovered, i) }}
                onMouseEnter={() => setHovered(i)}
                onMouseLeave={() => setHovered(null)}
              >
                <i className="csl-cmp-dot" style={{ background: CMP_COLORS[i] }} />
                {segLabel(sg)}
              </span>
            ))}
          </div>

          <section className="csl-cmp-full" id="csl-sec-height">
            <div className="csl-cmp-panel-h">
              <h3 className="csl-cmp-panel-title">Height by position</h3>
              <span className="csl-cmp-panel-hint">Distribution · marker = median · hover a segment to isolate</span>
            </div>
            <RidgeHeight segments={segments} bins={bins} hovered={hovered} />
          </section>

          <div className="csl-cmp-panels">
            {VALUE_CARDS.map(c => <ValueCard key={c.key} card={c} segments={segments} get={compare.get} hovered={hovered} />)}
            {GROUP_CARDS.map(c => <GroupCard key={c.key} card={c} segments={segments} get={compare.get} hovered={hovered} />)}
          </div>

          <p className="csl-note">
            Height is the real per-position distribution (share of players at each height) from the benchmark
            histograms; other families are the median program per segment. Conference-level ‘ALL’ (division-wide).
            A blank bar means the metric isn’t available for that segment (e.g. retention has no 2021, none for JC).
          </p>
        </>
      )}
    </div>
  )
}
