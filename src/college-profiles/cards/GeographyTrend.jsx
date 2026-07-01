import { useState } from 'react'
import { US_VIEWBOX, US_BORDERS, US_STATE_PATHS } from '../data/usStatesPaths'
import { WORLD_VIEWBOX, WORLD_BORDERS, WORLD_NAMES, WORLD_PATHS } from '../data/worldCountriesPaths'
import { clampTip } from '../data/format'
import { COUNTRY_CODE, COUNTRY_FLAGS } from '../data/countryFlags'

/**
 * GeographyTrend — recruiting footprint as a heat map, time-aware, with a
 * U.S. (state choropleth) / World (country choropleth) toggle so international
 * recruiting gets the same heat treatment as domestic. City-level pins need
 * geocoding (deferred); state/country is supported by the normalized columns.
 */
function scaleFill(count, max) {
  if (!count) return '#EAEDEF'
  const t = 0.16 + 0.84 * (count / max)
  const r = Math.round(255 + (187 - 255) * t)
  const g = Math.round(255 + (0 - 255) * t)
  const b = Math.round(255 + (0 - 255) * t)
  return `rgb(${r},${g},${b})`
}
const baseCode = c => (c || '').split('-')[0]
const niceCountry = code => (code === 'us' ? 'United States' : (WORLD_NAMES[code] || code.toUpperCase()))

function Flag({ code }) {
  const svg = code ? COUNTRY_FLAGS[code] : null
  return svg
    ? <span className="cp-flag" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    : <span className="cp-flag cp-flag--none" aria-hidden="true" />
}

export default function GeographyTrend({ data }) {
  const [mode, setMode] = useState('recruit')   // 'recruit' | 'roster'
  const [sel, setSel] = useState('all')         // 'all' | year
  const [mapMode, setMapMode] = useState('us')  // 'us' | 'world'
  const [tip, setTip] = useState(null)

  const scope = sel === 'all'
    ? data.all
    : (mode === 'recruit' ? data.byRecruit[sel] : data.byRoster[sel])
  const states = scope?.states || {}
  const intl = scope?.intl || {}
  const total = scope?.total || 0
  const pctOf = c => (total ? Math.round(100 * c / total) : 0)
  const rankedStates = Object.entries(states).sort((a, b) => b[1] - a[1])
  const rankedIntl = Object.entries(intl).sort((a, b) => b[1] - a[1])

  // world roll-up: USA = all domestic; each country = base-code sum
  const worldCounts = {}
  const domestic = Object.values(states).reduce((a, b) => a + b, 0)
  if (domestic) worldCounts.us = domestic
  for (const [name, c] of Object.entries(intl)) {
    const code = baseCode(COUNTRY_CODE[name])
    if (code) worldCounts[code] = (worldCounts[code] || 0) + c
  }
  const rankedCountries = Object.entries(worldCounts).sort((a, b) => b[1] - a[1])

  const maxCount = Math.max(1, ...Object.values(states))
  const maxWorld = Math.max(1, ...Object.values(worldCounts))

  const distinctByYear = data.seasons.map(y => ({
    y, n: (mode === 'recruit' ? data.byRecruit[y] : data.byRoster[y])?.distinctStates || 0,
  }))
  const maxDistinct = Math.max(1, ...distinctByYear.map(d => d.n))
  const modeNoun = mode === 'recruit' ? 'recruiting classes' : 'rosters'
  const selLabel = sel === 'all' ? 'All-time' : `${sel} ${mode === 'recruit' ? 'class' : 'roster'}`

  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <h2 className="cp-h2">Recruiting geography</h2>
        <span className="cp-hint">Where the program pulls from — {modeNoun} over time · hover the map</span>
      </div>

      <div className="cp-panel">
        <div className="cp-geoctl">
          <div className="cp-fgrp">
            <span className="cp-glabel">View</span>
            <button type="button" className="cp-fbtn" aria-pressed={mode === 'recruit'} onClick={() => setMode('recruit')}>Recruiting classes</button>
            <button type="button" className="cp-fbtn" aria-pressed={mode === 'roster'} onClick={() => setMode('roster')}>Full roster</button>
          </div>
          <div className="cp-fgrp cp-fgrp--gap">
            <span className="cp-glabel">Map</span>
            <button type="button" className="cp-fbtn" aria-pressed={mapMode === 'us'} onClick={() => setMapMode('us')}>U.S.</button>
            <button type="button" className="cp-fbtn" aria-pressed={mapMode === 'world'} onClick={() => setMapMode('world')}>World</button>
          </div>
          <div className="cp-fgrp cp-fgrp--gap">
            <span className="cp-glabel">Season</span>
            <button type="button" className="cp-fbtn" aria-pressed={sel === 'all'} onClick={() => setSel('all')}>All-time</button>
            {data.seasons.map(y => (
              <button key={y} type="button" className="cp-fbtn" aria-pressed={sel === y} onClick={() => setSel(y)}>{y}</button>
            ))}
          </div>
        </div>

        <div className="cp-geomap">
          <div className="cp-map">
            <div className="cp-map-cap">
              {selLabel} · <b>{total}</b> players · {mapMode === 'us'
                ? <><b>{rankedStates.length}</b> states{rankedIntl.length ? <> · <b>{rankedIntl.length}</b> intl</> : null}</>
                : <><b>{rankedCountries.length}</b> countries</>}
            </div>

            {mapMode === 'us' ? (
              <svg viewBox={US_VIEWBOX} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="U.S. recruiting footprint heat map">
                {Object.entries(US_STATE_PATHS).map(([name, d]) => {
                  const c = states[name] || 0
                  return (
                    <path key={name} d={d} className="cp-st" fill={scaleFill(c, maxCount)}
                      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, name, c })}
                      onMouseLeave={() => setTip(null)} />
                  )
                })}
                <path d={US_BORDERS} className="cp-borders" />
              </svg>
            ) : (
              <svg viewBox={WORLD_VIEWBOX} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="World recruiting footprint heat map">
                {Object.entries(WORLD_PATHS).map(([code, d]) => {
                  const c = worldCounts[code] || 0
                  return (
                    <path key={code} d={d} className="cp-st" fill={scaleFill(c, maxWorld)}
                      onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, name: niceCountry(code), c })}
                      onMouseLeave={() => setTip(null)} />
                  )
                })}
                <path d={WORLD_BORDERS} className="cp-borders" />
              </svg>
            )}
            <div className="cp-heatkey"><span>Fewer</span><i className="cp-heatbar" /><span>More</span></div>
          </div>

          <div className="cp-geo-side">
            {mapMode === 'us' ? (
              <>
                <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Top states</p>
                <ul className="cp-geo">
                  {rankedStates.slice(0, 8).map(([name, c]) => (
                    <li key={name}>
                      <span className="cp-gname">{name}</span>
                      <span className="cp-gtrack"><span className="cp-gfill" style={{ width: `${100 * c / maxCount}%` }} /></span>
                      <span className="cp-gn cp-num">{c}</span>
                      <span className="cp-gpct">{pctOf(c)}%</span>
                    </li>
                  ))}
                  {rankedStates.length === 0 && <li className="cp-muted">No U.S. states in this view.</li>}
                </ul>

                {rankedIntl.length > 0 && (
                  <>
                    <p className="cp-eyebrow" style={{ margin: '14px 0 8px' }}>International</p>
                    <ul className="cp-intl-list">
                      {rankedIntl.map(([name, c]) => (
                        <li key={name}>
                          <Flag code={COUNTRY_CODE[name]} />
                          <span className="cp-intl-name">{name}</span>
                          <span className="cp-intl-n cp-num">{c}</span>
                          <span className="cp-intl-pct">{pctOf(c)}%</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </>
            ) : (
              <>
                <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Top countries</p>
                <ul className="cp-intl-list">
                  {rankedCountries.slice(0, 12).map(([code, c]) => (
                    <li key={code}>
                      <Flag code={code} />
                      <span className="cp-intl-name">{niceCountry(code)}</span>
                      <span className="cp-intl-n cp-num">{c}</span>
                      <span className="cp-intl-pct">{pctOf(c)}%</span>
                    </li>
                  ))}
                  {rankedCountries.length === 0 && <li className="cp-muted">No data in this view.</li>}
                </ul>
              </>
            )}

            <p className="cp-eyebrow" style={{ margin: '16px 0 8px' }}>States represented by year</p>
            <div className="cp-distinct">
              {distinctByYear.map(d => (
                <div className="cp-distinct-row" key={d.y}>
                  <span className="cp-distinct-y">{d.y}</span>
                  <div className="cp-track"><div className="cp-fill" style={{ width: `${100 * d.n / maxDistinct}%` }} /></div>
                  <span className="cp-distinct-n cp-num">{d.n}</span>
                </div>
              ))}
            </div>
            <p className="cp-geo-note">Widening bars = a broadening footprint; tightening = more concentrated recruiting.</p>
          </div>
        </div>
      </div>

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y)
        return (
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b>{tip.name}</b> · {tip.c} {tip.c === 1 ? 'player' : 'players'} ({pctOf(tip.c)}%)
          </div>
        )
      })()}
    </section>
  )
}
