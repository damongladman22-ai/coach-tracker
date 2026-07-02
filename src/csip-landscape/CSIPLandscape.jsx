import './csip-landscape.css'

/**
 * CSIPLandscape — the portable module entry point for the College Soccer Landscape.
 *
 * Props (all injected; no PitchSide imports):
 *   client   — Supabase client (reads program_benchmarks / program_benchmark_bins
 *              backdrop + college_rosters for pinned programs)
 *   theme    — optional { accent, accentDeep, accentTint } colorway override
 *   backTo   — href for the back link
 *   backLabel— label for the back link
 *
 * STEP 1 (scaffold): renders a styled "Module mounted" placeholder so the route,
 * gate, and scoped CSS can be verified live before the control bar and the three
 * lenses (Profile / Compare / Trend) are built out.
 */
export default function CSIPLandscape({ client, theme, backTo = '/', backLabel = 'Back' }) {
  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

  return (
    <div className="csl-root" style={styleVars}>
      <div className="csl-wrap">
        <a className="csl-back" href={backTo}>‹ {backLabel}</a>
        <div className="csl-scaffold">
          <p className="csl-eyebrow">CSIP · College Soccer Intelligence Platform</p>
          <h1>College Soccer Landscape</h1>
          <p>
            Division- and conference-level intelligence — height distributions by
            position, roster composition, recruiting geography, roster size, and
            retention — time-aware across 2021–2025, comparable across segments,
            with any program pinnable onto the backdrop.
          </p>
          <p>
            Control bar and the three lenses (Profile · Compare · Trend) build out
            from here.
          </p>
          <span className="csl-badge"><i />Module mounted</span>
        </div>
      </div>
    </div>
  )
}
