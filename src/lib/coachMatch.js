// Same-person check used before adding a coach record.
//
// A coach who left and came back already has a record (marked inactive), with
// their attendance history hanging off it. Adding a second record splits that
// history and shows up later as a duplicate pair in Dedup Coaches. Every "add
// a coach" path should look first and switch the old record back on instead.
//
// The match is deliberately STRICT: same program (school_id), same first and
// last name after trimming, collapsing spaces and ignoring case. Two different
// people are never folded together on a near-miss spelling; those cases are
// left to Dedup Coaches. Same rule as the Coach Review page's new-coach guard.
// This file has no imports so the test suite can load it directly.

export function normNamePart(s) {
  return String(s ?? '').trim().replace(/\s+/g, ' ').toLowerCase()
}

export function coachNameKey(schoolId, firstName, lastName) {
  return `${schoolId}|${normNamePart(firstName)}|${normNamePart(lastName)}`
}

// Map of name key -> every coach record with that key.
export function indexCoachesByName(coaches) {
  const index = new Map()
  for (const c of coaches || []) {
    const key = coachNameKey(c.school_id, c.first_name, c.last_name)
    if (!index.has(key)) index.set(key, [])
    index.get(key).push(c)
  }
  return index
}

// What to do with a coach we are about to add, given the records that already
// carry the same name in the same program.
//   new       -> nobody by that name: insert
//   active    -> already listed and active: do nothing
//   inactive  -> exactly one inactive record: switch it back on
//   ambiguous -> two or more inactive records: refuse, merge them first
// is_active null counts as active (same as the rest of the app).
export function classifyNewCoach(matches) {
  const list = matches || []
  if (list.length === 0) return { status: 'new' }
  const active = list.filter(c => c.is_active !== false)
  if (active.length > 0) return { status: 'active', coach: active[0] }
  if (list.length === 1) return { status: 'inactive', coach: list[0] }
  return { status: 'ambiguous', count: list.length }
}

// Fields to copy onto a reactivated record: only ones it is missing.
export function fillMissingFields(existing, incoming) {
  const patch = {}
  for (const field of ['title', 'email', 'phone']) {
    const have = String(existing?.[field] ?? '').trim()
    const next = String(incoming?.[field] ?? '').trim()
    if (!have && next) patch[field] = next
  }
  return patch
}
