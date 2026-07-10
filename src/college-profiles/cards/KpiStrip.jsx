/**
 * KpiStrip — the four headline numbers. Positive framing: the underclassman
 * return-rate tile is the accent "feature" tile, leading with stability.
 * Roster size, return rate, and newcomers carry a "vs peer median" line driven
 * by the global peer toggle (division or conference); projected openings has no
 * benchmark family, so it stays a plain forward signal.
 */
const THIN_N = 25

function pct(x) {
  if (x == null) return '—'
  return (Math.round(x * 1000) / 10).toFixed(1)
}
function signInt(n) { return n > 0 ? `+${n}` : n < 0 ? `\u2212${Math.abs(n)}` : '\u00B10' }
function signPts(n) { return n > 0 ? `+${n} pts` : n < 0 ? `\u2212${Math.abs(n)} pts` : '\u00B10 pts' }

function Bench({ label, main, delta, n, thin }) {
  return (
    <div className={`cp-kpi-bm${thin ? ' cp-kpi-bm--thin' : ''}`}>
      <span>vs <b>{label}</b> {main}</span>
      {delta != null && <span className="cp-kpi-delta">{delta}</span>}
      {n != null && <span className="cp-kpi-bn">n {n.toLocaleString()}</span>}
    </div>
  )
}

export default function KpiStrip({ rosterSize, returnRate, projectedOpenings, newcomers, currentSeason, benchmark }) {
  const season = currentSeason != null ? String(currentSeason) : ''
  const range = currentSeason != null
    ? `${currentSeason}\u2013${String(currentSeason + 1).slice(-2)}`
    : ''

  const bSize = benchmark ? benchmark.cell('roster_size', 'overall', 'ALL') : null
  const bRet = benchmark ? benchmark.cell('return_rate', 'overall', 'ALL', { pooled: true }) : null
  const bNew = benchmark ? benchmark.cell('newcomer_rate', 'overall', 'ALL') : null
  const label = benchmark ? benchmark.label : ''

  const sizeMed = bSize ? Math.round(bSize.median) : null
  const newRate = rosterSize > 0 && newcomers != null ? newcomers / rosterSize : null

  return (
    <section className="cp-kpis">
      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{rosterSize}</div>
        <div className="cp-kpi-l">Players on the <b>{season} roster</b></div>
        {bSize && (
          <Bench label={label} main={`median ${sizeMed}`} n={bSize.n} thin={bSize.n < THIN_N}
            delta={rosterSize != null ? signInt(rosterSize - sizeMed) : null} />
        )}
      </div>

      <div className="cp-kpi cp-kpi--feature">
        <div className="cp-kpi-v cp-num">{pct(returnRate)}<small>%</small></div>
        <div className="cp-kpi-l">Underclassmen who <b>return</b> year-over-year</div>
        {bRet && (
          <Bench label={label} main={`median ${pct(bRet.median)}%`} n={bRet.n} thin={bRet.n < THIN_N}
            delta={returnRate != null ? signPts(Math.round((returnRate - bRet.median) * 100)) : null} />
        )}
      </div>

      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{projectedOpenings}</div>
        <div className="cp-kpi-l">Projected openings <b>after {range}</b></div>
      </div>

      <div className="cp-kpi">
        <div className="cp-kpi-v cp-num">{newcomers}</div>
        <div className="cp-kpi-l">Newcomers in the <b>{season} class</b></div>
        {bNew && newRate != null && (
          <Bench label={label} main={`median ${pct(bNew.median)}% new`} n={bNew.n} thin={bNew.n < THIN_N}
            delta={`\u2248${pct(newRate)}% here`} />
        )}
      </div>
    </section>
  )
}
