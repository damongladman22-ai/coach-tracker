/**
 * schoolBranding.js — per-school branding for College Profiles.
 *
 * Portable + self-contained (imports NO PitchSide internals), matching the
 * module's baked-asset pattern.
 *
 * LOGOS (convention, July 2026): every school's mark lives on the public logos
 * bucket keyed by its schools.id — `${LOGO_BASE}/{schools.id}.svg?v={version}`. The bucket
 * was bulk-populated from ncaa.com's official school assets (1,018 of 1,022
 * NCAA institutions; see the pipeline's map_school_logos.py + its
 * logo_mapping_review.csv for the audit trail). brandingFor() therefore builds
 * the logo URL for EVERY school by convention — no per-school registry. If the
 * file doesn't exist (a handful of NCAA schools without an ncaa.com asset;
 * NAIA/JC pending a manual pass), the request 404s and every consumer's
 * onError handler falls back to the monogram crest, so nothing breaks.
 * Adding a logo = uploading one file named {schools.id}.svg. No code change.
 *
 * THEMES (curated map): the four pilot schools, hand-curated. This map is now
 * the OVERRIDE tier, not the source: it is consulted first and wins, so a
 * hand-picked colorway is never displaced by a derived one.
 *
 * themeFromSchool(school) is the source for everyone else. It reads the
 * schools row the profile ALREADY fetches (useProgramProfile does select('*')),
 * so a colorway costs no extra request and nothing in the JS bundle:
 *   brand_accent     the brand colour  (2,652 schools, Sept 2026)
 *   brand_accent_on  '#FFFFFF' or '#15191C' -- which text is legible ON it
 *   brand_accent_2   the secondary, where one was found
 *   brand_source     'site' | 'logo' | 'manual'
 * 'site' values are the school's own <meta name="theme-color">; 'logo' values
 * are the dominant colour of its ncaa.com mark by painted pixel area. Where
 * both existed they agreed on hue 86% of the time.
 *
 * accentDeep and accentTint are DERIVED here rather than stored, because they
 * are pure functions of the accent and storing them would let them drift.
 *
 * Separation of concerns: this file is DATA only. The host decides whether to
 * apply the logo (the logo kill switch); the colorway always applies.
 */

const LOGO_BASE = 'https://pub-5a9a6178bdd845018e2dc75442615bde.r2.dev'

/* R2 serves these with Cache-Control: public, max-age=604800 — a seven-day TTL,
   flagged in the Decision Log (17 July 2026) as meaning "a correction to an
   already-viewed logo lags up to a week", with cache-busting named as the fix
   and deferred. 12 September 2026 is when it bit: all 2,071 marks were re-cropped
   to their true artwork bounds and re-uploaded, the CDN served the new file
   immediately, and browsers kept painting the old one. A hard reload does not
   reliably revalidate a CROSS-ORIGIN subresource, so there was no way for a
   viewer to pull the correction.

   Bump this whenever the bucket's contents change. The URL becomes a new cache
   key, so every viewer gets the new asset on their next load and the TTL keeps
   doing its job in between. */
const LOGO_VERSION = '20260912'

const THEMES = {
  // Ohio State University (W) — scarlet / gray
  '9e2f6cff-becf-4f3d-a3bb-5f4e1aead383': {
    accent: '#BB0000', accentDeep: '#8C0000', accentTint: '#FBE9E9',
  },
  // Bryant University (M) — black / gold (gold carried as the tint)
  'ab409a88-5f60-4a57-8dce-f1b084048fb0': {
    accent: '#111111', accentDeep: '#000000', accentTint: '#F4EEDE',
  },
  // Gardner-Webb University (M) — red / white
  '869003e8-842c-4ea7-9fed-4894497e999b': {
    accent: '#BB0000', accentDeep: '#8C0000', accentTint: '#FBE9E9',
  },
  // University of St. Thomas – Minnesota (M) — purple / gray
  '2deadc71-3706-4319-89de-1ff146488dec': {
    accent: '#510C76', accentDeep: '#3B0857', accentTint: '#EFE8F4',
  },
}

/**
 * brandingFor(schoolId) → { theme, logoUrl } | null
 *   theme   → the curated colorway, or null (caller falls back to defaults)
 *   logoUrl → convention URL for every school; consumers' onError fallback
 *             covers ids with no uploaded file
 */
export function brandingFor(schoolId) {
  if (!schoolId) return null
  return {
    theme: THEMES[schoolId] || null,
    logoUrl: `${LOGO_BASE}/${schoolId}.svg?v=${LOGO_VERSION}`,
  }
}


/* ---- derived shades -------------------------------------------------- */

function parseHex(hex) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return null
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

const toHex = (rgb) =>
  '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v)))
    .toString(16).padStart(2, '0')).join('').toUpperCase()

/* Relative luminance, WCAG 2.x. */
function luminance(rgb) {
  const [r, g, b] = rgb.map((v) => {
    const c = v / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

const contrast = (a, b) => {
  const la = luminance(a), lb = luminance(b)
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)
}

/* --accent-deep is used as TEXT ON WHITE (back link, eyebrow, meta links), so
   it genuinely has to clear 4.5:1 there. Step the accent down until it does,
   then a little further so it reads as a deeper shade and not the same colour. */
function deepen(rgb) {
  let cur = rgb
  for (let i = 0; i < 40 && contrast(cur, [255, 255, 255]) < 4.5; i++) {
    cur = cur.map((v) => v * 0.94)
  }
  return cur.map((v) => v * 0.88)
}

/* --accent-tint is a near-white wash of the accent, for chip and band fills. */
const tintOf = (rgb) => rgb.map((v) => v + (255 - v) * 0.92)

/**
 * softOf(hex) -> 'rgba(r, g, b, 0.18)' for focus rings and chip halos.
 * Exported so a caller holding only a curated { accent } can derive it too.
 */
export function softOf(hex) {
  const rgb = parseHex(hex)
  return rgb ? `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)` : null
}

/**
 * themeFromSchool(schoolRow) -> { accent, accentOn, accentDeep, accentTint, accent2, accentSoft } | null
 *
 * Returns null when the row carries no brand_accent, which leaves the module's
 * neutral CSS defaults in place. Never throws on a malformed value: a hex that
 * does not parse is treated as absent.
 */
export function themeFromSchool(school) {
  const rgb = parseHex(school?.brand_accent)
  if (!rgb) return null
  const on = parseHex(school?.brand_accent_on)
  const two = parseHex(school?.brand_accent_2)
  return {
    accent: toHex(rgb),
    accentOn: on ? toHex(on) : '#FFFFFF',
    accentDeep: toHex(deepen(rgb)),
    accentTint: toHex(tintOf(rgb)),
    accent2: two ? toHex(two) : null,
    accentSoft: softOf(toHex(rgb)),
  }
}
