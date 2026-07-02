import {
  DIVISIONS, GENDERS, SEASONS, pct, inchesToFtIn, whole, divShort, genderLabel, seasonLabel,
} from './data/landscapeFormat'

/**
 * CompareLens — Lens B. Assemble 2–4 arbitrary segments (division × gender ×
 * season) and line them up: share/count families as grouped bars, height by
 * position as a dot plot (a zero-baseline bar would flatten the inch-level
 * differences). One color per segment, shared legend, medians with n on hover.
 */
export const CMP_COLORS = ['#0E7C6B', '#C6873B', '#3E6FB0', '#B0506B']

const PANELS = [
  {
    key: 'roster', title: 'Roster size', hint: 'Median roster', fmt: 'whole', type: 'bars',
    groups: [{ key: 'roster', label: 'Roster', dim: 'overall', bucket: 'ALL', metric: 'roster_size' }],
  },
  {
    key: 'height', title: 'Height by position', hint: 'Median height', fmt: 'inches', type: 'dots',
    groups: [
      { key: 'GK', label: 'Goalkeepers', dim: 'position', bucket: 'GK', metric: 'height_inches' },
      { key: 'D', label: 'Defenders', dim: 'position', bucket: 'D', metric: 'height_inches' },
      { key: 'M', label: 'Midfielders', dim: 'position', bucket: 'M', metric: 'height_inches' },
      { key: 'F', label: 'Forwards', dim: 'position', bucket: 'F', metric: 'height_inches' },
    ],
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

function GroupedBars({ groups, segments, get, fmt }) {
  const W = 720, mt = 26, mb = 34, ml = 8, mr = 8
  const data = groups.map(g => ({
    g, vals: segments.map((s, i) => ({ i, v: get(i, g.dim, g.bucket, g.metric)?.median ?? null })),
  }))
  const all = data.flatMap(d => d.vals.map(x => x.v).filter(v => v != null))
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
            {d.vals.map((x, si) => {
              if (x.v == null) return null
              const bx = startX + si * barW, by = y(x.v)
              return (
                <g key={si}>
                  <rect x={bx} y={by} width={barW - 2} height={mt + ph - by} rx={3} fill={CMP_COLORS[x.i]} />
                  <text x={bx + (barW - 2) / 2} y={by - 5} className="csl-cmp-vlab" textAnchor="middle">{fmtVal(x.v, fmt)}</text>
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

function DotRows({ groups, segments, get, fmt }) {
  const W = 720, ml = 96, mr = 20, mt = 8, rowH = 38, axisH = 22
  const data = groups.map(g => ({
    g, vals: segments.map((s, i) => ({ i, v: get(i, g.dim, g.bucket, g.metric)?.median ?? null })),
  }))
  const all = data.flatMap(d => d.vals.map(x => x.v).filter(v => v != null))
  if (!all.length) return <p className="csl-empty">No data for these segments.</p>
  let lo = Math.min(...all), hi = Math.max(...all)
  const pad = (hi - lo) * 0.25 || 1
  lo -= pad; hi += pad
  const H = mt + data.length * rowH + axisH
  const plotW = W - ml - mr
  const x = v => ml + plotW * (v - lo) / (hi - lo)
  const ticks = [lo, (lo + hi) / 2, hi]
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="csl-cmp-svg" xmlns="http://www.w3.org/2000/svg">
      {data.map((d, gi) => {
        const cy = mt + gi * rowH + rowH / 2
        return (
          <g key={gi}>
            <text x={ml - 12} y={cy + 4} className="csl-cmp-glab" textAnchor="end">{d.g.label}</text>
            <line x1={ml} y1={cy} x2={ml + plotW} y2={cy} className="csl-cmp-track" />
            {d.vals.map((xv, si) => xv.v == null ? null : (
              <g key={si}>
                <circle cx={x(xv.v)} cy={cy} r={6.5} fill={CMP_COLORS[xv.i]} stroke="#fff" strokeWidth={1.6}>
                  <title>{`${segLabel(segments[xv.i])}: ${fmtVal(xv.v, fmt)}`}</title>
                </circle>
              </g>
            ))}
          </g>
        )
      })}
      {ticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 6} className="csl-cmp-axlab" textAnchor="middle">{fmtVal(t, fmt)}</text>
      ))}
    </svg>
  )
}

export default function CompareLens({ compare, segments, setSegments }) {
  const addSegment = () => {
    if (segments.length >= 4) return
    const last = segments[segments.length - 1]
    setSegments([...segments, { ...last }])
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
              <span className="csl-cmp-lk" key={i}>
                <i className="csl-cmp-dot" style={{ background: CMP_COLORS[i] }} />
                {segLabel(sg)}
              </span>
            ))}
          </div>

          <div className="csl-cmp-panels">
            {PANELS.map(p => (
              <section className="csl-cmp-panel" id={`csl-sec-${p.key}`} key={p.key}>
                <div className="csl-cmp-panel-h">
                  <h3 className="csl-cmp-panel-title">{p.title}</h3>
                  <span className="csl-cmp-panel-hint">{p.hint}</span>
                </div>
                {p.type === 'dots'
                  ? <DotRows groups={p.groups} segments={segments} get={compare.get} fmt={p.fmt} />
                  : <GroupedBars groups={p.groups} segments={segments} get={compare.get} fmt={p.fmt} />}
              </section>
            ))}
          </div>

          <p className="csl-note">
            Median program per segment, conference-level ‘ALL’ (division-wide). Height is a dot plot on a zoomed
            scale (hover a dot for the value); other families are grouped bars. Missing bars mean that metric
            isn’t available for the segment (e.g. retention has no 2021, and none for JC).
          </p>
        </>
      )}
    </div>
  )
}
