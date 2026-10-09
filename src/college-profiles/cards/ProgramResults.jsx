import { standing, headlineLines, rowText, inProgress } from '../data/resultsStanding'

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
 *
 * Peer standing (backlog G2, 2026-10-09): where each season's record stands
 * among the peer group picked by the page's "Compared against" switch:
 *   division    "Better record than 96% of D1 Women"
 *   conference  "3rd-best record of 18 in the Big Ten" and, when conference
 *               records exist, "2nd-best conference record of 18"
 * The national ranking reads "#5 of 347". Rules live in data/resultsStanding.js.
 * Peer data (usePeerResults) arrives after the card renders; until then, or if
 * it fails, the card shows exactly what it showed before.
 *
 * Props: rows, schoolId, peers (index from usePeerResults, or null),
 *        scope ('div' | 'conf'), genderWord ('Women' | 'Men')
 */
function recordStr(r) { return `${r.wins}–${r.losses}–${r.ties}` }
function confStr(r) { return `${r.confWins}–${r.confLosses}–${r.confTies}` }
function pct3(x) { return x == null ? '—' : x.toFixed(3).replace(/^0(?=\.)/, '') }

// NCAA national ranking system by division: D-I uses RPI, D-II and D-III use
// the NCAA Power Index (NPI). Exact match (not prefix — 'D-II' would
// prefix-match 'D-I'). Only D-I RPI is stored as of 2026-10-07; an NPI rank
// shows here as soon as one is loaded.
function rankSystem(division) {
  if (division === 'D-I') return 'RPI'
  if (division === 'D-II' || division === 'D-III') return 'NPI'
  return null
}

const subValStyle = { display: 'block', fontSize: '0.9em', opacity: 0.72, fontWeight: 400, marginTop: 3 }
const standLineStyle = { fontSize: 13.5, lineHeight: 1.45, color: 'var(--ink)', fontWeight: 600 }
const standNoteStyle = { fontWeight: 400, color: 'var(--slate)' }
const rowStandStyle = { fontSize: 11.5, color: 'var(--slate)', marginTop: 4, lineHeight: 1.3 }

export default function ProgramResults({ rows, schoolId = null, peers = null, scope = 'div', genderWord = '' }) {
  if (!rows || rows.length === 0) return null

  const ordered = [...rows].sort((a, b) => a.season - b.season)
  const latest = ordered[ordered.length - 1]
  const byRecent = [...ordered].reverse()
  const distinctNotes = [...new Set(ordered.filter(r => r.notes).map(r => r.notes))]

  const standOf = r => (peers && schoolId ? standing(schoolId, r.season, peers, scope) : null)
  const labelOf = st => `${st?.division || ''} ${genderWord}`.trim()

  const latestSys = rankSystem(latest.division)
  const latestStand = standOf(latest)
  const showLatestConf = latest.confWins != null
  const showLatestRank = latest.rpiRank != null && latestSys
  const lines = headlineLines(latestStand, labelOf(latestStand))
  const soFar = inProgress(latest.season)

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
          <b>{latest.season}</b> record{soFar ? ' so far' : ''} (W&ndash;L&ndash;T)
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
                {latestStand?.rankOf != null && (
                  <span className="cp-num" style={{ opacity: 0.6 }}> of {latestStand.rankOf}</span>
                )}
              </span>
            )}
          </div>
        )}

        {lines.length > 0 && (
          <div style={{ marginTop: 10 }}>
            {lines.map((l, i) => (
              <div key={i} style={l.muted ? { ...standLineStyle, ...standNoteStyle } : standLineStyle}>
                {l.text}
                {l.note && <span style={standNoteStyle}> ({l.note})</span>}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="cp-trend">
        <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Record by season</p>
        {byRecent.map(r => {
          const sys = rankSystem(r.division)
          const st = standOf(r)
          // Name the peer group only where this season's differs from the headline's.
          const stand = rowText(st,
            st && latestStand && st.division !== latestStand.division ? labelOf(st) : null,
            !!r.conference && r.conference !== latest.conference)
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
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="cp-track"><div className="cp-fill" style={{ width: `${(r.winPct || 0) * 100}%` }} /></div>
                {stand && <div style={rowStandStyle}>{stand}</div>}
              </div>
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
