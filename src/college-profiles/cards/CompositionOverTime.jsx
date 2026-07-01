import { useState } from 'react'
import { clampTip } from '../data/format'

/**
 * CompositionOverTime — how the program allocates roster spots across position
 * groups, season by season. Stacked bars (one per season) show the shape and how
 * it shifts; the legend carries each group's multi-year average, and a delta line
 * summarizes the change since the first tracked season.
 */
const GROUPS = [
  { k: 'F', label: 'Attack' },
  { k: 'M', label: 'Midfield' },
  { k: 'D', label: 'Defense' },
  { k: 'GK', label: 'Goalkeeper' },
]

function sign(n) { return n > 0 ? `+${n}` : `${n}` }

export default function CompositionOverTime({ data }) {
  const [tip, setTip] = useState(null)
  const rows = data?.rows || []
  const maxTotal = Math.max(1, ...rows.map(r => r.total))
  const firstSeason = data?.seasons?.[0]
  const movers = GROUPS.filter(g => (data?.delta?.[g.k] || 0) !== 0)

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
