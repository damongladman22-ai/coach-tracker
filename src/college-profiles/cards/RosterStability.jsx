import { useState } from 'react'
import { clampTip } from '../data/format'
import { transitionPeer } from '../data/peerOverlays'

/**
 * RosterStability — the program's underclassman retention, positive framing.
 * Big return-rate number, per-transition trend bars, and the early-departure
 * note underneath (never the headline). When a peer group is selected, the
 * headline carries a "vs peer median" line (pooled all-seasons, matching the
 * multi-year-average framing of the headline number).
 *
 * WHERE EARLY LEAVERS WENT (item 3 of the transfer-display plan, 2026-09-29).
 * Of the players who left early inside the transfer census window, how many
 * are TRACED to another college program the next season. Everyone else is
 * "not on any roster we track" — never "left". Only about 1 in 6 early
 * leavers can be traced (measured 2026-09-30, after the name-only transfers
 * were written; it was 1 in 11 on 2026-09-29, claude/Early_Departures_
 * Mostly_Untraced_20260929.md), so the traced count is a floor, and the
 * wording says "at least". Both counts come from program_early_departures, so
 * they always describe the same players.
 *
 * TWO-YEAR PROGRAMS. At a two-year college only first-years still have
 * eligibility, so the wording follows `twoYear` (isTwoYearProgram: a JC whose
 * own rosters look two-year), and the numbers do too (nonSeniorReturnRate and
 * program_early_departures share that definition).
 *
 * PER-SEASON PEER TICKS (backlog G4, 2026-10-09): each season's return-rate
 * bar carries a thin tick at that season's peer median (the benchmark row for
 * the arrival season, never the pooled one) and the median in words, so one
 * weak year shows against its peers rather than only inside the average. The
 * bar itself clips (overflow hidden), so the tick sits in a wrapper above it.
 * A season with fewer than 5 peer programs gets no tick.
 */
const PEER_MIN = 5       // the benchmark only counts program-seasons with >= 5 leavers
const THIN_N = 25        // peer cells below this many programs read dimmed, as on the other overlays
const tickStyle = { position: 'absolute', top: -3, bottom: -3, width: 2, marginLeft: -1, background: 'var(--slate)', borderRadius: 2 }
const tickCapStyle = { fontSize: 11.5, color: 'var(--slate)', marginTop: 4, lineHeight: 1.3 }
const LABEL_MIN = 0.2    // a segment narrower than this carries no inside label

function pct1(x) { return x == null ? '—' : (Math.round(x * 1000) / 10).toFixed(1) }
function pct0(x) { return x == null ? '—' : Math.round(x * 100) }
function signPts(n) { return n > 0 ? `+${n} pts` : n < 0 ? `−${Math.abs(n)} pts` : '±0 pts' }
function seasonsLabel(ss) {
  if (!ss.length) return ''
  if (ss.length === 1) return `the ${ss[0]} season`
  return `the ${ss.slice(0, -1).join(', ')} and ${ss[ss.length - 1]} seasons`
}

export default function RosterStability({ stats, benchmark, departures, twoYear = false }) {
  const [tip, setTip] = useState(null)
  const rate = stats?.rate
  const transitions = stats?.transitions || []
  const early = stats?.earlyDeparture
  const isJC = twoYear
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
          {transitions.map(t => {
            const pt = transitionPeer(benchmark?.seasonCell, t)
            const thin = !!pt && pt.n < THIN_N
            return (
              <div className="cp-trend-row" key={t.from}>
                <span className="cp-trend-lab">{t.from} → {t.to}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ position: 'relative' }}>
                    <div className="cp-track"><div className="cp-fill" style={{ width: `${t.rate * 100}%` }} /></div>
                    {pt && (
                      <span style={{ ...tickStyle, left: `${(pt.median * 100).toFixed(1)}%` }}
                        title={`${scopeLabel} median ${pct0(pt.median)}% in ${t.to} (n ${pt.n.toLocaleString()})`} />
                    )}
                  </div>
                  {pt && (
                    <div style={thin ? { ...tickCapStyle, opacity: 0.72, fontStyle: 'italic' } : tickCapStyle}>
                      {scopeLabel} median {pct0(pt.median)}%
                    </div>
                  )}
                </div>
                <span className="cp-trend-pc cp-num">{pct0(t.rate)}%</span>
              </div>
            )
          })}
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
                aria-label={`${leavers} ${who} left: at least ${moved} traced to another program, ${untraced} not on any roster we track`}>
                {moved > 0 && (
                  <span className="cp-build-seg cp-build-seg--exp" style={{ flexGrow: moved }}
                    onMouseMove={e => showTip(e, 'Traced to another program', `${moved} of ${leavers}`)}
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
                  ? <>At least <b>{moved}</b> {moved === 1 ? 'is' : 'are'} traced to another college program the next season.</>
                  : <>None is traced to another college program yet.</>}
                {untraced > 0 && <>{' '}{moved > 0 ? `The other ${untraced}` : (untraced === 1 ? 'That player' : `All ${untraced}`)} {untraced === 1 ? 'is' : 'are'} not on any roster we track — they may have stopped playing, gone abroad, or moved to a program we do not cover.</>}
              </p>
              {pb && (
                <p className="cp-went-peer">
                  {pb.median > 0
                    ? <>The median <b>{scopeLabel}</b> program has <b className="cp-num">{pct0(pb.median)}%</b> of its early leavers traced elsewhere; this program has <b className="cp-num">{pct0(movedShare)}%</b>.</>
                    : moved === 0
                      ? <>That is common: at least half of <b>{scopeLabel}</b> programs have none of their early leavers traced elsewhere either.</>
                      : <>At least half of <b>{scopeLabel}</b> programs have none of their early leavers traced elsewhere; this program has <b className="cp-num">{pct0(movedShare)}%</b>.</>}
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
