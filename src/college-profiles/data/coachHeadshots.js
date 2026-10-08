import { useEffect, useState } from 'react'

/**
 * Coach headshots (backlog F13; approved 2026-07-18 with an owner kill switch).
 *
 * The photos are 240x240 JPEGs in the pitchside-logos R2 bucket, one per coach
 * in public.coach_photos (coach_id -> image_key), published by the pipeline's
 * harvest_coach_photos.py from the school's own athletics site.
 *
 * THE SWITCH. Nothing shows unless platform_settings.coach_headshots_enabled
 * is 'true' (the college_profiles_logos_enabled pattern): while it is off this
 * module never even asks for coach_photos, and every surface looks exactly as
 * it did before headshots existed. A missing row or a read error reads as off.
 *
 * ONE SHARED STORE. A Coach Directory page or an event summary renders dozens
 * of coaches at once. Each avatar registers its coach id; the ids gathered in
 * the same tick are fetched in ONE request (150 per request), and every answer,
 * including "no photo", is remembered for the session.
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 */
const BASE = 'https://pub-5a9a6178bdd845018e2dc75442615bde.r2.dev'
const SWITCH_KEY = 'coach_headshots_enabled'
const CHUNK = 150

let enabled = null              // null = not read yet
let switchLoad = null
const urls = new Map()          // coachId -> url | null
const queued = new Set()
let flushTimer = null
let flushClient = null
const listeners = new Set()

function notify() { listeners.forEach(fn => fn()) }

function loadSwitch(client) {
  if (!switchLoad) {
    switchLoad = Promise.resolve(
      client.from('platform_settings').select('value').eq('key', SWITCH_KEY).maybeSingle()
    ).then(({ data, error }) => { enabled = !error && data?.value === 'true' })
      .catch(() => { enabled = false })
      .then(notify)
  }
  return switchLoad
}

async function flush() {
  flushTimer = null
  const client = flushClient
  const ids = [...queued]
  queued.clear()
  for (let i = 0; i < ids.length; i += CHUNK) {
    const chunk = ids.slice(i, i + CHUNK)
    try {
      const { data, error } = await client.from('coach_photos')
        .select('coach_id, image_key').in('coach_id', chunk)
      if (error) throw error
      const got = new Map((data || []).map(r => [r.coach_id, `${BASE}/${r.image_key}`]))
      for (const id of chunk) urls.set(id, got.get(id) || null)
    } catch {
      for (const id of chunk) urls.set(id, null)   // fail quietly: initials stay
    }
  }
  notify()
}

function request(client, coachId) {
  if (!coachId || urls.has(coachId) || queued.has(coachId)) return
  flushClient = client
  queued.add(coachId)
  if (!flushTimer) flushTimer = setTimeout(flush, 0)
}

/** The coach's photo URL, or null (switch off, no photo, or still loading). */
export function useCoachHeadshot(client, coachId) {
  const [, rerender] = useState(0)
  useEffect(() => {
    if (!client || !coachId) return undefined
    let live = true
    const onChange = () => { if (live) rerender(n => n + 1) }
    listeners.add(onChange)
    loadSwitch(client).then(() => { if (live && enabled) request(client, coachId) })
    return () => { live = false; listeners.delete(onChange) }
  }, [client, coachId])
  if (!enabled || !coachId) return null
  return urls.get(coachId) || null
}
