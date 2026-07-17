/**
 * schoolBranding.js — per-school branding for College Profiles.
 *
 * Portable + self-contained (imports NO PitchSide internals), matching the
 * module's baked-asset pattern.
 *
 * LOGOS (convention, July 2026): every school's mark lives on the public logos
 * bucket keyed by its schools.id — `${LOGO_BASE}/{schools.id}.svg`. The bucket
 * was bulk-populated from ncaa.com's official school assets (1,018 of 1,022
 * NCAA institutions; see the pipeline's map_school_logos.py + its
 * logo_mapping_review.csv for the audit trail). brandingFor() therefore builds
 * the logo URL for EVERY school by convention — no per-school registry. If the
 * file doesn't exist (a handful of NCAA schools without an ncaa.com asset;
 * NAIA/JC pending a manual pass), the request 404s and every consumer's
 * onError handler falls back to the monogram crest, so nothing breaks.
 * Adding a logo = uploading one file named {schools.id}.svg. No code change.
 *
 * THEMES (curated map): brand colorways stay hand-curated per school, keyed by
 * schools.id, sourced from each school's own athletics site (authoritative).
 * A school not in the map gets the module's default colorway. To theme a new
 * school: add a row here.
 *
 * Separation of concerns: this file is DATA only. The host decides whether to
 * apply the logo (the logo kill switch); the colorway always applies.
 */

const LOGO_BASE = 'https://pub-5a9a6178bdd845018e2dc75442615bde.r2.dev'

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
    logoUrl: `${LOGO_BASE}/${schoolId}.svg`,
  }
}
