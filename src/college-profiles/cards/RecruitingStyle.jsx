import { styleRows } from '../data/recruitingStyle'

/**
 * RecruitingStyle — backlog G8, recruiting-strategy patterns (Damon,
 * 2026-10-09: a College Profile card first). Four plain labels, each read
 * against the page's peer group (the division / conference toggle), plus a
 * shift line when the program has clearly moved toward or away from
 * transfers in its two newest seasons, beyond its peers' own drift.
 *
 * Every number comes from the card that already shows it (Arrivals,
 * Geography, Roster stability), computed the same way, so this card only
 * names what the page measures. Rules and thresholds: data/recruitingStyle.js.
 *
 * Each tile carries a small band (the peers' middle half, p25-p75) with a
 * dot for this program, the same visual language as the Geography card.
 */
function pct0(x) { return x == null ? '—' : Math.round(x * 100) }
function span(s) {
  if (!s) return ''
  return s[0] === s[1] ? `${s[0]}` : `${s[0]}–${String(s[1]).slice(-2)}`
}

function Band({ value, cell }) {
  const max = Math.min(1, Math.max(0.05, value || 0, cell.p75) + 0.05)
  const pos = v => `${(100 * v / max).toFixed(1)}%`
  return (
    <div className="cp-cb-track cp-style-track" aria-hidden="true">
      <span className="cp-size-bench-band" style={{ left: pos(cell.p25), width: `${(100 * (cell.p75 - cell.p25) / max).toFixed(1)}%` }} />
      <span className="cp-size-bench-tick" style={{ left: pos(cell.median) }} />
      <span className="cp-cb-dot" style={{ left: pos(value) }} />
    </div>
  )
}

export default function RecruitingStyle({ mix, inState, intl, returnRate, benchmark, schoolState, shift }) {
  const rows = styleRows({ mix, inState, intl, returnRate, scope: benchmark, schoolState })
  const scopeLabel = benchmark ? `${benchmark.label} ${benchmark.genderWord}`.trim() : ''
  if (rows.every(r => r.value == null)) return null

  return (
    <section className="cp-panel cp-style">
      <h3 className="cp-panel-h">Recruiting style</h3>
      <p className="cp-panel-desc">
        How this program builds its roster{scopeLabel ? <>, read against <b>{scopeLabel}</b> programs</> : null}.
        On each bar the shaded band is the middle half of those programs and the line is their median;
        a highlighted tile is outside that middle half.
      </p>

      <div className="cp-style-grid">
        {rows.map(r => (
          <div key={r.key} className={'cp-style-tile' + (r.band && r.band !== 'typical' ? ' cp-style-tile--marked' : '')}>
            <p className="cp-eyebrow">{r.title}</p>
            <p className={'cp-style-label' + (r.value == null || !r.band ? ' cp-style-label--na' : '')}>{r.label}</p>
            {r.value != null && (
              <p className="cp-style-detail">
                <b className="cp-num">{pct0(r.value)}%</b> {r.detail}
                {r.cell && <span className="cp-muted"> · typical {pct0(r.cell.p25)}–{pct0(r.cell.p75)}%</span>}
              </p>
            )}
            {r.value != null && r.cell && <Band value={r.value} cell={r.cell} />}
          </div>
        ))}
      </div>

      {shift && (
        <p className="cp-style-shift">
          <b>{shift.dir === 'toward' ? 'Shifting toward transfers.' : 'Shifting toward freshmen.'}</b>{' '}
          In {span(shift.recentSpan)}, <b className="cp-num">{pct0(shift.recent)}%</b> of its newcomers had college
          experience, against <b className="cp-num">{pct0(shift.earlier)}%</b> in {span(shift.earlierSpan)}.
          {scopeLabel ? ` ${scopeLabel} programs moved from ${pct0(shift.peerEarlier)}% to ${pct0(shift.peerRecent)}% over the same seasons.` : ''}
        </p>
      )}
    </section>
  )
}
