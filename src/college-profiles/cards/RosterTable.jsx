import { useState, useRef, useLayoutEffect } from 'react'
import { hometownLabel } from '../data/format'

/**
 * RosterTable — the current active roster, filterable by position group and
 * class year. Clean/functional by design. Hometown reads the normalized columns.
 *
 * Filtering changes the row count (and page height); to stop the viewport from
 * jumping, we pin the clicked filter button: record its on-screen position
 * before the state change and, in a layout effect (before paint), scroll by the
 * delta so it stays put.
 */
const POS = [['all', 'All'], ['GK', 'GK'], ['D', 'Defense'], ['M', 'Midfield'], ['F', 'Attack']]
const CLS = [['all', 'All'], ['FR', 'FR'], ['SO', 'SO'], ['JR', 'JR'], ['SR', 'SR'], ['GR', 'GR']]
const GRAD = new Set(['SR', 'GR'])

export default function RosterTable({ roster }) {
  const [pos, setPos] = useState('all')
  const [cls, setCls] = useState('all')

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

  const all = roster || []
  const rows = all
    .filter(r => (pos === 'all' || r.position === pos) && (cls === 'all' || r.class_year === cls))
    .slice()
    .sort((a, b) => (a.player_name || '').localeCompare(b.player_name || ''))

  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <h2 className="cp-h2">Current roster</h2>
        <span className="cp-hint">{rows.length} {rows.length === 1 ? 'player' : 'players'}</span>
      </div>

      <div className="cp-filters">
        <div className="cp-fgrp">
          <span className="cp-glabel">Position</span>
          {POS.map(([v, l]) => (
            <button key={v} type="button" className="cp-fbtn" aria-pressed={pos === v}
              onClick={e => { pin(e); setPos(v) }}>{l}</button>
          ))}
        </div>
        <div className="cp-fgrp cp-fgrp--gap">
          <span className="cp-glabel">Class</span>
          {CLS.map(([v, l]) => (
            <button key={v} type="button" className="cp-fbtn" aria-pressed={cls === v}
              onClick={e => { pin(e); setCls(v) }}>{l}</button>
          ))}
        </div>
      </div>

      <div className="cp-tablewrap">
        <table className="cp-table">
          <thead>
            <tr><th>Player</th><th>Pos</th><th>Class</th><th>Grad</th><th>Hometown</th></tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td className="cp-pname">{r.player_name}</td>
                <td>
                  {r.position
                    ? <span className={'cp-pos-pill cp-pos-' + r.position}>{r.position}</span>
                    : <span className="cp-muted">—</span>}
                </td>
                <td><span className={'cp-cls' + (GRAD.has(r.class_year) ? ' cp-cls--grad' : '')}>{r.class_year || '—'}</span></td>
                <td className="cp-muted cp-num">{r.grad_year || '—'}</td>
                <td className="cp-muted">{hometownLabel(r) || '—'}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={5} className="cp-muted" style={{ textAlign: 'center', padding: '22px' }}>No players match these filters.</td></tr>
            )}
          </tbody>
        </table>
        <div className="cp-rowcount">Showing {rows.length} of {all.length} players</div>
      </div>
    </section>
  )
}
