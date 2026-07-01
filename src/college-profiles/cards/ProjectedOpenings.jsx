import { useState, useRef, useLayoutEffect } from 'react'
import { clampTip } from '../data/format'

/**
 * ProjectedOpenings — interactive horizon of deterministic openings by graduation
 * year (next four seasons), stacked by position group. Click a year for the name
 * breakdown; use the legend to isolate a position group; hover a segment for a tip.
 *
 * Clicking a year expands a breakdown (changes height), so we pin the clicked
 * control before the state change to keep the viewport steady (no page jump).
 */
const POS = ['GK', 'D', 'M', 'F']
const POSFULL = { GK: 'Goalkeeper', D: 'Defense', M: 'Midfield', F: 'Attack' }

export default function ProjectedOpenings({ buckets }) {
  const [selYear, setSelYear] = useState(null)
  const [isoPos, setIsoPos] = useState(null)
  const [tip, setTip] = useState(null)

  const pinRef = useRef(null)
  useLayoutEffect(() => {
    const p = pinRef.current
    if (p && p.el) {
      const delta = p.el.getBoundingClientRect().top - p.top
      if (delta) window.scrollBy(0, delta)
    }
    pinRef.current = null
  })
  const pin = e => { pinRef.current = { el: e.currentTarget, top: e.currentTarget.getBoundingClientRect().top } }

  const maxTot = Math.max(1, ...buckets.map(b => b.total))
  const selected = buckets.find(b => b.year === selYear) || null

  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Projected openings by year</h3>
      <p className="cp-panel-desc">
        Players reaching their graduation year — where roster spots are likely to open.
        Click a year for the breakdown, or a position group to trace it across years.
      </p>

      <div className={'cp-horizon' + (isoPos ? ' cp-horizon--iso' : '')}>
        {buckets.map(b => {
          const h = Math.round(100 * b.total / maxTot)
          return (
            <button
              key={b.year}
              type="button"
              className={'cp-hz' + (b.isNext ? ' cp-hz--next' : '') + (b.year === selYear ? ' cp-hz--sel' : '')}
              aria-label={`${b.year}: ${b.total} projected openings — show breakdown`}
              onClick={e => { pin(e); setSelYear(y => (y === b.year ? null : b.year)) }}
            >
              <span className="cp-hz-tot cp-num">{b.total}</span>
              <span className="cp-hz-bar" style={{ height: `${h}%` }}>
                {POS.map(k => {
                  const c = b.byPos[k]
                  if (!c) return null
                  const on = !isoPos || isoPos === k
                  return (
                    <span
                      key={k}
                      className={'cp-seg cp-seg--' + k + (on ? ' cp-seg--on' : '')}
                      style={{ height: `${100 * c / b.total}%` }}
                      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, k, c, y2: b.year })}
                      onMouseLeave={() => setTip(null)}
                    />
                  )
                })}
              </span>
              <span className="cp-hz-yr">{b.year}</span>
              {b.isNext && <span className="cp-hz-next">next</span>}
            </button>
          )
        })}
      </div>

      <div className="cp-hz-key">
        {POS.map(k => (
          <button
            key={k}
            type="button"
            className="cp-hzk"
            aria-pressed={isoPos === k}
            onClick={e => { pin(e); setIsoPos(p => (p === k ? null : k)) }}
          >
            <i className={'cp-seg--' + k} />{POSFULL[k]}
          </button>
        ))}
      </div>

      {selected && (
        <div className="cp-hz-detail">
          <h4>Class of <b>{selected.year}</b> — {selected.total} projected {selected.total === 1 ? 'opening' : 'openings'}</h4>
          {POS.filter(k => selected.byPos[k]).map(k => {
            const arr = selected.players.filter(p => p.position === k)
            return (
              <div className="cp-hz-grp" key={k}>
                <div className="cp-hz-gh">{POSFULL[k]} · {arr.length}</div>
                <div className="cp-hz-names">
                  {arr.map(p => (
                    <span className="cp-nmchip" key={p.id}>{p.player_name} <span className="cp-muted">({p.class_year})</span></span>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y)
        return (
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, opacity: 1 }}>
            <b>{POSFULL[tip.k]}</b> · {tip.c} · {tip.y2}
          </div>
        )
      })()}
    </div>
  )
}
