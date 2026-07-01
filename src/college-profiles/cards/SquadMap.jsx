import { useEffect, useState } from 'react'
import { hometownLabel } from '../data/format'

/**
 * SquadMap — the signature card. A turf surface with four position bands
 * (attack → goal) × class-year columns; chips shade by seniority (light FR →
 * dark GR); SR/GR chips carry the scarlet ring + ↗ = graduating. Hover a chip
 * for the player detail. Chips fade in staggered on first render.
 */
const POS = [
  { k: 'F',  nm: 'Attack',   singular: 'Forward' },
  { k: 'M',  nm: 'Midfield', singular: 'Midfielder' },
  { k: 'D',  nm: 'Defense',  singular: 'Defender' },
  { k: 'GK', nm: 'Goal',     singular: 'Goalkeeper' },
]
const CLS = ['FR', 'SO', 'JR', 'SR', 'GR']
const CLSNAME = { FR: 'Freshman', SO: 'Sophomore', JR: 'Junior', SR: 'Senior', GR: 'Graduate' }
const GRADUATING = new Set(['SR', 'GR'])
const POS_KEYS = new Set(POS.map(p => p.k))

function lastName(name) {
  const parts = (name || '').trim().split(/\s+/)
  return parts.length > 1 ? parts.slice(1).join(' ') : (name || '')
}

export default function SquadMap({ roster, season }) {
  const rows = roster || []
  const reduce = typeof window !== 'undefined' && window.matchMedia
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches

  const [revealed, setRevealed] = useState(reduce)
  const [settled, setSettled] = useState(reduce)

  const placed = rows.filter(r => POS_KEYS.has(r.position))
  const chipCount = placed.length

  useEffect(() => {
    if (reduce) return
    const t1 = setTimeout(() => setRevealed(true), 50)
    const t2 = setTimeout(() => setSettled(true), 50 + chipCount * 22 + 360)
    return () => { clearTimeout(t1); clearTimeout(t2) }
  }, [reduce, chipCount])

  const unlisted = rows.length - placed.length
  const gradCount = rows.filter(r => GRADUATING.has(r.class_year)).length
  let deepest = null
  for (const p of POS) {
    const n = placed.filter(r => r.position === p.k).length
    if (!deepest || n > deepest.n) deepest = { nm: p.nm, n }
  }

  let idx = 0
  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <h2 className="cp-h2">Squad Map</h2>
        <span className="cp-hint">Depth by position &amp; class year · hover any player · <b className="cp-hint-g">↗</b> = graduating</span>
      </div>

      <div className={'cp-pitch' + (revealed ? ' cp-pitch--in' : '')}>
        <div className="cp-legend">
          <span className="cp-legend-t">Roster shape — attack to goal</span>
          <span className="cp-legend-k">
            {CLS.map(c => (
              <span className="cp-lk" key={c}><i className={'cp-swatch cp-' + c.toLowerCase()} />{CLSNAME[c]}</span>
            ))}
          </span>
        </div>

        {POS.map(pos => {
          const inPos = placed.filter(r => r.position === pos.k)
          return (
            <div className="cp-band" key={pos.k}>
              <div className="cp-band-label">
                <span className="cp-band-nm">{pos.nm}</span>
                <span className="cp-band-ct">{inPos.length} {inPos.length === 1 ? 'player' : 'players'}</span>
              </div>
              <div className="cp-cols">
                {CLS.map(cl => {
                  const players = inPos.filter(r => r.class_year === cl)
                  return (
                    <div className={'cp-col' + (players.length ? '' : ' cp-col--empty')} key={cl}>
                      <p className="cp-col-h">{cl}</p>
                      <div className="cp-chips">
                        {players.map(pl => {
                          const i = idx++
                          const grad = GRADUATING.has(pl.class_year)
                          const cls = 'cp-chip cp-chip--' + cl.toLowerCase()
                            + (grad ? ' cp-chip--grad' : '')
                            + (settled ? ' cp-shown' : (revealed ? ' cp-anim' : ''))
                          const loc = hometownLabel(pl)
                          return (
                            <span key={pl.id} className={cls} tabIndex={0}
                              style={settled ? undefined : { animationDelay: `${50 + i * 22}ms` }}>
                              {lastName(pl.player_name)}
                              <span className="cp-tip">
                                <b>{pl.player_name}</b> · {CLSNAME[pl.class_year] || pl.class_year}<br />
                                {pos.singular}{loc ? ` · ${loc}` : ''}
                                {pl.grad_year ? <><br /><span className="cp-tip-g">Graduates {pl.grad_year}</span></> : null}
                              </span>
                            </span>
                          )
                        })}
                      </div>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        <p className="cp-pitch-foot">
          {deepest && deepest.n > 0 && <><b>{deepest.nm}</b> carries the most depth ({deepest.n}). </>}
          {gradCount > 0 && <>{gradCount} {gradCount === 1 ? 'player graduates' : 'players graduate'} after {season}.</>}
          {unlisted > 0 && <> {unlisted} not shown (position unlisted).</>}
        </p>
      </div>
    </section>
  )
}
