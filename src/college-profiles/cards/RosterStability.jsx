/**
 * RosterStability — the program's underclassman retention, positive framing.
 * Big return-rate number, per-transition trend bars, and the early-departure
 * note underneath (never the headline). When a peer group is selected, the
 * headline carries a "vs peer median" line (pooled all-seasons, matching the
 * multi-year-average framing of the headline number).
 */
function pct1(x) { return x == null ? '—' : (Math.round(x * 1000) / 10).toFixed(1) }
function pct0(x) { return x == null ? '—' : Math.round(x * 100) }
function signPts(n) { return n > 0 ? `+${n} pts` : n < 0 ? `\u2212${Math.abs(n)} pts` : '\u00B10 pts' }

export default function RosterStability({ stats, benchmark }) {
  const rate = stats?.rate
  const transitions = stats?.transitions || []
  const early = stats?.earlyDeparture

  const b = benchmark ? benchmark.cell('return_rate', 'overall', 'ALL', { pooled: true }) : null
  const scopeLabel = benchmark ? `${benchmark.label} ${benchmark.genderWord}`.trim() : ''

  let depLine = null
  if (early != null && early > 0) {
    const ratio = Math.max(2, Math.round(1 / early))
    depLine = <>Roughly <b>1 in {ratio} underclassmen</b> leave before their senior year — transfers or other departures, counted from cross-season roster tracking.</>
  } else if (early === 0) {
    depLine = <>Virtually no underclassmen left early across the tracked seasons.</>
  }

  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Roster stability</h3>
      <p className="cp-panel-desc">How well the program retains its underclassmen.</p>

      <div className="cp-stab-big">
        <span className="cp-stab-v cp-num">{pct1(rate)}</span>
        <span className="cp-stab-pct cp-num">%</span>
      </div>
      <div className="cp-stab-sub">of <b>non-senior players return</b> the following season, averaged across tracked years.</div>

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
    </div>
  )
}
