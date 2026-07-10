import { useState, useEffect } from 'react'

/**
 * Masthead — program identity header: crest, name, division · conference,
 * location, and at-a-glance tags. Brand-color theming comes from CSS vars on the
 * .cp-root wrapper (filled per-school by the host's theme prop).
 *
 * Crest: renders the school logo when a logoUrl is supplied (white circle, logo
 * contained); otherwise a monogram on the accent fill. If the logo fails to load
 * it falls back to the monogram (onError), and the fallback state resets when the
 * logoUrl changes (navigating between programs). The host gates logoUrl behind
 * the logo kill switch, so "logos off" simply means monogram everywhere.
 */
function deriveMonogram(name) {
  if (!name) return '—'
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

export default function Masthead({ school, currentRoster, seasons, lastSynced, logoUrl }) {
  const monogram = deriveMonogram(school?.school)
  const eyebrow = [school?.division, school?.conference].filter(Boolean).join(' · ')
  const loc = [school?.city, school?.state].filter(Boolean).join(', ')

  const [logoOk, setLogoOk] = useState(true)
  useEffect(() => { setLogoOk(true) }, [logoUrl])
  const showLogo = !!logoUrl && logoOk

  return (
    <header className="cp-masthead">
      <div className={`cp-crest${showLogo ? ' cp-crest--logo' : ''}`} aria-hidden={showLogo ? undefined : 'true'}>
        {showLogo
          ? <img className="cp-crest-img" src={logoUrl} alt={`${school?.school || 'Program'} logo`}
              onError={() => setLogoOk(false)} />
          : monogram}
      </div>
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
