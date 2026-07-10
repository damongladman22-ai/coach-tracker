import { useState } from 'react'
import { clampTip } from '../data/format'

/**
 * CompositionOverTime — how the program allocates roster spots across position
 * groups, season by season. Stacked bars (one per season) show the shape and how
 * it shifts; the legend carries each group's multi-year average, and a delta line
 * summarizes the change since the first tracked season. When a peer group is
 * selected, a "current mix vs peer" block plots the latest-season position
 * shares against the peer median + p25–p75 band.
 */
const GROUPS = [
  { k: 'F', label: 'Attack' },
  { k: 'M', label: 'Midfield' },
  { k: 'D', label: 'Defense' },
  { k: 'GK', label: 'Goalkeeper' },
]
const THIN_N = 25

function sign(n) { return n > 0 ? `+${n}` : `${n}` }
function pct0(x) { return Math.round(x * 100) }
function signPts(n) { return n > 0 ? `+${n}` : n < 0 ? `\u2212${Math.abs(n)}` : '\u00B10' }

export default function CompositionOverTime({ data, benchmark }) {
  const [tip, setTip] = useState(null)
  const rows = data?.rows || []
  const maxTotal = Math.max(1, ...rows.map(r => r.total))
  const firstSeason = data?.seasons?.[0]
  const movers = GROUPS.filter(g => (data?.delta?.[g.k] || 0) !== 0)

  // current-mix-vs-peer
  const last = rows.length ? rows[rows.length - 1] : null
  const scopeLabel = benchmark ? `${benchmark.label} ${benchmark.genderWord}`.trim() : ''
  const mix = (benchmark && last && last.total) ? GROUPS.map(g => {
    const share = last.byPos[g.k] / last.total
    const b = benchmark.cell('share', 'position', g.k)
    return { g, share, b }
  }) : null
  let axisMax = 0.01, anyThin = false
  if (mix) for (const m of mix) {
    axisMax = Math.max(axisMax, m.share, m.b ? m.b.p75 : 0)
    if (m.b && m.b.n < THIN_N) anyThin = true
  }
  axisMax = Math.min(1, axisMax + 0.05)
  const cpos = v => `${(100 * v / axisMax).toFixed(1)}%`
  const cwid = (a, b) => `${(100 * (b - a) / axisMax).toFixed(1)}%`

  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <h2 className="cp-h2">Roster composition over time</h2>
        <span className="cp-hint">How the program allocates spots across positions, season by season</span>
      </div>

      <div className="cp-panel">
        <div className="cp-comp-legend">
          {GROUPS.map(g => (
            <span className="cp-lk-item" key={g.k}>
              <i className={'cp-swatch cp-seg--' + g.k} />
              {g.label}
              <b className="cp-num"> · avg {Math.round((data?.avg?.[g.k] || 0) * 10) / 10}</b>
            </span>
          ))}
        </div>

        <div className="cp-comp">
          {rows.map(r => (
            <div className="cp-comp-row" key={r.season}>
              <span className="cp-comp-yr">{r.season}</span>
              <div className="cp-comp-bar" style={{ width: `${Math.max(18, 100 * r.total / maxTotal)}%` }}>
                {GROUPS.map(g => {
                  const c = r.byPos[g.k]
                  if (!c) return null
                  const share = r.total ? Math.round(100 * c / r.total) : 0
                  return (
                    <span
                      key={g.k}
                      className={'cp-comp-seg cp-seg--' + g.k}
                      style={{ flexGrow: c }}
                      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, label: g.label, c, share })}
                      onMouseLeave={() => setTip(null)}
                    >
                      {c}
                    </span>
                  )
                })}
              </div>
              <span className="cp-comp-tot cp-num">{r.total}</span>
            </div>
          ))}
        </div>

        {movers.length > 0 && firstSeason != null && (
          <p className="cp-comp-note">
            Since {firstSeason}:{' '}
            {movers.map((g, i) => (
              <span key={g.k}>
                <b className={data.delta[g.k] > 0 ? 'cp-up' : 'cp-down'}>{g.label} {sign(data.delta[g.k])}</b>
                {i < movers.length - 1 ? ', ' : ''}
              </span>
            ))}
            {'.'}
          </p>
        )}

        {mix && (
          <div className="cp-cmpbench">
            <p className="cp-eyebrow" style={{ margin: '4px 0 10px' }}>{last.season} mix vs {scopeLabel}</p>
            {mix.map(({ g, share, b }) => {
              const delta = b ? Math.round((share - b.median) * 100) : null
              const thin = !!b && b.n < THIN_N
              return (
                <div className="cp-cb-row" key={g.k}>
                  <span className="cp-cb-lab"><i className={'cp-swatch cp-seg--' + g.k} /> {g.label}</span>
                  <div className="cp-cb-track">
                    {b && (
                      <>
                        <span className="cp-size-bench-band" style={{ left: cpos(b.p25), width: cwid(b.p25, b.p75) }}
                          title={`${scopeLabel}: middle 50% ${pct0(b.p25)}–${pct0(b.p75)}%`} />
                        <span className="cp-size-bench-tick" style={{ left: cpos(b.median) }}
                          title={`${scopeLabel} median ${pct0(b.median)}% (n ${b.n.toLocaleString()})`} />
                      </>
                    )}
                    <span className="cp-cb-dot" style={{ left: cpos(share) }} />
                  </div>
                  <span className="cp-cb-read">
                    <b className="cp-num">{pct0(share)}%</b>
                    {b && <span className={`cp-cb-sub${thin ? ' cp-cb-sub--thin' : ''}`}>{benchmark.label} {pct0(b.median)}% <span className="cp-cb-delta">{signPts(delta)}</span></span>}
                  </span>
                </div>
              )
            })}
            {anyThin && <p className="cp-size-flag" style={{ marginTop: 8 }}>Small peer samples (n &lt; {THIN_N}) — bands are approximate.</p>}
          </div>
        )}
      </div>

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y)
        return (
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b>{tip.label}</b> · {tip.c} ({tip.share}%)
          </div>
        )
      })()}
    </section>
  )
}
