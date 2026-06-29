import '../college-profile.css'

/**
 * ProfileLocked — shown when the feature is enabled but the viewer isn't
 * entitled (Layer 2). Minimal for now; a richer premium teaser comes later.
 */
export default function ProfileLocked({ backTo = '/', backLabel = 'Back' }) {
  return (
    <div className="cp-root">
      <div className="cp-wrap">
        <div className="cp-scaffold">
          <p className="cp-eyebrow">College Profiles</p>
          <h1>Premium feature</h1>
          <p style={{ maxWidth: 520 }}>
            Detailed program profiles — roster makeup, stability, and projected
            openings — are part of the premium tier.
          </p>
          <a className="cp-back" href={backTo}>‹ {backLabel}</a>
        </div>
      </div>
    </div>
  )
}
