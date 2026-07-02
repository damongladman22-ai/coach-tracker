// Display helpers + catalogs for the College Soccer Landscape module.
// Shares and rates are stored as 0–1 fractions in program_benchmarks; render as %.

export const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'JC']
export const GENDERS = [
  { key: 'W', label: 'Women' },
  { key: 'M', label: 'Men' },
]

// Seasons: real years newest-first, then the pooled "All-time" sentinel (0).
export const SEASONS = [
  { key: 2025, label: '2025' },
  { key: 2024, label: '2024' },
  { key: 2023, label: '2023' },
  { key: 2022, label: '2022' },
  { key: 2021, label: '2021' },
  { key: 0, label: 'All-time' },
]

// Metric families. In Profile these act as jump anchors; in Trend/Compare they
// pick the single metric. `anchor` = the section id the control chip scrolls to.
export const FAMILIES = [
  { key: 'size', label: 'Size', anchor: 'csl-sec-size' },
  { key: 'roster', label: 'Roster size', anchor: 'csl-sec-roster' },
  { key: 'position', label: 'Position', anchor: 'csl-sec-position' },
  { key: 'class', label: 'Class', anchor: 'csl-sec-class' },
  { key: 'geography', label: 'Geography', anchor: 'csl-sec-geography' },
  { key: 'retention', label: 'Retention', anchor: 'csl-sec-retention' },
]

export function seasonLabel(s) {
  if (s === 0) return 'All-time (2021–2025)'
  return String(s)
}

export function divShort(d) {
  return d.startsWith('NCAA ') ? d.slice(5) : d
}

export function genderLabel(g) {
  return g === 'M' ? 'Men' : 'Women'
}

/** 0–1 fraction → integer percent string, e.g. 0.3022 → "30%". */
export function pct(x) {
  if (x == null || isNaN(x)) return '\u2014'
  return `${Math.round(x * 100)}%`
}

/** 0–1 fraction → one-decimal percent, e.g. 0.1255 → "12.5%". */
export function pct1(x) {
  if (x == null || isNaN(x)) return '\u2014'
  return `${(x * 100).toFixed(1)}%`
}

/** Inches → feet-inches label, e.g. 66 → 5'6". */
export function inchesToFtIn(x) {
  if (x == null || isNaN(x)) return '\u2014'
  const r = Math.round(x)
  return `${Math.floor(r / 12)}'${r % 12}"`
}

/** Round a count to a whole number for display. */
export function whole(x) {
  if (x == null || isNaN(x)) return '\u2014'
  return String(Math.round(x))
}

/** Small-sample threshold for the program-level families (per spec §4). */
export const THIN_N = 10

/**
 * Position a tooltip centered over the pointer and just above it, clamped to the
 * viewport. Flips below the pointer near the top edge.
 */
export function clampTip(x, y, w = 170, h = 40) {
  const vw = typeof window !== 'undefined' ? window.innerWidth : 1024
  const vh = typeof window !== 'undefined' ? window.innerHeight : 768
  const left = Math.max(w / 2 + 8, Math.min(x, vw - w / 2 - 8))
  let top = y - h - 12
  if (top < 8) top = y + 18
  top = Math.min(top, vh - h - 8)
  return { left, top }
}
