/**
 * KpiStrip — the four headline numbers. Positive framing: the underclassman
 * return-rate tile is the accent "feature" tile, leading with stability.
 */
function pct(x) {
  if (x == null) return '—'
  return (Math.round(x * 1000) / 10).toFixed(1)
}

export default function KpiStrip({ rosterSize, returnRate, projectedOpenings, newcomers, currentSeason }) {
  const season = currentSeason != null ? String(currentSeason) : ''
  const range = currentSeason != null
    ? `${currentSeason}\u2013${String(currentSeason + 1).slice(-2)}`
    : ''
  return (
    <section className="cp-kpis">
      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{rosterSize}</div>
        <div className="cp-kpi-l">Players on the <b>{season} roster</b></div>
      </div>
      <div className="cp-kpi cp-kpi--feature">
        <div className="cp-kpi-v cp-num">{pct(returnRate)}<small>%</small></div>
        <div className="cp-kpi-l">Underclassmen who <b>return</b> year-over-year</div>
      </div>
      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{projectedOpenings}</div>
        <div className="cp-kpi-l">Projected openings <b>after {range}</b></div>
      </div>
      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{newcomers}</div>
        <div className="cp-kpi-l">Newcomers in the <b>{season} class</b></div>
      </div>
    </section>
  )
}
