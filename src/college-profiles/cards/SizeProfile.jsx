import { inchesToFtIn } from '../data/format'

/**
 * SizeProfile — average height by position on a shared height axis. Each group
 * shows its min–max spread (band) and average (marker), so the physical profile
 * the program recruits for is visible at a glance. Descriptive; a "vs division"
 * benchmark marker can drop onto the same track later.
 */
export default function SizeProfile({ data }) {
  const { domainMin, domainMax, groups } = data || { domainMin: 60, domainMax: 76, groups: [] }
  const span = Math.max(1, domainMax - domainMin)
  const pos = v => `${(100 * (v - domainMin) / span).toFixed(1)}%`
  const width = (a, b) => `${(100 * (b - a) / span).toFixed(1)}%`

  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <h2 className="cp-h2">Size profile</h2>
        <span className="cp-hint">Average height by position — the physical profile this program recruits for</span>
      </div>

      <div className="cp-panel">
        <div className="cp-size-axis" aria-hidden="true">
          <span>{inchesToFtIn(domainMin)}</span>
          <span>{inchesToFtIn((domainMin + domainMax) / 2)}</span>
          <span>{inchesToFtIn(domainMax)}</span>
        </div>

        {groups.map(g => (
          <div className="cp-size-row" key={g.k}>
            <span className="cp-size-label">{g.label}</span>
            {g.n === 0 ? (
              <div className="cp-size-track cp-size-track--empty"><span className="cp-muted">No height data</span></div>
            ) : (
              <div className="cp-size-track">
                <span className="cp-size-band" style={{ left: pos(g.min), width: width(g.min, g.max) }} />
                <span className="cp-size-avg" style={{ left: pos(g.avg) }}>
                  <span className="cp-size-avgdot" />
                </span>
              </div>
            )}
            <span className="cp-size-read">
              {g.n === 0 ? <span className="cp-muted">—</span> : (
                <>
                  <b className="cp-num">{inchesToFtIn(g.avg)}</b>
                  <span className="cp-size-sub">n {g.n} · {inchesToFtIn(g.min)}–{inchesToFtIn(g.max)}</span>
                </>
              )}
            </span>
          </div>
        ))}

        <p className="cp-size-note">
          Band = range across the group; marker = average. Averages are descriptive — small
          groups can swing between seasons. A division benchmark overlay comes later.
        </p>
      </div>
    </section>
  )
}
