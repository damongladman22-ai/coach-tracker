import { useState } from 'react'
import {
  pct, pct1, inchesToFtIn, whole, seasonLabel, genderLabel, divShort, THIN_N,
} from './data/landscapeFormat'
import GeographyMap from './GeographyMap'
import InfoTip from './InfoTip'
import PinControl from './PinControl'
import { useLandscapePins, PIN_COLORS } from './data/useLandscapePins'
import { PROFILE_INFO } from './data/landscapeInfo'

/* ------------------------------------------------------------------ helpers */

function commas(n) {
  if (n == null || isNaN(n)) return '\u2014'
  return Math.round(n).toLocaleString('en-US')
}
function nLabel(row) {
  if (!row || row.n == null) return null
  const noun = row.agg_level === 'player' ? 'players' : 'programs'
  return `n = ${commas(row.n)} ${noun}`
}
function rankTop(dict, n) {
  return Object.entries(dict || {}).sort((a, b) => b[1] - a[1]).slice(0, n)
}

function Section({ id, title, hint, row, info, children }) {
  const thin = row && row.n != null && row.n < THIN_N
  return (
    <section id={id} className="csl-sec csl-anchor">
      <div className="csl-sec-h">
        <h2 className="csl-h2">{title}</h2>
        <div className="csl-sec-meta">
          {hint && <span className="csl-hint">{hint}</span>}
          {row && <span className="csl-n">{nLabel(row)}</span>}
          {thin && <span className="csl-thin">small sample</span>}
          {info && <InfoTip {...info} />}
        </div>
      </div>
      <div className="csl-panel">{children}</div>
    </section>
  )
}

/** Horizontal share bars, median fill + IQR text, plus a marker per pinned program. */
function ShareBars({ items, get, domainMax, pins }) {
  const rows = items
    .map(it => ({ ...it, row: get(it.dimension, it.bucket, it.metric || 'share'), count: get(it.dimension, it.bucket, 'count') }))
    .filter(r => r.row)
  if (!rows.length) return <p className="csl-empty">No data for this selection.</p>

  const dmax = domainMax || Math.max(0.4, ...rows.map(r => r.row.p75 ?? r.row.median ?? 0))
  const asPct = v => `${Math.min(100, Math.max(0, (v / dmax) * 100))}%`

  return (
    <div className="csl-bars">
      {rows.map(r => {
        const med = r.row.median ?? r.row.mean ?? 0
        const lo = r.row.p25, hi = r.row.p75
        return (
          <div className="csl-bar-row" key={r.label}>
            <span className="csl-bar-label">{r.label}</span>
            <div className="csl-bar-track">
              <div className="csl-bar-fill" style={{ width: asPct(med) }} />
              {pins && pins.map((pp, idx) => {
                const c = pp.shareMap?.[r.bucket]
                return c && c.share != null
                  ? <span key={idx} className="csl-pin-mark" style={{ left: asPct(c.share), color: pp.color }} title={`${pp.name}: ${pct(c.share)} · ${c.count}`} />
                  : null
              })}
            </div>
            <span className="csl-bar-val">
              <span className="csl-bv-med">
                <b>{pct(med)}</b>
                {r.count?.median != null && <span className="csl-bar-count"> · {Math.round(r.count.median)}</span>}
                {lo != null && hi != null && <i className="csl-iqrtext"> {pct(lo)}–{pct(hi)}</i>}
              </span>
              {pins && pins.map((pp, idx) => {
                const c = pp.shareMap?.[r.bucket]
                return c && c.share != null
                  ? <span key={idx} className="csl-bv-pin" style={{ color: pp.color }}>{pct(c.share)} · {c.count}</span>
                  : null
              })}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Height-by-position: dot at median + IQR band; a marker per pinned program. */
function HeightByPosition({ get, pins }) {
  const AXIS_LO = 60, AXIS_HI = 74, SPAN = AXIS_HI - AXIS_LO
  const posFor = v => `${((v - AXIS_LO) / SPAN) * 100}%`
  const posClamp = v => `${Math.min(100, Math.max(0, ((v - AXIS_LO) / SPAN) * 100))}%`
  const positions = [
    { bucket: 'GK', label: 'Goalkeepers' }, { bucket: 'D', label: 'Defenders' },
    { bucket: 'M', label: 'Midfielders' }, { bucket: 'F', label: 'Forwards' },
  ]
  const rows = positions.map(p => ({ ...p, row: get('position', p.bucket, 'height_inches') })).filter(p => p.row)
  const overall = get('overall', 'ALL', 'height_inches')
  if (!rows.length && !overall) return <p className="csl-empty">No height data for this selection.</p>
  const ticks = [60, 64, 68, 72]

  return (
    <div className="csl-hbp">
      {overall && (
        <div className="csl-hbp-ref" style={{ left: posFor(overall.median ?? overall.mean) }}
          title={`All positions median ${inchesToFtIn(overall.median ?? overall.mean)}`} />
      )}
      {rows.map(r => {
        const med = r.row.median ?? r.row.mean
        const lo = r.row.p25, hi = r.row.p75
        return (
          <div className="csl-hbp-row" key={r.bucket}>
            <span className="csl-bar-label">{r.label}</span>
            <div className="csl-hbp-track">
              {lo != null && hi != null && (
                <div className="csl-hbp-iqr" style={{ left: posFor(lo), width: posFor(hi - lo + AXIS_LO) }} />
              )}
              <div className="csl-hbp-dot" style={{ left: posFor(med) }} />
              {pins && pins.map((pp, idx) => {
                const v = pp.heightByPos?.[r.bucket]
                return v != null
                  ? <span key={idx} className="csl-pin-mark csl-pin-mark--v" style={{ left: posClamp(v), color: pp.color }} title={`${pp.name}: ${inchesToFtIn(v)}`} />
                  : null
              })}
            </div>
            <span className="csl-bar-val">
              <span className="csl-bv-med">
                <b>{inchesToFtIn(med)}</b>
                {lo != null && hi != null && <i className="csl-iqrtext"> {inchesToFtIn(lo)}–{inchesToFtIn(hi)}</i>}
              </span>
              {pins && pins.map((pp, idx) => {
                const v = pp.heightByPos?.[r.bucket]
                return v != null ? <span key={idx} className="csl-bv-pin" style={{ color: pp.color }}>{inchesToFtIn(v)}</span> : null
              })}
            </span>
          </div>
        )
      })}
      <div className="csl-hbp-axis">
        {ticks.map(t => <span key={t} className="csl-hbp-tick" style={{ left: posFor(t) }}>{inchesToFtIn(t)}</span>)}
      </div>
      {overall && (
        <p className="csl-note">
          Dashed line = all-positions median ({inchesToFtIn(overall.median ?? overall.mean)}). Bar = middle-half (25th–75th percentile) of players; dot = median.
        </p>
      )}
    </div>
  )
}

/** Roster-size spread: median + middle-half band; a marker per pinned program. */
function RosterSize({ get, pins }) {
  const row = get('overall', 'ALL', 'roster_size')
  if (!row) return <p className="csl-empty">No roster-size data for this selection.</p>
  const med = row.median ?? row.mean
  const lo = row.p25, hi = row.p75
  const axisMax = Math.max(40, Math.ceil(((hi ?? med) * 1.25) / 5) * 5)
  const posFor = v => `${Math.min(100, (v / axisMax) * 100)}%`
  const ticks = []
  for (let t = 0; t <= axisMax; t += 10) ticks.push(t)
  return (
    <div className="csl-spread">
      <div className="csl-spread-track">
        {lo != null && hi != null && (
          <div className="csl-spread-band" style={{ left: posFor(lo), width: posFor(hi - lo) }} />
        )}
        <div className="csl-spread-dot" style={{ left: posFor(med) }} />
        {pins && pins.map((pp, idx) => pp.roster != null
          ? <span key={idx} className="csl-pin-mark csl-pin-mark--v" style={{ left: posFor(pp.roster), color: pp.color }} title={`${pp.name}: ${pp.roster}`} />
          : null)}
        {ticks.map(t => <span key={t} className="csl-spread-tick" style={{ left: posFor(t) }}>{t}</span>)}
      </div>
      <p className="csl-spread-read">
        Typical program carries <b>{whole(med)}</b> players
        {lo != null && hi != null && <> — middle-half <b>{whole(lo)}–{whole(hi)}</b></>}.
      </p>
      {pins && pins.length > 0 && (
        <div className="csl-spread-pins">
          {pins.map((pp, idx) => pp.roster != null && (
            <span key={idx} className="csl-spread-pin" style={{ color: pp.color }}>
              <i className="csl-pin-dot" style={{ background: pp.color }} />{pp.name}: <b>{pp.roster}</b>
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

function Retention({ get, season }) {
  const ret = get('overall', 'ALL', 'return_rate')
  const nw = get('overall', 'ALL', 'newcomer_rate')
  if (!ret && !nw) {
    return (
      <p className="csl-empty">
        Retention isn’t tracked for this selection
        {season === 2021 ? ' (it’s stored under the arrival season, so it starts at 2022)' : ' (JC is excluded — a two-year stop isn’t a return-rate concept)'}.
      </p>
    )
  }
  const stat = (row, label, desc) => {
    if (!row) return null
    const med = row.median ?? row.mean
    const lo = row.p25, hi = row.p75
    return (
      <div className="csl-retstat">
        <div className="csl-retstat-v csl-num">{pct1(med)}</div>
        <div className="csl-retstat-l">{label}</div>
        {lo != null && hi != null && <div className="csl-retstat-iqr">middle-half {pct(lo)}–{pct(hi)}</div>}
        <div className="csl-retstat-d">{desc}</div>
      </div>
    )
  }
  return (
    <div className="csl-rets">
      {stat(ret, 'Return rate', 'Of non-graduating players, the share back the next season.')}
      {stat(nw, 'Newcomer rate', 'Share of the roster that is new (no prior-season linkage).')}
    </div>
  )
}

/* ---------------------------------------------------------- geography (pin) */

function PinFootprint({ geo, intl, name }) {
  if (!geo) return null
  const top = geo.topStates.slice(0, 6)
  const cty = geo.topCountries.slice(0, 6)
  const placed = geo.domestic + geo.intl
  return (
    <div className="csl-pinfp">
      <div className="csl-pinfp-h"><i className="csl-pin-dot" /><b>{name}</b> · own footprint</div>
      <div className="csl-pinfp-split">
        <span><b className="csl-pin-val">{intl.share != null ? pct(intl.share) : '—'}</b> international</span>
        <span className="csl-muted">{geo.intl} of {placed} placed players{geo.unknown ? ` · ${geo.unknown} unlisted` : ''}</span>
      </div>
      <div className="csl-pinfp-cols">
        <div>
          <p className="csl-eyebrow">Top states</p>
          <ul className="csl-pinfp-list">
            {top.map(([n, c]) => <li key={n}><span>{n}</span><b>{c}</b></li>)}
            {!top.length && <li className="csl-muted">None listed</li>}
          </ul>
        </div>
        <div>
          <p className="csl-eyebrow">International</p>
          <ul className="csl-pinfp-list">
            {cty.map(([n, c]) => <li key={n}><span>{n}</span><b>{c}</b></li>)}
            {!cty.length && <li className="csl-muted">None</li>}
          </ul>
        </div>
      </div>
    </div>
  )
}

/** Compact division-vs-program footprint, self-contained for mobile. */
function GeoPinCompareMobile({ div, prog, progIntl, name }) {
  const dDom = Object.values(div.states || {}).reduce((a, b) => a + b, 0)
  const dIntl = Object.values(div.countries || {}).reduce((a, b) => a + b, 0)
  const dShare = (dDom + dIntl) ? dIntl / (dDom + dIntl) : null
  const col = (title, share, states, countries, accent) => (
    <div className={`csl-mc-col${accent ? ' csl-mc-col--pin' : ''}`}>
      <div className="csl-mc-title">{title}</div>
      <div className="csl-mc-intl"><b>{share != null ? pct(share) : '—'}</b> international</div>
      <p className="csl-eyebrow">Top states</p>
      <ul className="csl-pinfp-list">
        {rankTop(states, 4).map(([n, c]) => <li key={n}><span>{n}</span><b>{c}</b></li>)}
        {!Object.keys(states || {}).length && <li className="csl-muted">—</li>}
      </ul>
      <p className="csl-eyebrow">International</p>
      <ul className="csl-pinfp-list">
        {rankTop(countries, 3).map(([n, c]) => <li key={n}><span>{n}</span><b>{c}</b></li>)}
        {!Object.keys(countries || {}).length && <li className="csl-muted">—</li>}
      </ul>
    </div>
  )
  return (
    <div className="csl-geo-mobcmp">
      <div className="csl-geo-mobcmp-h"><i className="csl-pin-dot" />Division vs <b>{name}</b> — footprint</div>
      <div className="csl-mc-cols">
        {col('Division', dShare, div.states, div.countries, false)}
        {col(name, progIntl.share, prog.states, prog.countries, true)}
      </div>
    </div>
  )
}

/** International-share comparison: division vs each pinned program (multi-pin). */
function IntlShareCompare({ divGeo, pins }) {
  const dDom = Object.values(divGeo?.states || {}).reduce((a, b) => a + b, 0)
  const dIntl = Object.values(divGeo?.countries || {}).reduce((a, b) => a + b, 0)
  const dShare = (dDom + dIntl) ? dIntl / (dDom + dIntl) : null
  const rows = [{ name: 'Division', color: '#c0c6cc', share: dShare }, ...pins.map(p => ({ name: p.name, color: p.color, share: p.intl?.share }))]
  const max = Math.max(...rows.map(r => r.share || 0), 0.0001) * 1.15
  return (
    <div className="csl-isc">
      <div className="csl-pinfp-h">International share — division vs pinned programs</div>
      {rows.map((r, i) => (
        <div className="csl-isc-row" key={i}>
          <span className="csl-isc-name" title={r.name}><i className="csl-cmp-dot" style={{ background: r.color }} />{r.name}</span>
          <span className="csl-hbar-track"><span className="csl-hbar-fill" style={{ width: r.share == null ? 0 : `${100 * r.share / max}%`, background: r.color }} /></span>
          <span className="csl-hbar-val csl-hbar-val--big">{r.share == null ? '—' : pct(r.share)}</span>
        </div>
      ))}
      <p className="csl-note">Full state/country footprints appear when a single program is pinned.</p>
    </div>
  )
}

/* -------------------------------------------------------------------- lens */

/** Compact colour key repeated inside each pinned card, so the mapping travels with the data. */
function PinLegend({ pins }) {
  if (!pins?.length) return null
  return (
    <div className="csl-pinlegend">
      {pins.map((p, i) => (
        <span key={i} className="csl-pinleg-item" style={{ color: p.color }}>
          <i style={{ background: p.color }} />{p.name}
        </span>
      ))}
    </div>
  )
}

export default function ProfileLens({ client, bench, geo, selection }) {
  const { loading, error, get } = bench
  const { division, gender, season } = selection

  const [pins, setPins] = useState([]) // [{ id, name }]
  const pinData = useLandscapePins(client, pins.map(p => p.id), season)
  const active = pins
    .map((p, i) => ({ id: p.id, name: pinData.items[i]?.school?.school || p.name, color: PIN_COLORS[i], d: pinData.items[i] }))
    .filter(a => a.d && a.d.hasSeason)
  const showPin = active.length > 0
  const geoSingle = active.length === 1 ? active[0] : null

  const addPin = (id, name) => setPins(ps => ps.length >= 3 || ps.some(p => p.id === id) ? ps : [...ps, { id, name }])
  const removePin = id => setPins(ps => ps.filter(p => p.id !== id))

  if (loading) return <div className="csl-state">Loading benchmarks…</div>
  if (error) {
    return (
      <div className="csl-state csl-state--err">
        Couldn’t load benchmarks.
        <span className="csl-state-detail">{error}</span>
      </div>
    )
  }

  const rosterRow = get('overall', 'ALL', 'roster_size')
  const heightRow = get('overall', 'ALL', 'height_inches')
  const intlRow = get('origin', 'international', 'share')
  const frRow = get('class', 'FR', 'share')
  const posShareRow = get('position', 'D', 'share')
  const classShareRow = get('class', 'FR', 'share')
  const retRow = get('overall', 'ALL', 'return_rate')

  const geoRow = geo && !geo.loading && geo.total ? { n: geo.total, agg_level: 'player' } : null
  const segmentLabel = `${divShort(division)} ${genderLabel(gender)} · ${seasonLabel(season)}`

  const positionItems = [
    { dimension: 'position', bucket: 'GK', label: 'Goalkeepers' },
    { dimension: 'position', bucket: 'D', label: 'Defenders' },
    { dimension: 'position', bucket: 'M', label: 'Midfielders' },
    { dimension: 'position', bucket: 'F', label: 'Forwards' },
  ]
  const classItems = [
    { dimension: 'class', bucket: 'FR', label: 'Freshmen' },
    { dimension: 'class', bucket: 'SO', label: 'Sophomores' },
    { dimension: 'class', bucket: 'JR', label: 'Juniors' },
    { dimension: 'class', bucket: 'SR', label: 'Seniors' },
    { dimension: 'class', bucket: 'GR', label: 'Grad' },
  ]

  const heightPins = active.map(a => ({ color: a.color, name: a.name, heightByPos: a.d.heightByPos }))
  const rosterPins = active.map(a => ({ color: a.color, name: a.name, roster: a.d.roster }))
  const posPins = active.map(a => ({ color: a.color, name: a.name, shareMap: a.d.posShare }))
  const classPins = active.map(a => ({ color: a.color, name: a.name, shareMap: a.d.classShare }))

  return (
    <div className="csl-lens">
      <div className="csl-lens-head">
        <p className="csl-eyebrow">Profile · one segment, deep</p>
        <h1 className="csl-lens-title">
          {divShort(division)} {genderLabel(gender)} <span className="csl-lens-season">· {seasonLabel(season)}</span>
        </h1>
        <PinControl
          client={client} division={division} gender={gender}
          pins={pins} colors={PIN_COLORS} max={3}
          onAdd={addPin} onRemove={removePin}
        />
      </div>

      {pins.length > 0 && (
        <div className="csl-pin-bwrap">
          {pins.map((p, i) => {
            const d = pinData.items[i]
            return (
              <span className="csl-pin-bchip" key={p.id} style={{ '--c': PIN_COLORS[i] }}>
                <i className="csl-pin-dot" style={{ background: PIN_COLORS[i] }} />
                <b>{d?.school?.school || p.name}</b>
                <span className="csl-pin-banner-sub">
                  {pinData.loading && !d?.school ? '…'
                    : d?.hasSeason ? `${d.roster} players`
                    : `no ${seasonLabel(season)} roster${d?.seasonsAvailable?.length ? ` (has ${d.seasonsAvailable.join(', ')})` : ''}`}
                </span>
              </span>
            )
          })}
        </div>
      )}

      <div className="csl-kpis">
        <div className="csl-kpi">
          <div className="csl-kpi-v csl-num">{whole(rosterRow?.median)}</div>
          <div className="csl-kpi-l">Typical roster</div>
        </div>
        <div className="csl-kpi csl-kpi--feature">
          <div className="csl-kpi-v csl-num">{inchesToFtIn(heightRow?.median)}</div>
          <div className="csl-kpi-l">Typical height</div>
        </div>
        <div className="csl-kpi">
          <div className="csl-kpi-v csl-num">{pct(intlRow?.median)}</div>
          <div className="csl-kpi-l">International (median)</div>
          {active[0] && active[0].d.intl.share != null && (
            <div className="csl-kpi-pin" style={{ color: active[0].color }}>pin {pct(active[0].d.intl.share)}</div>
          )}
        </div>
        <div className="csl-kpi">
          <div className="csl-kpi-v csl-num">{pct(frRow?.median)}</div>
          <div className="csl-kpi-l">Freshman share (median)</div>
        </div>
      </div>

      <Section id="csl-sec-size" title="Height by position" hint="Player-level distribution" row={heightRow} info={PROFILE_INFO.size}>
        {showPin && <PinLegend pins={active} />}
        <HeightByPosition get={get} pins={showPin ? heightPins : null} />
      </Section>

      <Section id="csl-sec-roster" title="Roster size" hint="Median program" row={rosterRow} info={PROFILE_INFO.roster}>
        {showPin && <PinLegend pins={active} />}
        <RosterSize get={get} pins={showPin ? rosterPins : null} />
      </Section>

      <Section id="csl-sec-position" title="Position composition" hint="Median program share" row={posShareRow} info={PROFILE_INFO.position}>
        {showPin && <PinLegend pins={active} />}
        <ShareBars items={positionItems} get={get} pins={showPin ? posPins : null} />
      </Section>

      <Section id="csl-sec-class" title="Class composition" hint="Median program share" row={classShareRow} info={PROFILE_INFO.class}>
        {showPin && <PinLegend pins={active} />}
        <ShareBars items={classItems} get={get} pins={showPin ? classPins : null} />
      </Section>

      <Section id="csl-sec-geography" title="Recruiting geography" hint="Player-level footprint" row={geoRow} info={PROFILE_INFO.geography}>
        <div className={`csl-geosec${geoSingle ? ' csl-geosec--pinned' : ''}`}>
          {geoSingle && (
            <GeoPinCompareMobile div={geo || {}} prog={geoSingle.d.geo} progIntl={geoSingle.d.intl} name={geoSingle.name} />
          )}
          {active.length > 1 && (
            <IntlShareCompare divGeo={geo} pins={active.map(a => ({ name: a.name, color: a.color, intl: a.d.intl }))} />
          )}
          <GeographyMap geo={geo} segmentLabel={segmentLabel} />
          {geoSingle && (
            <div className="csl-geosec-rail">
              <PinFootprint geo={geoSingle.d.geo} intl={geoSingle.d.intl} name={geoSingle.name} />
            </div>
          )}
        </div>
      </Section>

      <Section id="csl-sec-retention" title="Retention" hint="Season-over-season" row={retRow} info={PROFILE_INFO.retention}>
        <Retention get={get} season={season} />
      </Section>

      <footer className="csl-foot">
        <p><b>About these numbers.</b> Each figure is the <b>median program</b> in the segment (the honest
          “typical” — several shares are right-skewed, so the mean would mislead), except height, which is
          pooled at the player level. “Middle-half” is the 25th–75th percentile range.</p>
        <p>Benchmarks are aggregated from public college-athletics roster data across the tracked seasons.
          A program must carry at least nine classified players to count toward a share.</p>
      </footer>
    </div>
  )
}
