import { useState } from 'react'
import {
  pct, pct1, inchesToFtIn, whole, seasonLabel, genderLabel, divShort, THIN_N,
} from './data/landscapeFormat'
import GeographyMap from './GeographyMap'
import InfoTip from './InfoTip'
import PinControl from './PinControl'
import { useLandscapePin } from './data/useLandscapePin'
import { PROFILE_INFO } from './data/landscapeInfo'

/* ------------------------------------------------------------------ helpers */

function commas(n) {
  if (n == null || isNaN(n)) return '\u2014'
  return Math.round(n).toLocaleString('en-US')
}

/** n-label: "n = 347 programs" / "n = 7,988 players". */
function nLabel(row) {
  if (!row || row.n == null) return null
  const noun = row.agg_level === 'player' ? 'players' : 'programs'
  return `n = ${commas(row.n)} ${noun}`
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

/** Horizontal share bars (0–1 fractions), median fill + p25–p75 IQR overlay. */
function ShareBars({ items, get, domainMax, pin }) {
  const rows = items
    .map(it => ({
      ...it,
      row: get(it.dimension, it.bucket, it.metric || 'share'),
      count: get(it.dimension, it.bucket, 'count'),
    }))
    .filter(r => r.row)
  if (!rows.length) return <p className="csl-empty">No data for this selection.</p>

  const dmax = domainMax || Math.max(0.4, ...rows.map(r => r.row.p75 ?? r.row.median ?? 0))
  const asPct = v => `${Math.min(100, Math.max(0, (v / dmax) * 100))}%`

  return (
    <div className="csl-bars">
      {rows.map(r => {
        const med = r.row.median ?? r.row.mean ?? 0
        const lo = r.row.p25, hi = r.row.p75
        const p = pin && pin[r.bucket]
        return (
          <div className="csl-bar-row" key={r.label}>
            <span className="csl-bar-label">{r.label}</span>
            <div className="csl-bar-track">
              <div className="csl-bar-fill" style={{ width: asPct(med) }} />
              {p && p.share != null && (
                <span className="csl-pin-mark" style={{ left: asPct(p.share) }} title={`Pinned: ${pct(p.share)} · ${p.count}`} />
              )}
            </div>
            <span className="csl-bar-val">
              <b>{pct(med)}</b>
              {r.count?.median != null && <span className="csl-bar-count"> · {Math.round(r.count.median)}</span>}
              {lo != null && hi != null && <i className="csl-iqrtext"> {pct(lo)}–{pct(hi)}</i>}
              {p && p.share != null && <span className="csl-pin-val"> · pin {pct(p.share)}·{p.count}</span>}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Height-by-position: dot at median + IQR band on a fixed 60–74" axis. */
function HeightByPosition({ get, pin }) {
  const AXIS_LO = 60, AXIS_HI = 74, SPAN = AXIS_HI - AXIS_LO
  const posFor = v => `${((v - AXIS_LO) / SPAN) * 100}%`
  const posClamp = v => `${Math.min(100, Math.max(0, ((v - AXIS_LO) / SPAN) * 100))}%`
  const positions = [
    { bucket: 'GK', label: 'Goalkeepers' },
    { bucket: 'D', label: 'Defenders' },
    { bucket: 'M', label: 'Midfielders' },
    { bucket: 'F', label: 'Forwards' },
  ]
  const rows = positions
    .map(p => ({ ...p, row: get('position', p.bucket, 'height_inches') }))
    .filter(p => p.row)
  const overall = get('overall', 'ALL', 'height_inches')
  if (!rows.length && !overall) return <p className="csl-empty">No height data for this selection.</p>

  const ticks = [60, 64, 68, 72]

  return (
    <div className="csl-hbp">
      {overall && (
        <div
          className="csl-hbp-ref"
          style={{ left: posFor(overall.median ?? overall.mean) }}
          title={`All positions median ${inchesToFtIn(overall.median ?? overall.mean)}`}
        />
      )}
      {rows.map(r => {
        const med = r.row.median ?? r.row.mean
        const lo = r.row.p25, hi = r.row.p75
        const pv = pin ? pin[r.bucket] : null
        return (
          <div className="csl-hbp-row" key={r.bucket}>
            <span className="csl-bar-label">{r.label}</span>
            <div className="csl-hbp-track">
              {lo != null && hi != null && (
                <div className="csl-hbp-iqr" style={{ left: posFor(lo), width: posFor(hi - lo + AXIS_LO) }} />
              )}
              <div className="csl-hbp-dot" style={{ left: posFor(med) }} />
              {pv != null && (
                <span className="csl-pin-mark csl-pin-mark--v" style={{ left: posClamp(pv) }} title={`Pinned: ${inchesToFtIn(pv)}`} />
              )}
            </div>
            <span className="csl-bar-val">
              <b>{inchesToFtIn(med)}</b>
              {lo != null && hi != null && <i className="csl-iqrtext"> {inchesToFtIn(lo)}–{inchesToFtIn(hi)}</i>}
              {pv != null && <span className="csl-pin-val"> · pin {inchesToFtIn(pv)}</span>}
            </span>
          </div>
        )
      })}
      <div className="csl-hbp-axis">
        {ticks.map(t => (
          <span key={t} className="csl-hbp-tick" style={{ left: posFor(t) }}>{inchesToFtIn(t)}</span>
        ))}
      </div>
      {overall && (
        <p className="csl-note">
          Dashed line = all-positions median ({inchesToFtIn(overall.median ?? overall.mean)}). Bar = middle-half (25th–75th percentile) of players; dot = median.
        </p>
      )}
    </div>
  )
}

/** Roster-size spread: median + middle-half band on a 0–max axis. */
function RosterSize({ get, pin }) {
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
        {pin != null && (
          <span className="csl-pin-mark csl-pin-mark--v" style={{ left: posFor(pin) }} title={`Pinned: ${pin}`} />
        )}
        {ticks.map(t => (
          <span key={t} className="csl-spread-tick" style={{ left: posFor(t) }}>{t}</span>
        ))}
      </div>
      <p className="csl-spread-read">
        Typical program carries <b>{whole(med)}</b> players
        {lo != null && hi != null && <> — middle-half <b>{whole(lo)}–{whole(hi)}</b></>}
        {pin != null && <> · pinned program <b className="csl-pin-val">{pin}</b></>}.
      </p>
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

/* -------------------------------------------------------------------- lens */

export default function ProfileLens({ client, bench, geo, selection }) {
  const { loading, error, get } = bench
  const { division, gender, season } = selection

  const [pinnedId, setPinnedId] = useState(null)
  const [pinnedName, setPinnedName] = useState(null)
  const pin = useLandscapePin(client, pinnedId, season)
  const showPin = pinnedId && pin.hasSeason

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

  return (
    <div className="csl-lens">
      <div className="csl-lens-head">
        <p className="csl-eyebrow">Profile · one segment, deep</p>
        <h1 className="csl-lens-title">
          {divShort(division)} {genderLabel(gender)} <span className="csl-lens-season">· {seasonLabel(season)}</span>
        </h1>
        <PinControl
          client={client} division={division} gender={gender}
          pinnedId={pinnedId} pinnedName={pinnedName}
          onPin={(id, name) => { setPinnedId(id); setPinnedName(name) }}
          onClear={() => { setPinnedId(null); setPinnedName(null) }}
        />
      </div>

      {pinnedId && (
        <div className="csl-pin-banner">
          <i className="csl-pin-dot" />
          <b>{pin.school?.school || pinnedName}</b>
          <span className="csl-pin-banner-sub">
            {pin.loading ? 'loading roster…'
              : pin.error ? 'couldn’t load this program'
              : pin.hasSeason ? `${seasonLabel(season)} · ${pin.roster} players — plotted below in blue`
              : `no ${seasonLabel(season)} roster on file${pin.seasonsAvailable.length ? ` (has ${pin.seasonsAvailable.join(', ')})` : ''}`}
          </span>
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
        </div>
        <div className="csl-kpi">
          <div className="csl-kpi-v csl-num">{pct(frRow?.median)}</div>
          <div className="csl-kpi-l">Freshman share (median)</div>
        </div>
      </div>

      <Section id="csl-sec-size" title="Height by position" hint="Player-level distribution" row={heightRow} info={PROFILE_INFO.size}>
        <HeightByPosition get={get} pin={showPin ? pin.heightByPos : null} />
      </Section>

      <Section id="csl-sec-roster" title="Roster size" hint="Median program" row={rosterRow} info={PROFILE_INFO.roster}>
        <RosterSize get={get} pin={showPin ? pin.roster : null} />
      </Section>

      <Section id="csl-sec-position" title="Position composition" hint="Median program share" row={posShareRow} info={PROFILE_INFO.position}>
        <ShareBars items={positionItems} get={get} pin={showPin ? pin.posShare : null} />
      </Section>

      <Section id="csl-sec-class" title="Class composition" hint="Median program share" row={classShareRow} info={PROFILE_INFO.class}>
        <ShareBars items={classItems} get={get} pin={showPin ? pin.classShare : null} />
      </Section>

      <Section id="csl-sec-geography" title="Recruiting geography" hint="Player-level footprint" row={geoRow} info={PROFILE_INFO.geography}>
        <GeographyMap geo={geo} segmentLabel={segmentLabel} />
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
