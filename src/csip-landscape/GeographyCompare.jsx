import { useState, lazy, Suspense } from 'react'
// Map shapes load on their own (performance pass, 2026-10-09).
const LazyChoropleth = lazy(() => import('./Choropleth'))
const Choropleth = props => (
  <Suspense fallback={<div style={{ minHeight: 160 }} className="csl-eyebrow">Loading map…</div>}>
    <LazyChoropleth {...props} />
  </Suspense>
)
import { pct, divShort, genderLabel, seasonLabel } from './data/landscapeFormat'

/**
 * GeographyCompare — side-by-side recruiting footprints for the compare segments
 * (reusing the shared Choropleth), plus an international-share comparison bar.
 * Colour = segment; hovering the shared legend dims the others.
 *
 * typicalIntl (2026-10-09): per segment, the international head count of the
 * typical (median) program, from program_benchmarks origin metric='count'.
 * The bars are player-level shares; this line is the per-program count, so it
 * is labelled as such. Pinned programs show their own count.
 */
const segLabel = sg => `${divShort(sg.division)} ${genderLabel(sg.gender)} · ${seasonLabel(sg.season)}`
const dimOf = (hovered, i) => (hovered != null && hovered !== i ? 0.28 : 1)

export default function GeographyCompare({ geo, segments, colors, hovered, pins = [], typicalIntl = [] }) {
  const [mapMode, setMapMode] = useState('us')

  if (geo.loading) return <div className="csl-geo-loading">Loading geography…</div>
  if (geo.error) return <p className="csl-empty">Couldn’t load geography.</p>

  const shares = segments.map((s, i) => {
    const d = geo.get(i)
    const den = d ? d.domestic + d.intl : 0
    return den ? d.intl / den : null
  })
  const pinShares = pins.map(pn => pn.snap?.intl?.share ?? null)
  const maxShare = Math.max(...[...shares, ...pinShares].filter(v => v != null), 0.0001) * 1.15

  return (
    <div className="csl-geocmp">
      <div className="csl-geoctl">
        <div className="csl-fgrp">
          <span className="csl-glabel">Map</span>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'us'} onClick={() => setMapMode('us')}>U.S.</button>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'world'} onClick={() => setMapMode('world')}>World</button>
        </div>
      </div>

      <div className={`csl-geocmp-grid csl-geocmp-grid--${segments.length}`}>
        {segments.map((sg, i) => {
          const d = geo.get(i) || { states: {}, countries: {}, total: 0, unknown: 0 }
          return (
            <div className="csl-geocmp-cell" key={i} style={{ opacity: dimOf(hovered, i) }}>
              <div className="csl-geocmp-cap">
                <i className="csl-cmp-dot" style={{ background: colors[i] }} />
                {segLabel(sg)} · <b>{(d.total || 0).toLocaleString()}</b>
              </div>
              <Choropleth
                states={d.states} countries={d.countries} total={d.total} unknown={d.unknown}
                mapMode={mapMode} showLists={false} compact
              />
            </div>
          )
        })}
      </div>

      {pins.length > 0 && (
        <div className="csl-geocmp-pins">
          <div className="csl-gcard-glab">Pinned programs</div>
          <div className={`csl-geocmp-grid${pins.length === 1 ? ' csl-geocmp-grid--1' : ''}`}>
            {pins.map((pn, pi) => {
              const d = pn.snap?.geo || { states: {}, countries: {}, total: 0, unknown: 0 }
              return (
                <div className="csl-geocmp-cell" key={pi}>
                  <div className="csl-geocmp-cap">
                    <i className="csl-cmp-dot" style={{ background: pn.color }} />
                    {pn.name} · '{String(pn.snap?.season ?? '').slice(-2)} · <b>{(d.total || 0).toLocaleString()}</b>
                  </div>
                  <Choropleth
                    states={d.states} countries={d.countries} total={d.total} unknown={d.unknown}
                    mapMode={mapMode} showLists={false} compact
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      <div className="csl-geocmp-intl">
        <div className="csl-cmp-panel-h">
          <h4 className="csl-cmp-panel-title">International share</h4>
          <span className="csl-cmp-panel-hint">of players with a listed hometown</span>
        </div>
        <div className="csl-vbars">
          {segments.map((sg, i) => (
            <div className="csl-hbar-row" key={i} style={{ opacity: dimOf(hovered, i) }}>
              <span className="csl-hbar-key"><i className="csl-cmp-dot" style={{ background: colors[i] }} />{divShort(sg.division)}</span>
              <span className="csl-hbar-track">
                <span className="csl-hbar-fill" style={{ width: shares[i] == null ? 0 : `${100 * shares[i] / maxShare}%`, background: colors[i] }} />
              </span>
              <span className="csl-hbar-val csl-hbar-val--big">{shares[i] == null ? '—' : pct(shares[i])}</span>
            </div>
          ))}
          {pins.map((pn, pi) => (
            <div className="csl-hbar-row csl-hbar-row--pin" key={`p${pi}`}>
              <span className="csl-hbar-key csl-hbar-key--pin" title={pn.name}><i className="csl-cmp-dot" style={{ background: pn.color }} /><span className="csl-hbar-keytx">{(pn.name || '').replace(/\s+(University|College)$/i, '').slice(0, 20)}</span></span>
              <span className="csl-hbar-track">
                <span className="csl-hbar-fill" style={{ width: pinShares[pi] == null ? 0 : `${100 * pinShares[pi] / maxShare}%`, background: pn.color }} />
              </span>
              <span className="csl-hbar-val csl-hbar-val--big">{pinShares[pi] == null ? '—' : pct(pinShares[pi])}</span>
            </div>
          ))}
        </div>
        {(typicalIntl.some(v => v != null) || pins.some(pn => pn.snap?.intl?.count != null)) && (
          <p className="csl-note" style={{ marginTop: 8 }}>
            International players on the typical roster:{' '}
            {segments.map((sg, i) => (typicalIntl[i] == null ? null : (
              <span key={i} style={{ opacity: dimOf(hovered, i), whiteSpace: 'nowrap' }}>
                <i className="csl-cmp-dot" style={{ background: colors[i] }} /> {divShort(sg.division)} {genderLabel(sg.gender)} <b>{Math.round(Number(typicalIntl[i]))}</b>{'  '}
              </span>
            )))}
            {pins.map((pn, pi) => (pn.snap?.intl?.count == null ? null : (
              <span key={`p${pi}`} style={{ whiteSpace: 'nowrap' }}>
                <i className="csl-cmp-dot" style={{ background: pn.color }} /> {(pn.name || '').replace(/\s+(University|College)$/i, '')} <b>{pn.snap.intl.count}</b>{'  '}
              </span>
            )))}
          </p>
        )}
      </div>
    </div>
  )
}
