import { useState } from 'react'
import './csip-landscape.css'
import ControlBar from './ControlBar'
import ProfileLens from './ProfileLens'
import { useLandscapeBenchmarks } from './data/useLandscapeBenchmarks'
import { FAMILIES } from './data/landscapeFormat'

/**
 * CSIPLandscape — the portable module entry point for the College Soccer Landscape.
 *
 * Props (all injected; no PitchSide imports): client, theme, backTo, backLabel.
 *
 * Holds the shared selection (division × gender × season × family × lens), runs
 * the benchmark data hook against it, and renders the active lens. The control
 * bar is persistent; selection survives lens switches (spec §3).
 *
 * v1: Profile lens is live. Compare / Trend render a "coming next" panel within
 * the same shell so the architecture is in place without dead ends.
 */
const DEFAULT_SELECTION = {
  division: 'NCAA D1',
  gender: 'W',
  season: 2025,
  family: 'size',
  lens: 'profile',
}

export default function CSIPLandscape({ client, theme, backTo = '/', backLabel = 'Back' }) {
  const [selection, setSelection] = useState(DEFAULT_SELECTION)
  const set = patch => setSelection(s => ({ ...s, ...patch }))

  const bench = useLandscapeBenchmarks(client, {
    division: selection.division,
    gender: selection.gender,
    season: selection.season,
  })

  const onFamily = key => {
    set({ family: key })
    if (selection.lens === 'profile') {
      const f = FAMILIES.find(x => x.key === key)
      if (f) {
        const el = typeof document !== 'undefined' && document.getElementById(f.anchor)
        if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
      }
    }
  }

  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

  return (
    <div className="csl-root" style={styleVars}>
      <div className="csl-wrap">
        <a className="csl-back" href={backTo}>‹ {backLabel}</a>

        <ControlBar selection={selection} set={set} onFamily={onFamily} />

        {selection.lens === 'profile' && (
          <ProfileLens bench={bench} selection={selection} />
        )}

        {selection.lens === 'compare' && (
          <div className="csl-soon">
            <p className="csl-eyebrow">Compare · many segments, side by side</p>
            <h2 className="csl-h2">Coming next</h2>
            <p>Pick 2–4 segments and see every metric as small-multiples. Your current selection is kept.</p>
          </div>
        )}

        {selection.lens === 'trend' && (
          <div className="csl-soon">
            <p className="csl-eyebrow">Trend · over time</p>
            <h2 className="csl-h2">Coming next</h2>
            <p>Track one metric across 2021–2025. Your current selection is kept.</p>
          </div>
        )}
      </div>
    </div>
  )
}
