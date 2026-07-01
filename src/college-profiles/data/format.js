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
