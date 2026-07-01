// Display helpers for College Profiles. Location uses the normalized columns
// (hometown_state / hometown_country) per the spec: U.S. → "City, State",
// international → "City, Country". Falls back to the raw hometown string.

const US = new Set(['United States', 'USA', 'US', 'U.S.', 'U.S.A.'])

export function hometownLabel(row) {
  if (!row) return ''
  const city = (row.hometown_city || '').trim()
  const state = (row.hometown_state || '').trim()
  const country = (row.hometown_country || '').trim()

  const intl = country && !US.has(country)
  const tail = intl ? country : state
  if (city && tail) return `${city}, ${tail}`
  if (city) return city
  if (tail) return tail
  return (row.hometown || '').trim()
}

/**
 * Position a tooltip centered over the pointer and just above it, clamped to the
 * viewport. Rendered with transform: translateX(-50%) so it hugs the selection
 * (works for mouse hover and touch). Flips below the pointer near the top edge.
 */
export function clampTip(x, y, w = 150, h = 42) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  const left = Math.max(w / 2 + 8, Math.min(x, vw - w / 2 - 8))
  let top = y - h - 12
  if (top < 8) top = y + 18
  top = Math.min(top, vh - h - 8)
  return { left, top }
}

/** Inches -> feet-inches label, e.g. 69 -> 5'9". */
export function inchesToFtIn(x) {
  if (x == null || isNaN(x)) return '\u2014'
  const r = Math.round(x)
  return `${Math.floor(r / 12)}'${r % 12}"`
}
