/**
 * schoolBranding.js — per-school brand overrides for College Profiles.
 *
 * Portable + self-contained (imports NO PitchSide internals), matching the
 * module's baked-asset pattern. Keyed by schools.id (the DB uuid). Each entry:
 *   theme → { accent, accentDeep, accentTint } → fills the .cp-root CSS vars
 *   logo  → the file name of the school's mark on the public logos bucket
 *
 * Colors come from each school's own athletics site (authoritative); logos are
 * the school's published header mark, re-hosted on our bucket (never hotlinked).
 *
 * Separation of concerns: this file is DATA only. The host decides whether to
 * apply the logo (the logo kill switch); the colorway always applies. A school
 * not in this map returns null → the module falls back to its default colorway
 * and the monogram crest, so un-branded programs render fine.
 *
 * Pilot set (v1): 4 programs. To add a school: upload its logo to the bucket
 * and add a row here keyed by its schools.id. To move off the r2.dev dev URL to
 * a custom domain later, change LOGO_BASE only — nothing else.
 */

const LOGO_BASE = 'https://pub-5a9a6178bdd845018e2dc75442615bde.r2.dev'

const BRANDING = {
  // Ohio State University (W) — scarlet / gray
  '9e2f6cff-becf-4f3d-a3bb-5f4e1aead383': {
    theme: { accent: '#BB0000', accentDeep: '#8C0000', accentTint: '#FBE9E9' },
    logo: 'ohio-state.svg',
  },
  // Bryant University (M) — black / gold (gold carried as the tint)
  'ab409a88-5f60-4a57-8dce-f1b084048fb0': {
    theme: { accent: '#111111', accentDeep: '#000000', accentTint: '#F4EEDE' },
    logo: 'bryant.png',
  },
  // Gardner-Webb University (M) — red / white
  '869003e8-842c-4ea7-9fed-4894497e999b': {
    theme: { accent: '#BB0000', accentDeep: '#8C0000', accentTint: '#FBE9E9' },
    logo: 'gardner-webb.svg',
  },
  // University of St. Thomas – Minnesota (M) — purple / gray
  '2deadc71-3706-4319-89de-1ff146488dec': {
    theme: { accent: '#510C76', accentDeep: '#3B0857', accentTint: '#EFE8F4' },
    logo: 'st-thomas-mn.svg',
  },
}

/**
 * brandingFor(schoolId) → { theme, logoUrl } | null
 * Returns null for any school not in the map (caller falls back to defaults).
 */
export function brandingFor(schoolId) {
  const entry = schoolId && BRANDING[schoolId]
  if (!entry) return null
  return {
    theme: entry.theme,
    logoUrl: entry.logo ? `${LOGO_BASE}/${entry.logo}` : null,
  }
}
