/**
 * Shared timezone vocabulary.
 *
 * Before this module the seven-entry list lived in two screens and the matching
 * abbreviation map in six places — twice inside TeamGames.jsx alone — all
 * byte-identical. A constant that must agree across screens and is copied by
 * hand is a constant that eventually does not agree.
 */

export const TIMEZONES = [
  { value: 'America/New_York', label: 'Eastern (ET)' },
  { value: 'America/Chicago', label: 'Central (CT)' },
  { value: 'America/Denver', label: 'Mountain (MT)' },
  { value: 'America/Phoenix', label: 'Arizona (MST)' },
  { value: 'America/Los_Angeles', label: 'Pacific (PT)' },
  { value: 'America/Anchorage', label: 'Alaska (AKT)' },
  { value: 'Pacific/Honolulu', label: 'Hawaii (HT)' },
]

const ABBREVIATIONS = {
  'America/New_York': 'ET',
  'America/Chicago': 'CT',
  'America/Denver': 'MT',
  'America/Phoenix': 'MST',
  'America/Los_Angeles': 'PT',
  'America/Anchorage': 'AKT',
  'Pacific/Honolulu': 'HT',
}

/** Short label for an IANA zone, or '' when unknown. Returning '' rather than
 *  the raw zone name preserves the previous behaviour at every call site. */
export function getTimezoneAbbr(timezone) {
  return ABBREVIATIONS[timezone] || ''
}

export const DEFAULT_TIMEZONE = 'America/New_York'
