import { useState } from 'react'
import Choropleth from './Choropleth'
import { useLandscapeGeoTrend } from './data/useLandscapeGeoTrend'
import { pct, divShort, genderLabel } from './data/landscapeFormat'

const SEASONS = [2021, 2022, 2023, 2024, 2025]
const ORIGIN_COLORS = ['#2a78d6', '#1baf7a', '#eda100', '#4a3aa7', '#e34948', '#9aa6ad']
const TOP_N = 5

function OriginsFlow({ bySeason, seasonsWith }) {
  const [active, setActive] = useState(seasonsWith[seasonsWith.length - 1])

  const agg = {}
  seasonsWith.forEach(s => { for (const [k, v] of Object.entries(bySeason[s].countries)) agg[k] = (agg[k] || 0) + v })
  const top = Object.entries(agg).sort((a, b) => b[1] - a[1]).slice(0, TOP_N).map(e => e[0])
  const groups = [
    ...top.map((k, i) => ({ k, label: k, color: ORIGIN_COLORS[i] })),
    { k: '__other', label: 'Other', color: ORIGIN_COLORS[5] },
  ]
  const intlTot = s => (bySeason[s].intl || Object.values(bySeason[s].countries).reduce((a, b) => a + b, 0))
  const countOf = (s, g) => g.k === '__other'
    ? intlTot(s) - top.reduce((a, k) => a + (bySeason[s].countries[k] || 0), 0)
    : (bySeason[s].countries[g.k] || 0)

  const act = seasonsWith.includes(active) ? active : seasonsWith[seasonsWith.length - 1]
  const actTot = intlTot(act) || 1

  return (
    <div className="csl-sf">
      <div className="csl-sf-legend">
        {groups.map(g => (
          <span className="csl-sf-lk" key={g.k}><i className="csl-cmp-dot" style={{ background: g.color }} />{g.label}</span>
        ))}
      </div>
      <div className="csl-sf-read">
        <b>{act}</b>
        {groups.map(g => {
          const c = countOf(act, g)
          if (c <= 0) return null
          return (
            <span key={g.k}>
              <span className="csl-sf-read-sh" style={{ color: g.color }}>{g.label}</span>
              <span className="csl-sf-read-c"> {Math.round(c)} ({Math.round(100 * c / actTot)}%)</span>
            </span>
          )
        })}
      </div>
      <div className="csl-sf-flow">
        {seasonsWith.map(s => {
          const tot = intlTot(s) || 1
          return (
            <div key={s} className={`csl-sf-col${s === act ? ' csl-sf-col--on' : ''}`}
              onMouseEnter={() => setActive(s)} onClick={() => setActive(s)}>
              {groups.map(g => {
                const c = countOf(s, g)
                return <div key={g.k} className="csl-sf-seg" style={{ height: `${Math.max(0, 100 * c / tot)}%`, background: g.color }} />
              })}
            </div>
          )
        })}
      </div>
      <div className="csl-sf-axis">
        {seasonsWith.map(s => <div key={s} className={s === act ? 'csl-sf-ax--on' : ''}>{s}</div>)}
      </div>
    </div>
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
    .map(s => { const b = geo.bySeason[s]; const denom = b.domestic + b.intl; return denom ? { season: s, share: b.intl / denom, intl: b.intl } : null })
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
            <p className="csl-eyebrow">International players</p>
            <div className="csl-ed-hero">
              <span className="csl-ed-val--sm">{pct(lastPt ? lastPt.share : 0)}</span>
              <span className={`csl-ed-delta csl-ed-delta--${dir}`} style={{ color: 'var(--slate)' }}>
                {dir === 'up' ? '▲' : dir === 'down' ? '▼' : '–'} {deltaTxt}
                <span className="csl-ed-since"> since {first ? first.season : ''}</span>
              </span>
              {first && lastPt && (
                <span className="csl-geo-count">{first.intl.toLocaleString()} → {lastPt.intl.toLocaleString()} players</span>
              )}
            </div>
          </div>
        </div>
        <OriginsFlow bySeason={geo.bySeason} seasonsWith={seasonsWith} />
        <p className="csl-note">Where international players come from, by season — segment heights are each origin’s share of the international pool. Tap a season for counts. “Other” groups all countries beyond the top {TOP_N}.</p>
      </div>
    </div>
  )
}
