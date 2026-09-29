import { useState } from 'react'
import { clampTip } from '../data/format'

/**
 * RosterStability — the program's underclassman retention, positive framing.
 * Big return-rate number, per-transition trend bars, and the early-departure
 * note underneath (never the headline). When a peer group is selected, the
 * headline carries a "vs peer median" line (pooled all-seasons, matching the
 * multi-year-average framing of the headline number).
 *
 * WHERE EARLY LEAVERS WENT (item 3 of the transfer-display plan, 2026-09-29).
 * Of the players who left early inside the transfer census window, how many
 * are CONFIRMED at another college program the next season. Everyone else is
 * "not on any roster we track" — never "left". Only about 1 in 11 early
 * leavers can be confirmed (measured 2026-09-29, claude/Early_Departures_
 * Mostly_Untraced_20260929.md), so the confirmed count is a floor, and the
 * wording says "at least". Both counts come from program_early_departures, so
 * they always describe the same players.
 *
 * JC. At a two-year college only first-years still have eligibility, so the
 * wording follows `division`, and the numbers do too (nonSeniorReturnRate and
 * the table share that definition).
 */
const PEER_MIN = 5       // the benchmark only counts program-seasons with >= 5 leavers
const LABEL_MIN = 0.2    // a segment narrower than this carries no inside label

function pct1(x) { return x == null ? '—' : (Math.round(x * 1000) / 10).toFixed(1) }
function pct0(x) { return x == null ? '—' : Math.round(x * 100) }
function signPts(n) { return n > 0 ? `+${n} pts` : n < 0 ? `−${Math.abs(n)} pts` : '±0 pts' }
function seasonsLabel(ss) {
  if (!ss.length) return ''
  if (ss.length === 1) return `the ${ss[0]} season`
  return `the ${ss.slice(0, -1).join(', ')} and ${ss[ss.length - 1]} seasons`
}

export default function RosterStability({ stats, benchmark, departures, division }) {
  const [tip, setTip] = useState(null)
  const rate = stats?.rate
  const transitions = stats?.transitions || []
  const early = stats?.earlyDeparture
  const isJC = division === 'JC'
  const who = isJC ? 'first-year players' : 'underclassmen'

  const b = benchmark ? benchmark.cell('return_rate', 'overall', 'ALL', { pooled: true }) : null
  const scopeLabel = benchmark ? `${benchmark.label} ${benchmark.genderWord}`.trim() : ''

  let depLine = null
  if (early != null && early > 0) {
    // "1 in N" only reads true up to half. Past that it would say "1 in 2"
    // for a program losing 5 in 6, so the count switches to tenths.
    const tenths = Math.round(early * 10)
    const lead = early <= 0.5 ? 'Roughly' : tenths >= 10 ? 'Nearly' : 'About'
    const count = early <= 0.5
      ? `1 in ${Math.max(2, Math.round(1 / early))}`
      : tenths >= 10 ? 'all' : `${tenths} in 10`
    depLine = isJC
      ? <>{lead} <b>{count} first-year players</b> are not back for their second season, counted from cross-season roster tracking.</>
      : <>{lead} <b>{count} underclassmen</b> leave before their senior year — transfers or other departures, counted from cross-season roster tracking.</>
  } else if (early === 0) {
    depLine = <>Virtually no {who} left early across the tracked seasons.</>
  }

  // Where early leavers went — census window only, both counts from one table.
  const rows = departures || []
  const seasons = rows.map(r => r.from_season)
  const leavers = rows.reduce((s, r) => s + r.leavers, 0)
  const moved = rows.reduce((s, r) => s + r.moved_on, 0)
  const untraced = leavers - moved
  const movedShare = leavers > 0 ? moved / leavers : null
  const pb = benchmark && leavers >= PEER_MIN
    ? benchmark.cell('early_leaver_moved_on_rate', 'overall', 'ALL', { pooled: true })
    : null

  const showTip = (e, label, detail) => setTip({ x: e.clientX, y: e.clientY, label, detail })
  const hideTip = () => setTip(null)

  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Roster stability</h3>
      <p className="cp-panel-desc">How well the program retains its {who}.</p>

      <div className="cp-stab-big">
        <span className="cp-stab-v cp-num">{pct1(rate)}</span>
        <span className="cp-stab-pct cp-num">%</span>
      </div>
      <div className="cp-stab-sub">
        of <b>{isJC ? 'first-year players return' : 'non-senior players return'}</b> the following season, averaged across tracked years.
      </div>

      {b && rate != null && (
        <div className="cp-stab-bench">
          vs <b>{scopeLabel}</b> median <b className="cp-num">{pct1(b.median)}%</b>
          <span className="cp-stab-delta">{signPts(Math.round((rate - b.median) * 100))}</span>
          <span className="cp-stab-bn">n {b.n.toLocaleString()}</span>
        </div>
      )}

      {transitions.length > 0 && (
        <div className="cp-trend">
          <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Return rate by season</p>
          {transitions.map(t => (
            <div className="cp-trend-row" key={t.from}>
              <span className="cp-trend-lab">{t.from} → {t.to}</span>
              <div className="cp-track"><div className="cp-fill" style={{ width: `${t.rate * 100}%` }} /></div>
              <span className="cp-trend-pc cp-num">{pct0(t.rate)}%</span>
            </div>
          ))}
        </div>
      )}

      {depLine && <div className="cp-dep">{depLine}</div>}

      {rows.length > 0 && (
        <div className="cp-went">
          <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Where early leavers went</p>
          {leavers === 0 ? (
            <p className="cp-build-note" style={{ marginTop: 0 }}>
              No {who} left after {seasonsLabel(seasons)}.
            </p>
          ) : (
            <>
              <div className="cp-build-bar cp-went-bar" role="img"
                aria-label={`${leavers} ${who} left: at least ${moved} confirmed at another program, ${untraced} not on any roster we track`}>
                {moved > 0 && (
                  <span className="cp-build-seg cp-build-seg--exp" style={{ flexGrow: moved }}
                    onMouseMove={e => showTip(e, 'Confirmed at another program', `${moved} of ${leavers}`)}
                    onMouseLeave={hideTip}>
                    {movedShare >= LABEL_MIN && <>Moved on <b>{moved}</b></>}
                  </span>
                )}
                {untraced > 0 && (
                  <span className="cp-build-seg cp-build-seg--fr" style={{ flexGrow: untraced }}
                    onMouseMove={e => showTip(e, 'Not on any roster we track', `${untraced} of ${leavers}`)}
                    onMouseLeave={hideTip}>
                    {1 - movedShare >= LABEL_MIN && <>Not traced <b>{untraced}</b></>}
                  </span>
                )}
              </div>
              <p className="cp-build-note">
                <b>{leavers}</b> {leavers === 1 ? (isJC ? 'first-year player' : 'underclassman') : who} left after {seasonsLabel(seasons)}.{' '}
                {moved > 0
                  ? <>At least <b>{moved}</b> {moved === 1 ? 'is' : 'are'} confirmed at another college program the next season.</>
                  : <>None is confirmed at another college program yet.</>}
                {untraced > 0 && <>{' '}{moved > 0 ? `The other ${untraced}` : (untraced === 1 ? 'That player' : `All ${untraced}`)} {untraced === 1 ? 'is' : 'are'} not on any roster we track — they may have stopped playing, gone abroad, or moved to a program we do not cover.</>}
              </p>
              {pb && (
                <p className="cp-went-peer">
                  {pb.median > 0
                    ? <>The median <b>{scopeLabel}</b> program has <b className="cp-num">{pct0(pb.median)}%</b> of its early leavers confirmed elsewhere; this program has <b className="cp-num">{pct0(movedShare)}%</b>.</>
                    : moved === 0
                      ? <>That is common: at least half of <b>{scopeLabel}</b> programs have none of their early leavers confirmed elsewhere either.</>
                      : <>At least half of <b>{scopeLabel}</b> programs have none of their early leavers confirmed elsewhere; this program has <b className="cp-num">{pct0(movedShare)}%</b>.</>}
                </p>
              )}
            </>
          )}
        </div>
      )}

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y, 190)
        return (
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b>{tip.label}</b> · {tip.detail}
          </div>
        )
      })()}
    </div>
  )
}
