import { useState } from 'react'
import {
  DIVISIONS, GENDERS, SEASONS, pct, inchesToFtIn, whole, divShort, genderLabel, seasonLabel,
} from './data/landscapeFormat'
import { useLandscapeBins } from './data/useLandscapeBins'

/**
 * CompareLens — Lens B. Assemble 2–4 arbitrary segments (division × gender ×
 * season) and line them up. Height is a distribution card (real per-position
 * histograms from program_benchmark_bins, hover a segment to isolate it); the
 * other families are grouped bars. One color per segment; medians with n.
 */
export const CMP_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#e34948']

const HPOS = [
  { k: 'GK', label: 'Goalkeepers' }, { k: 'D', label: 'Defenders' },
  { k: 'F', label: 'Forwards' }, { k: 'M', label: 'Midfielders' },
]

const PANELS = [
  {
    key: 'roster', title: 'Roster size', hint: 'Median roster', fmt: 'whole', type: 'bars',
    groups: [{ key: 'roster', label: 'Roster', dim: 'overall', bucket: 'ALL', metric: 'roster_size' }],
  },
  {
    key: 'position', title: 'Position mix', hint: 'Median program share', fmt: 'pct', type: 'bars',
    groups: [
      { key: 'GK', label: 'GK', dim: 'position', bucket: 'GK', metric: 'share' },
      { key: 'D', label: 'DEF', dim: 'position', bucket: 'D', metric: 'share' },
      { key: 'M', label: 'MID', dim: 'position', bucket: 'M', metric: 'share' },
      { key: 'F', label: 'FWD', dim: 'position', bucket: 'F', metric: 'share' },
    ],
  },
  {
    key: 'class', title: 'Class mix', hint: 'Median program share', fmt: 'pct', type: 'bars',
    groups: [
      { key: 'FR', label: 'FR', dim: 'class', bucket: 'FR', metric: 'share' },
      { key: 'SO', label: 'SO', dim: 'class', bucket: 'SO', metric: 'share' },
      { key: 'JR', label: 'JR', dim: 'class', bucket: 'JR', metric: 'share' },
      { key: 'SR', label: 'SR', dim: 'class', bucket: 'SR', metric: 'share' },
      { key: 'GR', label: 'GR', dim: 'class', bucket: 'GR', metric: 'share' },
    ],
  },
  {
    key: 'retention', title: 'Retention', hint: 'Median rate', fmt: 'pct', type: 'bars',
    groups: [
      { key: 'ret', label: 'Return', dim: 'overall', bucket: 'ALL', metric: 'return_rate' },
      { key: 'new', label: 'Newcomer', dim: 'overall', bucket: 'ALL', metric: 'newcomer_rate' },
    ],
  },
  {
    key: 'intl', title: '% International', hint: 'Median program share', fmt: 'pct', type: 'bars',
    groups: [{ key: 'intl', label: 'International', dim: 'origin', bucket: 'international', metric: 'share' }],
  },
]

function fmtVal(v, fmt) {
  if (v == null) return '—'
  if (fmt === 'pct') return pct(v)
  if (fmt === 'inches') return inchesToFtIn(v)
  return whole(v)
}
const segLabel = sg => `${divShort(sg.division)} ${genderLabel(sg.gender)} · ${seasonLabel(sg.season)}`

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

function HeightDensity({ segments, bins, hovered }) {
  if (bins.loading) return <div className="csl-tl-loading">Loading distributions…</div>
  if (bins.error) return <p className="csl-empty">Couldn’t load height distributions.</p>

  let lo = Infinity, hi = -Infinity
  segments.forEach((s, i) => HPOS.forEach(p => bins.get(i, p.k).forEach(b => {
    if (b.count > 0) { if (b.lo < lo) lo = b.lo; if (b.hi > hi) hi = b.hi }
  })))
  if (!isFinite(lo)) return <p className="csl-empty">No height distribution for these segments.</p>

  const W = 300, H = 134, padL = 8, padR = 8, base = H - 24, top = 12
  const x = v => padL + (v - lo) / (hi - lo) * (W - padL - padR)
  const nTick = 4
  const ticks = Array.from({ length: nTick }, (_, i) => Math.round(lo + (i / (nTick - 1)) * (hi - lo)))

  return (
    <div className="csl-dens-grid">
      {HPOS.map(p => (
        <div className="csl-cmp-panel" key={p.k}>
          <div className="csl-cmp-panel-h">
            <h3 className="csl-cmp-panel-title">{p.label}</h3>
            <span className="csl-dens-read">
              {segments.map((s, i) => {
                const m = medianFromBins(bins.get(i, p.k))
                return m == null ? null : (
                  <b key={i} style={{ color: CMP_COLORS[i], opacity: hovered != null && hovered !== i ? 0.3 : 1 }}>
                    {inchesToFtIn(m)}
                  </b>
                )
              })}
            </span>
          </div>
          <svg viewBox={`0 0 ${W} ${H}`} className="csl-cmp-svg" xmlns="http://www.w3.org/2000/svg">
            {ticks.map((t, ti) => (
              <line key={ti} x1={x(t)} y1={top} x2={x(t)} y2={base} className="csl-cmp-grid" />
            ))}
            <line x1={padL} y1={base} x2={W - padR} y2={base} className="csl-cmp-track" />
            {segments.map((s, i) => {
              const bs = bins.get(i, p.k)
              if (!bs.length) return null
              const peak = Math.max(...bs.map(b => b.count)) || 1
              const tops = bs.map(b => [x((b.lo + b.hi) / 2), base - (b.count / peak) * (base - top)])
              const first = tops[0][0], last = tops[tops.length - 1][0]
              const area = `${smoothPath(tops)} L${last.toFixed(1)},${base} L${first.toFixed(1)},${base} Z`
              const med = medianFromBins(bs)
              const dim = hovered != null && hovered !== i
              return (
                <g key={i} style={{ opacity: dim ? 0.1 : 1, transition: 'opacity .18s' }}>
                  <path d={area} fill={CMP_COLORS[i]} fillOpacity={0.13} />
                  <path d={smoothPath(tops)} fill="none" stroke={CMP_COLORS[i]} strokeWidth={2} strokeLinejoin="round" />
                  {med != null && (
                    <line x1={x(med)} y1={top} x2={x(med)} y2={base} stroke={CMP_COLORS[i]} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.75} />
                  )}
                </g>
              )
            })}
            {ticks.map((t, ti) => (
              <text key={ti} x={x(t)} y={H - 7} className="csl-cmp-axlab" textAnchor="middle">{inchesToFtIn(t)}</text>
            ))}
          </svg>
        </div>
      ))}
    </div>
  )
}

function GroupedBars({ groups, segments, get, fmt }) {
  const W = 720, mt = 26, mb = 34, ml = 8, mr = 8
  const data = groups.map(g => ({
    g, vals: segments.map((s, i) => ({ i, v: get(i, g.dim, g.bucket, g.metric)?.median ?? null })),
  }))
  const all = data.flatMap(d => d.vals.map(v => v.v).filter(v => v != null))
  if (!all.length) return <p className="csl-empty">No data for these segments.</p>
  const maxV = Math.max(...all) * 1.18
  const nSeg = segments.length
  const H = 210, ph = H - mt - mb, plotW = W - ml - mr
  const groupW = plotW / groups.length
  const barW = Math.min(44, (groupW - 22) / nSeg)
  const y = v => mt + ph * (1 - v / maxV)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="csl-cmp-svg" xmlns="http://www.w3.org/2000/svg">
      {data.map((d, gi) => {
        const gx = ml + gi * groupW + groupW / 2
        const startX = gx - (nSeg * barW) / 2
        return (
          <g key={gi}>
            {d.vals.map((xv, si) => {
              if (xv.v == null) return null
              const bx = startX + si * barW, by = y(xv.v)
              return (
                <g key={si}>
                  <rect x={bx} y={by} width={barW - 2} height={mt + ph - by} rx={3} fill={CMP_COLORS[xv.i]} />
                  <text x={bx + (barW - 2) / 2} y={by - 5} className="csl-cmp-vlab" textAnchor="middle">{fmtVal(xv.v, fmt)}</text>
                </g>
              )
            })}
            <text x={gx} y={H - mb + 20} className="csl-cmp-glab" textAnchor="middle">{d.g.label}</text>
          </g>
        )
      })}
    </svg>
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
                style={{ opacity: hovered != null && hovered !== i ? 0.4 : 1 }}
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
              <span className="csl-cmp-panel-hint">Distribution · dashed line = median · hover a segment to isolate</span>
            </div>
            <HeightDensity segments={segments} bins={bins} hovered={hovered} />
          </section>

          <div className="csl-cmp-panels">
            {PANELS.map(p => (
              <section className="csl-cmp-panel" id={`csl-sec-${p.key}`} key={p.key}>
                <div className="csl-cmp-panel-h">
                  <h3 className="csl-cmp-panel-title">{p.title}</h3>
                  <span className="csl-cmp-panel-hint">{p.hint}</span>
                </div>
                <GroupedBars groups={p.groups} segments={segments} get={compare.get} fmt={p.fmt} />
              </section>
            ))}
          </div>

          <p className="csl-note">
            Height is the real per-position distribution (share of players at each height, peak-normalized) from the
            benchmark histograms; other families are median program per segment. Conference-level ‘ALL’ (division-wide).
            A missing bar means that metric isn’t available for the segment (e.g. retention has no 2021, none for JC).
          </p>
        </>
      )}
    </div>
  )
}
