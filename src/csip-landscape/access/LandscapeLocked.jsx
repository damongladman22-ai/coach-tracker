import '../csip-landscape.css'

/**
 * LandscapeLocked — shown when the feature is enabled but the viewer isn't
 * entitled (Layer 2). Minimal for now; a richer premium teaser comes later.
 */
export default function LandscapeLocked({ backTo = '/', backLabel = 'Back' }) {
  return (
    <div className="csl-root">
      <div className="csl-wrap">
        <div className="csl-scaffold">
          <p className="csl-eyebrow">College Soccer Landscape</p>
          <h1>Premium feature</h1>
          <p>
            Division- and conference-level intelligence — height distributions,
            roster composition, recruiting geography, and retention across
            seasons — is part of the premium tier.
          </p>
          <a className="csl-back" href={backTo}>‹ {backLabel}</a>
        </div>
      </div>
    </div>
  )
}
