/**
 * ProgramResults — the program's on-field results across the tracked seasons.
 * The headline is the latest tracked season's record (a core recruiting signal),
 * with its conference record and (D-I RPI / D-II NPI) national ranking; below it,
 * a per-season win-rate trend (W-L-T + a win% bar) that also carries each season's
 * conference record and ranking where available. Season annotations (COVID splits,
 * division reclassification) are flagged with a dagger and listed underneath.
 * Presentational only — data comes from useProgramResults. Conference and ranking
 * fields are null-safe: rows without them (D-III, unranked, or not-yet-sourced
 * seasons) simply omit those bits. Coverage-agnostic: renders nothing when the
 * program has no result rows. Data source: stats.ncaa.org.
 */
function recordStr(r) { return `${r.wins}\u2013${r.losses}\u2013${r.ties}` }
function confStr(r) { return `${r.confWins}\u2013${r.confLosses}\u2013${r.confTies}` }
function pct3(x) { return x == null ? '\u2014' : x.toFixed(3).replace(/^0(?=\.)/, '') }

// NCAA national ranking system by division: D-I uses RPI, D-II uses NPI,
// D-III is unranked. Exact match (not prefix — 'D-II' would prefix-match 'D-I').
function rankSystem(division) {
  if (division === 'D-I') return 'RPI'
  if (division === 'D-II') return 'NPI'
  return null
}

const subValStyle = { display: 'block', fontSize: '0.9em', opacity: 0.72, fontWeight: 400, marginTop: 3 }

export default function ProgramResults({ rows }) {
  if (!rows || rows.length === 0) return null

  const ordered = [...rows].sort((a, b) => a.season - b.season)
  const latest = ordered[ordered.length - 1]
  const byRecent = [...ordered].reverse()
  const distinctNotes = [...new Set(ordered.filter(r => r.notes).map(r => r.notes))]

  const latestSys = rankSystem(latest.division)
  const showLatestConf = latest.confWins != null
  const showLatestRank = latest.rpiRank != null && latestSys

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

        {(showLatestConf || showLatestRank) && (
          <div style={{ marginTop: 8, display: 'flex', gap: 18, flexWrap: 'wrap', fontSize: '0.95em', lineHeight: 1.5 }}>
            {showLatestConf && (
              <span>
                <span style={{ opacity: 0.6 }}>Conference </span>
                <span className="cp-num">{confStr(latest)}</span>
                {latest.confWinPct != null && (
                  <span className="cp-num" style={{ opacity: 0.6 }}> ({pct3(latest.confWinPct)})</span>
                )}
              </span>
            )}
            {showLatestRank && (
              <span>
                <span style={{ opacity: 0.6 }}>{latestSys} </span>
                <span className="cp-num">#{latest.rpiRank}</span>
              </span>
            )}
          </div>
        )}
      </div>

      <div className="cp-trend">
        <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Record by season</p>
        {byRecent.map(r => {
          const sys = rankSystem(r.division)
          return (
            <div className="cp-trend-row" key={r.season}>
              <span className="cp-trend-lab">
                {r.season}
                {r.notes ? <span className="cp-perf-mark" title={r.notes}>&nbsp;&dagger;</span> : null}
              </span>
              <span className="cp-perf-rowrec cp-num">
                {recordStr(r)}
                {r.confWins != null && (
                  <span className="cp-num" style={subValStyle}>{confStr(r)} conf</span>
                )}
              </span>
              <div className="cp-track"><div className="cp-fill" style={{ width: `${(r.winPct || 0) * 100}%` }} /></div>
              <span className="cp-trend-pc cp-num">
                {pct3(r.winPct)}
                {r.rpiRank != null && sys && (
                  <span className="cp-num" style={subValStyle}>{sys} #{r.rpiRank}</span>
                )}
              </span>
            </div>
          )
        })}
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
