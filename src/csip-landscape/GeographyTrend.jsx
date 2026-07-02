import { useState } from 'react'
import Choropleth from './Choropleth'
import { useLandscapeGeoTrend } from './data/useLandscapeGeoTrend'
import { pct, divShort, genderLabel } from './data/landscapeFormat'

const SEASONS = [2021, 2022, 2023, 2024, 2025]

function DomIntlArea({ series }) {
  if (series.length < 1) return null
  const VBW = 600, VBH = 120, pad = 0
  const x = i => pad + (i / (SEASONS.length - 1)) * (VBW - 2 * pad)
  // boundary y = international share from the top (intl band on top)
  const bY = s => s * VBH
  const idx = s => SEASONS.indexOf(s)
  const pts = series.map(d => [x(idx(d.season)), bY(d.share)])
  const intlTop = `M0,0 L${VBW},0 L${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).reverse().join(' L')} Z`
  const domBottom = `M0,${VBH} L${VBW},${VBH} L${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).reverse().join(' L')} Z`
  const line = `M${pts.map(p => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L')}`
  const last = pts[pts.length - 1]
  return (
    <svg viewBox={`0 0 ${VBW} ${VBH}`} className="csl-geoarea" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
      <path d={domBottom} fill="#E6EAED" />
      <path d={intlTop} fill="var(--accent)" fillOpacity="0.16" />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth="2.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r="4" fill="var(--accent)" vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

export default function GeographyTrend({ client, division, gender }) {
  const geo = useLandscapeGeoTrend(client, { division, gender })
  const [season, setSeason] = useState(2025)
  const [mapMode, setMapMode] = useState('us')

  if (geo.loading) return <div className="csl-geo-loading">Loading geography…</div>
  if (geo.error) return <p className="csl-empty">Couldn’t load geography.</p>

  const seasonsWith = SEASONS.filter(s => geo.bySeason[s])
  const sel = seasonsWith.includes(season) ? season : seasonsWith[seasonsWith.length - 1]
  const cur = geo.bySeason[sel] || { states: {}, countries: {}, total: 0, unknown: 0, domestic: 0, intl: 0 }

  const series = seasonsWith
    .map(s => { const b = geo.bySeason[s]; const denom = b.domestic + b.intl; return denom ? { season: s, share: b.intl / denom } : null })
    .filter(Boolean)
  const first = series[0], lastPt = series[series.length - 1]
  const delta = lastPt && first ? lastPt.share - first.share : 0
  const dir = Math.abs(delta) < 0.005 ? 'flat' : delta > 0 ? 'up' : 'down'
  const deltaTxt = Math.abs(delta) < 0.005 ? 'no change' : `${delta > 0 ? '+' : '−'}${Math.round(Math.abs(delta) * 100)} pts`

  const cap = `${divShort(division)} ${genderLabel(gender)} · ${sel} · ${cur.total.toLocaleString()} players`

  return (
    <div className="csl-geotrend">
      <div className="csl-geoctl">
        <div className="csl-fgrp">
          <span className="csl-glabel">Season</span>
          {seasonsWith.map(s => (
            <button key={s} type="button" className="csl-fbtn" aria-pressed={s === sel} onClick={() => setSeason(s)}>{s}</button>
          ))}
        </div>
        <div className="csl-fgrp">
          <span className="csl-glabel">Map</span>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'us'} onClick={() => setMapMode('us')}>U.S.</button>
          <button type="button" className="csl-fbtn" aria-pressed={mapMode === 'world'} onClick={() => setMapMode('world')}>World</button>
        </div>
      </div>

      <Choropleth
        states={cur.states} countries={cur.countries} total={cur.total} unknown={cur.unknown}
        mapMode={mapMode} caption={cap}
      />

      <div className="csl-geosplit">
        <div className="csl-geosplit-h">
          <div>
            <p className="csl-eyebrow">Domestic vs. international</p>
            <div className="csl-ed-hero">
              <span className="csl-ed-val--sm">{pct(lastPt ? lastPt.share : 0)}</span>
              <span className={`csl-ed-delta csl-ed-delta--${dir === 'flat' ? 'flat' : 'up'}`} style={{ color: 'var(--slate)' }}>
                {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'} {deltaTxt}
                <span className="csl-ed-since"> since {first ? first.season : ''}</span>
              </span>
            </div>
          </div>
          <div className="csl-geolegend">
            <span><i style={{ background: 'var(--accent)' }} /> International</span>
            <span><i style={{ background: '#E6EAED' }} /> Domestic</span>
          </div>
        </div>
        <DomIntlArea series={series} />
        <div className="csl-ed-axis">
          {SEASONS.map((s, i) => (
            <span key={s} style={{
              left: `${(i / (SEASONS.length - 1)) * 100}%`,
              transform: i === 0 ? 'translateX(0)' : i === SEASONS.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)',
            }}>{s}</span>
          ))}
        </div>
        <p className="csl-note">International share of players with a listed hometown, by season. The band is the whole roster; the red slice is international.</p>
      </div>
    </div>
  )
}
