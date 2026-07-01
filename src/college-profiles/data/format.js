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
 * Clamp a cursor-anchored floating tooltip so it never runs off-screen.
 * Flips to the left of the pointer near the right edge; keeps an 8px margin.
 */
export function clampTip(x, y, w = 210, h = 48) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  let left = x + 12
  if (left + w > vw - 8) left = x - w - 12
  left = Math.max(8, Math.min(left, vw - w - 8))
  const top = Math.max(8, Math.min(y - 10, vh - h - 8))
  return { left, top }
}
