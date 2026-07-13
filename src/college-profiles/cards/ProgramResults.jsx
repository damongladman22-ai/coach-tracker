/**
 * ProgramResults — the program's on-field results across the tracked seasons.
 * The headline is the latest tracked season's record (a core recruiting signal);
 * below it, a per-season win-rate trend (W-L-T + a win% bar). Season annotations
 * (COVID splits, division reclassification) are flagged with a dagger and listed
 * underneath. Presentational only — data comes from useProgramResults.
 * Coverage-agnostic: renders nothing when the program has no result rows.
 * Data source: stats.ncaa.org.
 */
function recordStr(r) { return `${r.wins}\u2013${r.losses}\u2013${r.ties}` }
function pct3(x) { return x == null ? '\u2014' : x.toFixed(3).replace(/^0(?=\.)/, '') }

export default function ProgramResults({ rows }) {
  if (!rows || rows.length === 0) return null

  const ordered = [...rows].sort((a, b) => a.season - b.season)
  const latest = ordered[ordered.length - 1]
  const byRecent = [...ordered].reverse()
  const distinctNotes = [...new Set(ordered.filter(r => r.notes).map(r => r.notes))]

  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Program performance</h3>
      <p className="cp-panel-desc">On-field results across the tracked seasons.</p>

      <div className="cp-perf-head">
        <div className="cp-perf-big">
          <span className="cp-perf-rec cp-num">{recordStr(latest)}</span>
          <span className="cp-perf-pct cp-num">{pct3(latest.winPct)}</span>
        </div>
        <div className="cp-perf-sub">
          <b>{latest.season}</b> record (W&ndash;L&ndash;T)
          {latest.conference ? <> &middot; {latest.conference}</> : null}
        </div>
      </div>

      <div className="cp-trend">
        <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Record by season</p>
        {byRecent.map(r => (
          <div className="cp-trend-row" key={r.season}>
            <span className="cp-trend-lab">
              {r.season}
              {r.notes ? <span className="cp-perf-mark" title={r.notes}>&nbsp;&dagger;</span> : null}
            </span>
            <span className="cp-perf-rowrec cp-num">{recordStr(r)}</span>
            <div className="cp-track"><div className="cp-fill" style={{ width: `${(r.winPct || 0) * 100}%` }} /></div>
            <span className="cp-trend-pc cp-num">{pct3(r.winPct)}</span>
          </div>
        ))}
      </div>

      {distinctNotes.length > 0 && (
        <div className="cp-dep">
          {distinctNotes.map((n, i) => (
            <div key={i}><b>&dagger;</b> {n}</div>
          ))}
        </div>
      )}
    </div>
  )
}
