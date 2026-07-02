import { useState } from 'react'
import { US_VIEWBOX, US_BORDERS, US_STATE_PATHS } from './data/usStatesPaths'
import { WORLD_VIEWBOX, WORLD_BORDERS, WORLD_NAMES, WORLD_PATHS } from './data/worldCountriesPaths'
import { COUNTRY_CODE, COUNTRY_FLAGS } from './data/countryFlags'
import { clampTip } from './data/landscapeFormat'

/**
 * GeographyMap — recruiting geography for a whole division/conference segment as
 * a heat map, with a U.S. (state choropleth) / World (country choropleth) toggle.
 * Reads pre-aggregated player-level counts from program_benchmark_geo via
 * useLandscapeGeo; the season comes from the shared control bar (no local season
 * control here). Mirrors the College Profiles footprint treatment at scale.
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
    ? <span className="csl-flag" aria-hidden="true" dangerouslySetInnerHTML={{ __html: svg }} />
    : <span className="csl-flag csl-flag--none" aria-hidden="true" />
}

export default function GeographyMap({ geo, segmentLabel }) {
  const [mapMode, setMapMode] = useState('us') // 'us' | 'world'
  const [tip, setTip] = useState(null)

  const loading = geo?.loading
  const states = geo?.states || {}
  const countries = geo?.countries || {}
  const total = geo?.total || 0
  const unknown = geo?.unknown || 0
  const pctOf = c => (total ? Math.round(100 * c / total) : 0)

  const rankedStates = Object.entries(states).sort((a, b) => b[1] - a[1])
  const rankedIntl = Object.entries(countries).sort((a, b) => b[1] - a[1])

  // World roll-up: USA = all domestic (sum of states); each country -> base ISO code.
  const worldCounts = {}
  const domestic = Object.values(states).reduce((a, b) => a + b, 0)
  if (domestic) worldCounts.us = domestic
  for (const [name, c] of Object.entries(countries)) {
    const code = baseCode(COUNTRY_CODE[name])
    if (code) worldCounts[code] = (worldCounts[code] || 0) + c
  }
  const rankedCountries = Object.entries(worldCounts).sort((a, b) => b[1] - a[1])

  const maxCount = Math.max(1, ...Object.values(states))
  const maxWorld = Math.max(1, ...Object.values(worldCounts))

  if (loading) return <div className="csl-geo-loading">Loading geography…</div>

  return (
    <div className="csl-geowrap">
      <div className="csl-geoctl">
        <div className="csl-fgrp">
          <span className="csl-glabel">Map</span>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'us'} onClick={() => setMapMode('us')}>U.S.</button>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'world'} onClick={() => setMapMode('world')}>World</button>
        </div>
      </div>

      <div className="csl-geomap">
        <div className="csl-map">
          <div className="csl-map-cap">
            {segmentLabel} · <b>{total.toLocaleString()}</b> players · {mapMode === 'us'
              ? <><b>{rankedStates.length}</b> states{rankedIntl.length ? <> · <b>{rankedIntl.length}</b> intl</> : null}</>
              : <><b>{rankedCountries.length}</b> countries</>}
          </div>

          {mapMode === 'us' ? (
            <svg viewBox={US_VIEWBOX} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="U.S. recruiting footprint heat map">
              {Object.entries(US_STATE_PATHS).map(([name, d]) => {
                const c = states[name] || 0
                return (
                  <path key={name} d={d} className="csl-st" fill={scaleFill(c, maxCount)}
                    onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, name, c })}
                    onMouseLeave={() => setTip(null)} />
                )
              })}
              <path d={US_BORDERS} className="csl-borders" />
            </svg>
          ) : (
            <svg viewBox={WORLD_VIEWBOX} xmlns="http://www.w3.org/2000/svg" role="img" aria-label="World recruiting footprint heat map">
              {Object.entries(WORLD_PATHS).map(([code, d]) => {
                const c = worldCounts[code] || 0
                return (
                  <path key={code} d={d} className="csl-st" fill={scaleFill(c, maxWorld)}
                    onMouseMove={e => setTip({ x: e.clientX, y: e.clientY, name: niceCountry(code), c })}
                    onMouseLeave={() => setTip(null)} />
                )
              })}
              <path d={WORLD_BORDERS} className="csl-borders" />
            </svg>
          )}
          <div className="csl-heatkey"><span>Fewer</span><i className="csl-heatbar" /><span>More</span></div>
        </div>

        <div className="csl-geo-side">
          {mapMode === 'us' ? (
            <>
              <p className="csl-eyebrow">Top states</p>
              <ul className="csl-geo">
                {rankedStates.slice(0, 8).map(([name, c]) => (
                  <li key={name}>
                    <span className="csl-gname">{name}</span>
                    <span className="csl-gtrack"><span className="csl-gfill" style={{ width: `${100 * c / maxCount}%` }} /></span>
                    <span className="csl-gn">{c.toLocaleString()}</span>
                    <span className="csl-gpct">{pctOf(c)}%</span>
                  </li>
                ))}
                {rankedStates.length === 0 && <li className="csl-muted">No U.S. states in this view.</li>}
              </ul>

              {rankedIntl.length > 0 && (
                <>
                  <p className="csl-eyebrow csl-eyebrow--gap">International</p>
                  <ul className="csl-intl-list">
                    {rankedIntl.slice(0, 12).map(([name, c]) => (
                      <li key={name}>
                        <Flag code={COUNTRY_CODE[name]} />
                        <span className="csl-intl-name">{name}</span>
                        <span className="csl-intl-n">{c.toLocaleString()}</span>
                        <span className="csl-intl-pct">{pctOf(c)}%</span>
                      </li>
                    ))}
                  </ul>
                  {rankedIntl.length > 12 && (
                    <p className="csl-note">+{rankedIntl.length - 12} more countries</p>
                  )}
                </>
              )}
            </>
          ) : (
            <>
              <p className="csl-eyebrow">Top countries</p>
              <ul className="csl-intl-list">
                {rankedCountries.slice(0, 14).map(([code, c]) => (
                  <li key={code}>
                    <Flag code={code} />
                    <span className="csl-intl-name">{niceCountry(code)}</span>
                    <span className="csl-intl-n">{c.toLocaleString()}</span>
                    <span className="csl-intl-pct">{pctOf(c)}%</span>
                  </li>
                ))}
                {rankedCountries.length === 0 && <li className="csl-muted">No data in this view.</li>}
              </ul>
            </>
          )}

          {unknown > 0 && (
            <p className="csl-geo-note">
              {unknown.toLocaleString()} player{unknown === 1 ? '' : 's'} ({pctOf(unknown)}%) have no listed hometown — not shown on the map.
            </p>
          )}
        </div>
      </div>

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y)
        return (
          <div className="csl-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b>{tip.name}</b> · {tip.c.toLocaleString()} {tip.c === 1 ? 'player' : 'players'} ({pctOf(tip.c)}%)
          </div>
        )
      })()}
    </div>
  )
}
