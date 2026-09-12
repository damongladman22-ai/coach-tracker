import { useState, useEffect } from 'react'

/**
 * Masthead — program identity header: crest, name, division · conference,
 * location, and at-a-glance tags. Brand-color theming comes from CSS vars on the
 * .cp-root wrapper (filled per-school by the host's theme prop).
 *
 * Crest: renders the school logo when a logoUrl is supplied; otherwise a
 * monogram on the accent fill. If the logo fails to load it falls back to the
 * monogram (onError), and the fallback state resets when the logoUrl changes
 * (navigating between programs). The host gates logoUrl behind the logo kill
 * switch, so "logos off" simply means monogram everywhere.
 *
 * THE CONTAINER ADAPTS TO THE MARK, not the other way round. The ncaa.com
 * assets are not one shape: measured across all 2,111 of them on 12 Sept 2026,
 * 71.6% are squarish (0.7-1.45:1), 20.2% are wide, 5.5% are wider than 2.2:1
 * and 2.7% are tall. A circle is right for the first group and destroys the
 * rest -- object-fit:contain fits a 3:1 wordmark to the 46px content width and
 * renders it ~14px tall, which reads as a smudge (Worcester State was the
 * reported case). So the natural aspect ratio is measured on load and anything
 * past WIDE_RATIO gets a rectangular box it can actually fill. Making the
 * circle bigger does not help: no circle holds a 3:1 wordmark.
 *
 * Aspect is only known after the image loads, so the crest starts round and
 * settles. That is deliberate -- guessing from the URL would be a guess.
 */

/* Above this width:height the circle costs more than it buys. 1.45 sits in the
   gap between the squarish cluster (median 1.15) and the wide tail (p90 1.86). */
const WIDE_RATIO = 1.45
function deriveMonogram(name) {
  if (!name) return '—'
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

const GENDER_LABEL = { W: "Women's Soccer", M: "Men's Soccer" }

export default function Masthead({ school, currentRoster, seasons, logoUrl, rosterUrl, homeUrl }) {
  const monogram = deriveMonogram(school?.school)
  const genderLabel = GENDER_LABEL[school?.program_gender] || null
  const eyebrow = [school?.division, school?.conference, genderLabel].filter(Boolean).join(' · ')
  const loc = [school?.city, school?.state].filter(Boolean).join(', ')
  const home = homeUrl || school?.athletics_url || null

  const [logoOk, setLogoOk] = useState(true)
  const [aspect, setAspect] = useState(null)
  useEffect(() => { setLogoOk(true); setAspect(null) }, [logoUrl])
  const showLogo = !!logoUrl && logoOk
  const wideMark = showLogo && aspect !== null && aspect >= WIDE_RATIO

  const handleLoad = (e) => {
    const { naturalWidth: w, naturalHeight: h } = e.currentTarget
    if (w > 0 && h > 0) setAspect(w / h)
  }

  return (
    <header className="cp-masthead">
      <div
        className={`cp-crest${showLogo ? ' cp-crest--logo' : ''}${wideMark ? ' cp-crest--wide' : ''}`}
        aria-hidden={showLogo ? undefined : 'true'}
      >
        {showLogo
          ? <img className="cp-crest-img" src={logoUrl} alt={`${school?.school || 'Program'} logo`}
              onLoad={handleLoad} onError={() => setLogoOk(false)} />
          : monogram}
      </div>
      <div className="cp-mast-body">
        {eyebrow && <p className="cp-mast-eyebrow">{eyebrow}</p>}
        <h1 className="cp-mast-title">{school?.school}</h1>
        <p className="cp-mast-meta">
          {loc}
          {rosterUrl && (
            <> · <a href={rosterUrl} target="_blank" rel="noreferrer">Roster ↗</a></>
          )}
          {home && (
            <> · <a href={home} target="_blank" rel="noreferrer">Athletics site ↗</a></>
          )}
        </p>
        <div className="cp-tags">
          <span className="cp-tag"><b>{currentRoster?.length ?? 0}</b> active players</span>
          <span className="cp-tag"><b>{seasons?.length ?? 0}</b> seasons tracked</span>
        </div>
      </div>
    </header>
  )
}
