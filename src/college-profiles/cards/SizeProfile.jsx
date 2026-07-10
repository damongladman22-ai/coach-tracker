import { inchesToFtIn } from '../data/format'

/**
 * SizeProfile — height by position on a shared height axis. Each group shows the
 * program's own min–max spread (accent band) and median (accent marker). The
 * active peer group (division or conference, chosen by the global peer toggle)
 * is overlaid on the same track in neutral gray: a p25–p75 IQR band (the
 * "typical middle 50%") plus a median tick, so the program reads against its
 * peers, not just in isolation.
 *
 * Props: data (from metrics.sizeProfile), benchmark (active Scope from
 * useProgramBenchmarks | null), season (current roster season, for the
 * pooled-fallback note). Degrades to program-only when no benchmark.
 */

const POS_KEYS = ['GK', 'D', 'M', 'F']
const THIN_N = 25 // peer cells below this get a small-sample flag

function fmtDelta(d) {
  if (d == null || isNaN(d)) return ''
  const a = Math.abs(d)
  const t = Number.isInteger(a) ? a : a.toFixed(1)
  const sign = d > 0 ? '+' : d < 0 ? '\u2212' : '\u00B1'
  return `${sign}${t}"`
}

export default function SizeProfile({ data, benchmark, season }) {
  const { groups } = data || { groups: [] }
  const scope = benchmark || null
  const cellFor = k => (scope ? scope.cell('height_inches', 'position', k) : null)

  // Stable domain: union of program min/max and the peer p25/p75/median.
  let lo = Infinity, hi = -Infinity
  const consider = v => { if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v) } }
  for (const g of groups) if (g.n > 0) { consider(g.min); consider(g.max) }
  for (const k of POS_KEYS) {
    const b = cellFor(k)
    if (b) { consider(b.p25); consider(b.p75); consider(b.median) }
  }
  if (!isFinite(lo)) { lo = 60; hi = 76 } else { lo -= 1; hi += 1 }
  const span = Math.max(1, hi - lo)
  const pos = v => `${(100 * (v - lo) / span).toFixed(1)}%`
  const width = (a, b) => `${(100 * (b - a) / span).toFixed(1)}%`

  const scopeLabel = scope ? `${scope.label} ${scope.genderWord}`.trim() : ''
  let anyThin = false, anyFallback = false

  const rendered = groups.map(g => {
    const b = g.n > 0 ? cellFor(g.k) : null
    if (b && b.n < THIN_N) anyThin = true
    if (b && season != null && b.season !== season) anyFallback = true
    return { g, b }
  })

  return (
    <section className="cp-sec">
      <div className="cp-sec-h">
        <div>
          <h2 className="cp-h2">Size profile</h2>
          <span className="cp-hint">{scope
            ? `Median height by position, against the ${scopeLabel} typical range`
            : 'Median height by position — the physical profile this program recruits for'}</span>
        </div>
      </div>

      <div className="cp-panel">
        <div className="cp-size-axis" aria-hidden="true">
          <span>{inchesToFtIn(lo)}</span>
          <span>{inchesToFtIn((lo + hi) / 2)}</span>
          <span>{inchesToFtIn(hi)}</span>
        </div>

        {rendered.map(({ g, b }) => {
          const delta = b ? g.median - b.median : null
          const thin = !!b && b.n < THIN_N
          return (
            <div className="cp-size-row" key={g.k}>
              <span className="cp-size-label">{g.label}</span>
              {g.n === 0 ? (
                <div className="cp-size-track cp-size-track--empty"><span className="cp-muted">No height data</span></div>
              ) : (
                <div className="cp-size-track">
                  {b && (
                    <>
                      <span className="cp-size-bench-band" title={`${scopeLabel}: middle 50% ${inchesToFtIn(b.p25)}\u2013${inchesToFtIn(b.p75)}`}
                        style={{ left: pos(b.p25), width: width(b.p25, b.p75) }} />
                      <span className="cp-size-bench-tick" title={`${scopeLabel} median ${inchesToFtIn(b.median)} (n ${b.n.toLocaleString()})`}
                        style={{ left: pos(b.median) }} />
                    </>
                  )}
                  <span className="cp-size-band" style={{ left: pos(g.min), width: width(g.min, g.max) }} />
                  <span className="cp-size-avg" style={{ left: pos(g.median) }}>
                    <span className="cp-size-avgdot" />
                  </span>
                </div>
              )}
              <span className="cp-size-read">
                {g.n === 0 ? <span className="cp-muted">—</span> : (
                  <>
                    <b className="cp-num">{inchesToFtIn(g.median)}</b>
                    <span className="cp-size-sub">n {g.n} · {inchesToFtIn(g.min)}–{inchesToFtIn(g.max)} · avg {inchesToFtIn(g.avg)}</span>
                    {b && (
                      <span className={`cp-size-bench-read${thin ? ' cp-size-bench-read--thin' : ''}`}>
                        {scope.label} {inchesToFtIn(b.median)} · n {b.n.toLocaleString()}
                        {delta !== 0 && <span className="cp-size-delta"> {fmtDelta(delta)}</span>}
                      </span>
                    )}
                  </>
                )}
              </span>
            </div>
          )
        })}

        {scope ? (
          <p className="cp-size-note">
            <span className="cp-size-key"><span className="cp-size-key-dot" /> Program median · <span className="cp-size-key-band" /> program range</span>
            <span className="cp-size-key"><span className="cp-size-key-btick" /> {scopeLabel} median · <span className="cp-size-key-bband" /> {scopeLabel} middle 50% (p25–p75)</span>
            {anyFallback && <span className="cp-size-flag">Some cells use the pooled all-seasons benchmark where the current season is thin.</span>}
            {anyThin && <span className="cp-size-flag">Small peer samples (n &lt; {THIN_N}) — read those bands as approximate.</span>}
          </p>
        ) : (
          <p className="cp-size-note">
            Band = range across the group; marker = median. {benchmark === null ? 'A peer benchmark isn’t available for this program yet.' : ''}
          </p>
        )}
      </div>
    </section>
  )
}
