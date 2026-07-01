/**
 * Masthead — program identity header: monogram crest, name, division · conference,
 * location, and at-a-glance tags. Brand-color theming comes from CSS vars on the
 * .cp-root wrapper (a per-school theme map fills these later); the logo slot is a
 * future drop-in. No logo in v1 — monogram + colorway only.
 */
function deriveMonogram(name) {
  if (!name) return '—'
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

export default function Masthead({ school, currentRoster, seasons, lastSynced }) {
  const monogram = deriveMonogram(school?.school)
  const eyebrow = [school?.division, school?.conference].filter(Boolean).join(' · ')
  const loc = [school?.city, school?.state].filter(Boolean).join(', ')

  return (
    <header className="cp-masthead">
      <div className="cp-crest" aria-hidden="true">{monogram}</div>
      <div className="cp-mast-body">
        {eyebrow && <p className="cp-mast-eyebrow">{eyebrow}</p>}
        <h1 className="cp-mast-title">{school?.school}</h1>
        <p className="cp-mast-meta">
          {loc}
          {school?.athletics_url && (
            <> · <a href={school.athletics_url} target="_blank" rel="noreferrer">Athletics site ↗</a></>
          )}
        </p>
        <div className="cp-tags">
          <span className="cp-tag"><b>{currentRoster?.length ?? 0}</b> active players</span>
          <span className="cp-tag"><b>{seasons?.length ?? 0}</b> seasons tracked</span>
          {lastSynced && <span className="cp-tag">Last synced <b>{lastSynced}</b></span>}
        </div>
      </div>
    </header>
  )
}
