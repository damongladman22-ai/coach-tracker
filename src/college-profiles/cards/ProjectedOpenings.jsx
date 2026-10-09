import { useState, useRef, useLayoutEffect } from 'react'
import { clampTip } from '../data/format'

/**
 * ProjectedOpenings — interactive horizon of deterministic openings by graduation
 * year (next four seasons), stacked by position group. Click a year for the name
 * breakdown; use the legend to isolate a position group; hover a segment for a tip.
 *
 * Clicking a year expands a breakdown (changes height), so we pin the clicked
 * control before the state change to keep the viewport steady (no page jump).
 *
 * NEXT-SEASON ESTIMATE (item 1 of the transfer-display plan, 2026-09-29).
 * Under the bars, one estimate for next season only: graduating players (the
 * "next" bar) plus expected early leavers gives the expected new spots; the
 * program's own experienced share of newcomers says how many of those usually
 * go to freshmen. It is labelled as an estimate and kept off the bars, which
 * stay facts. See nextSeasonOpeningsEstimate() in data/metrics.js.
 *
 * Since backlog G8 (2026-10-09) the early-leaver rate is the program's
 * departure outlook (program_departure_outlook): its own history steadied
 * toward similar programs and adjusted for roster mix and win record, the
 * same rate Find programs uses. The note says which basis was used.
 */
const POS = ['GK', 'D', 'M', 'F']
const POSFULL = { GK: 'Goalkeeper', D: 'Defense', M: 'Midfield', F: 'Attack' }

function pct0(x) { return x == null ? '—' : Math.round(x * 100) }

/** The sentence about early leavers, by where the rate came from. */
function RateNote({ est, who }) {
  const p = <b>{pct0(est.earlyRate)}%</b>
  if (est.rateSource === 'program') {
    const n = est.transitions
    const span = n ? ` (${n} ${n === 1 ? 'year' : 'years'})` : ''
    return <>Expected from its own roster history{span}, weighed against similar programs and adjusted for its roster mix
      and win record: about {p} of its {who} leave before the next season</>
  }
  if (est.rateSource === 'division') {
    return <>Too few seasons are tracked for its own history, so this uses similar programs, adjusted for its roster mix
      and win record: about {p} of its {who} leave before the next season</>
  }
  return <>From this program’s own history: about {p} of its {who} leave before the next season</>
}

function Estimate({ est, isJC }) {
  const g = est.graduating
  const e = Math.round(est.earlyLeavers)
  const total = Math.round(est.spots)
  const fr = est.freshmen == null ? null : Math.round(est.freshmen)
  const who = isJC ? 'first-year players' : 'non-seniors'
  return (
    <div className="cp-est">
      <p className="cp-eyebrow" style={{ marginBottom: 10 }}>Next season ({est.season}), estimated</p>
      <div className="cp-est-row" role="img"
        aria-label={`${g} graduating plus about ${e} early leavers makes about ${total} new spots${fr != null ? `, about ${fr} of them for freshmen` : ''}`}>
        <div className="cp-est-cell"><b className="cp-num">{g}</b><span>graduating</span></div>
        <span className="cp-est-op" aria-hidden="true">+</span>
        <div className="cp-est-cell"><b className="cp-num">≈{e}</b><span>early leavers</span></div>
        <span className="cp-est-op" aria-hidden="true">=</span>
        <div className="cp-est-cell cp-est-cell--tot"><b className="cp-num">≈{total}</b><span>new spots</span></div>
        {fr != null && (
          <div className="cp-est-grp">
            <span className="cp-est-op" aria-hidden="true">→</span>
            <div className="cp-est-cell cp-est-cell--fr"><b className="cp-num">≈{fr}</b><span>for freshmen</span></div>
          </div>
        )}
      </div>
      <p className="cp-est-note">
        <RateNote est={est} who={who} />
        {fr != null
          ? <>, and <b>{pct0(est.frShare)}%</b> of its newcomers arrive as freshmen.</>
          : <>. Too few newcomers are tracked to say how the spots usually fill.</>}
        {' '}An estimate, not a count: roster size, redshirts and late transfers all move it.
      </p>
    </div>
  )
}

export default function ProjectedOpenings({ buckets, estimate, twoYear = false }) {
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

      {estimate && <Estimate est={estimate} isJC={twoYear} />}

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
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, opacity: 1, transform: 'translateX(-50%)' }}>
            <b>{POSFULL[tip.k]}</b> · {tip.c} · {tip.y2}
          </div>
        )
      })()}
    </div>
  )
}
