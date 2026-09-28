import { useState } from 'react'
import { clampTip } from '../data/format'

/**
 * RosterBuild — how each season's newcomers arrive: as freshmen, or with
 * college experience. Item 2 of the transfer-display plan (2026-09-28).
 *
 * TWO LEVELS, deliberately.
 *   1. Freshmen against experienced, from class year on the roster rows the
 *      page already loads (`newcomerMix`). Covers every program. This is the
 *      headline, compared against the `experienced_newcomer_rate` peer median.
 *   2. Of the experienced, the origins we can CONFIRM, from
 *      program_transfer_summary. Confirmed origins cover roughly one in five
 *      experienced newcomers (measured 2026-09-28), so they are shown as a
 *      breakdown of what is known — never as the whole picture.
 * A flat three-way split would make "origin unconfirmed" the largest slice on
 * nearly every program and bury the finding.
 *
 * TWO SEGMENTS, NOT FIVE. On the page's class ramp, SR and GR fail the
 * normal-vision separation floor side by side (ΔE 13.2), so the SO/JR/SR/GR
 * breakdown is carried as labelled counts rather than adjacent fills. FR
 * against SR clears it at ΔE 48.5. The pale FR fill is under 3:1 against the
 * card, so both segments carry their label inside and the bar has an outline.
 *
 * Reading the peer comparison: above the peer p75 reads as "more than most",
 * below p25 as "fewer than most", and between as typical — the distribution
 * decides, not a fixed number of points.
 */
const DIV_LABEL = {
  'NCAA D1': 'NCAA D1', 'NCAA D2': 'NCAA D2', 'NCAA D3': 'NCAA D3',
  NAIA: 'NAIA', JC: 'Junior college', NCCAA: 'NCCAA', USCAA: 'USCAA',
}
const THIN = 10          // fewer newcomers than this and the share is noisy
const LABEL_MIN = 0.2    // a segment narrower than this carries no inside label

function pct0(x) { return x == null ? '—' : Math.round(x * 100) }
function signPts(n) { return n > 0 ? `+${n} pts` : n < 0 ? `−${Math.abs(n)} pts` : '±0 pts' }
function spanLabel(span) {
  if (!span) return ''
  return span[0] === span[1] ? `${span[0]}` : `${span[0]}–${String(span[1]).slice(-2)}`
}

export default function RosterBuild({ mix, transfers, span, benchmark }) {
  const [tip, setTip] = useState(null)
  const p = mix?.pooled
  const transitions = (mix?.transitions || []).filter(t => t.known > 0)

  const head = (
    <div className="cp-sec-h">
      <h2 className="cp-h2">How the roster is built</h2>
      <span className="cp-hint">Where each season’s newcomers come from — freshmen, or players arriving with college experience</span>
    </div>
  )

  if (!p || !p.known) {
    return (
      <section className="cp-sec">
        {head}
        <div className="cp-panel">
          <p className="cp-panel-desc" style={{ margin: 0 }}>
            Not enough consecutive seasons are tracked for this program yet to show where its newcomers come from.
          </p>
        </div>
      </section>
    )
  }

  const share = p.share
  const expPct = pct0(share)
  const frPct = 100 - expPct
  const thin = p.known < THIN

  const b = benchmark ? benchmark.cell('experienced_newcomer_rate', 'overall', 'ALL', { pooled: true }) : null
  const scopeLabel = benchmark ? `${benchmark.label} ${benchmark.genderWord}`.trim() : ''

  let read = null
  if (b && share != null && !thin) {
    if (share > b.p75) read = <>Leans on players with college experience <b>more than most {scopeLabel} programs</b>.</>
    else if (share < b.p25) read = <>Gives <b>more of its new spots to freshmen</b> than most {scopeLabel} programs.</>
    else read = <>In the <b>typical range</b> for {scopeLabel} programs.</>
  }

  // Level 2 — confirmed origins of arrivals, within the census window.
  const inRows = (transfers || []).filter(r => r.direction === 'in')
  const byDiv = {}
  for (const r of inRows) byDiv[r.counterpart_division] = (byDiv[r.counterpart_division] || 0) + r.n
  const origins = Object.entries(byDiv)
    .map(([d, n]) => ({ d, label: DIV_LABEL[d] || d, n }))
    .sort((x, y) => y.n - x.n || x.label.localeCompare(y.label))
  const confirmed = origins.reduce((s, o) => s + o.n, 0)
  const maxO = Math.max(1, ...origins.map(o => o.n))
  const inWindow = span ? transitions.filter(t => t.to >= span[0] && t.to <= span[1]) : []
  const expInWindow = inWindow.reduce((s, t) => s + t.experienced, 0)

  const showTip = (e, label, detail) => setTip({ x: e.clientX, y: e.clientY, label, detail })
  const hideTip = () => setTip(null)

  return (
    <section className="cp-sec">
      {head}
      <div className="cp-panel">
        <div className="cp-stab-big">
          <span className="cp-stab-v cp-num">{expPct}</span>
          <span className="cp-stab-pct cp-num">%</span>
        </div>
        <div className="cp-stab-sub">
          of newcomers <b>arrived with college experience</b> — {p.experienced.toLocaleString()} of {p.known.toLocaleString()} across {transitions.length} season{transitions.length === 1 ? '' : 's'}.
        </div>

        {b && (
          <div className="cp-stab-bench">
            vs <b>{scopeLabel}</b> median <b className="cp-num">{pct0(b.median)}%</b>
            {!thin && <span className="cp-stab-delta">{signPts(expPct - pct0(b.median))}</span>}
            <span className="cp-stab-bn">n {b.n.toLocaleString()}</span>
          </div>
        )}

        <div className="cp-build-viz">
          {b && (
            <div className="cp-build-peer" aria-hidden="true">
              <span className="cp-build-peer-band"
                style={{ left: `${b.p25 * 100}%`, width: `${Math.max(0, b.p75 - b.p25) * 100}%` }} />
              <span className="cp-build-peer-tick" style={{ left: `${b.median * 100}%` }} />
            </div>
          )}
          <div className="cp-build-bar" role="img"
            aria-label={`${expPct}% of newcomers arrived with college experience, ${frPct}% as freshmen`}>
            {p.experienced > 0 && (
              <span className="cp-build-seg cp-build-seg--exp" style={{ flexGrow: p.experienced }}
                onMouseMove={e => showTip(e, 'Experienced', `${p.experienced} newcomers · ${expPct}%`)}
                onMouseLeave={hideTip}>
                {share >= LABEL_MIN && <>Experienced <b>{expPct}%</b></>}
              </span>
            )}
            {p.fr > 0 && (
              <span className="cp-build-seg cp-build-seg--fr" style={{ flexGrow: p.fr }}
                onMouseMove={e => showTip(e, 'Freshmen', `${p.fr} newcomers · ${frPct}%`)}
                onMouseLeave={hideTip}>
                {1 - share >= LABEL_MIN && <>Freshmen <b>{frPct}%</b></>}
              </span>
            )}
          </div>
          {b && (
            <div className="cp-build-key">
              <span><i className="k-tick" />{scopeLabel} median</span>
              <span><i className="k-band" />Middle half of {scopeLabel} programs</span>
            </div>
          )}
        </div>

        {read && <p className="cp-build-read">{read}</p>}
        {thin && <p className="cp-build-thin">Small sample — only {p.known} newcomers tracked, so this share can move a lot season to season.</p>}

        {p.experienced > 0 && (
          <p className="cp-build-classes">
            Of the {p.experienced} experienced newcomer{p.experienced === 1 ? '' : 's'}:{' '}
            {[['SO', p.so], ['JR', p.jr], ['SR', p.sr], ['GR', p.gr]].map(([k, v], i) => (
              <span className="cp-build-cls" key={k}>{i > 0 && ' · '}<b>{k}</b> {v}</span>
            ))}
            {p.gr > 0 && <span className="cp-build-gr"> — GR are graduate transfers, usually here for one season</span>}
          </p>
        )}

        <div className="cp-build-grid">
          <div>
            <p className="cp-eyebrow" style={{ marginBottom: 8 }}>Experienced share by season</p>
            {transitions.map(t => (
              <div className="cp-trend-row" key={t.to}>
                <span className="cp-trend-lab">{t.to} class</span>
                <div className="cp-track"
                  onMouseMove={e => showTip(e, `${t.to} newcomers`, `${t.experienced} experienced · ${t.fr} freshmen`)}
                  onMouseLeave={hideTip}>
                  <div className="cp-fill" style={{ width: `${(t.share || 0) * 100}%` }} />
                </div>
                <span className="cp-trend-pc cp-num">{pct0(t.share)}%</span>
              </div>
            ))}
          </div>

          <div>
            <p className="cp-eyebrow" style={{ marginBottom: 8 }}>
              Confirmed origins{span ? `, ${spanLabel(span)}` : ''}
            </p>
            {origins.length > 0 ? (
              <>
                {origins.map(o => (
                  <div className="cp-build-orow" key={o.d}
                    onMouseMove={e => showTip(e, `From ${o.label}`, `${o.n} confirmed transfer${o.n === 1 ? '' : 's'}`)}
                    onMouseLeave={hideTip}>
                    <span className="cp-build-olab">{o.label}</span>
                    <div className="cp-build-otrack"><div className="cp-build-ofill" style={{ width: `${100 * o.n / maxO}%` }} /></div>
                    <span className="cp-build-on">{o.n}</span>
                  </div>
                ))}
                <p className="cp-build-note">
                  {confirmed} confirmed transfer{confirmed === 1 ? '' : 's'}
                  {confirmed < expInWindow
                    ? <> against {expInWindow} experienced newcomer{expInWindow === 1 ? '' : 's'} in those seasons. The rest came from
                      programs or countries we do not track, or through moves we have not verified.</>
                    : <> in those seasons.</>}
                </p>
              </>
            ) : (
              <p className="cp-build-note">No confirmed transfer origins for this program yet. The experienced share above still holds — it comes from class year, not from transfer records.</p>
            )}
          </div>
        </div>
      </div>

      {tip && (() => {
        const pos = clampTip(tip.x, tip.y)
        return (
          <div className="cp-floattip" style={{ left: pos.left, top: pos.top, transform: 'translateX(-50%)' }}>
            <b>{tip.label}</b> · {tip.detail}
          </div>
        )
      })()}
    </section>
  )
}
