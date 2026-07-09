import { useEffect, useMemo, useState } from 'react'

/**
 * useLandscapePins — like useLandscapePin but for up to a few programs at once.
 * Loads each school's active roster in parallel (schools + college_rosters), then
 * computes each program's values for the selected season client-side. Metric
 * definitions match college-profiles/data/metrics.js.
 *
 * Returns: { loading, error, items:[{ school, seasonsAvailable, hasSeason,
 *   roster, heightByPos, posShare, classShare, intl, geo }] } aligned to `ids`.
 */
export const PIN_COLORS = ['#1b5fd0', '#e08600', '#7a3aa7']

const US_NAMES = new Set(['United States', 'USA', 'US', 'U.S.', 'U.S.A.'])
const POS = ['GK', 'D', 'M', 'F']
const CLASSES = ['FR', 'SO', 'JR', 'SR', 'GR']
const SEASONS = [2021, 2022, 2023, 2024, 2025]

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function quantile(sorted, q) {
  if (!sorted.length) return null
  const pos = (sorted.length - 1) * q
  const b = Math.floor(pos)
  const rest = pos - b
  return sorted[b + 1] !== undefined ? sorted[b] + rest * (sorted[b + 1] - sorted[b]) : sorted[b]
}

/** Median + IQR height per position for a set of rows (for the Compare ridge whisker). */
function heightDistByPos(rows) {
  const out = {}
  for (const p of POS) {
    const vals = rows.filter(r => r.position === p && r.height_inches != null).map(r => r.height_inches).sort((a, b) => a - b)
    out[p] = vals.length ? { median: quantile(vals, 0.5), p25: quantile(vals, 0.25), p75: quantile(vals, 0.75), n: vals.length } : null
  }
  return out
}

/** Latest-season snapshot for the Compare lens: a program as one entrant. */
function computeSnapshot(school, rosters) {
  const seasons = [...new Set(rosters.map(r => r.roster_season))].sort((a, b) => a - b)
  const latest = seasons.length ? seasons[seasons.length - 1] : null
  if (latest == null) return null
  const base = computeProgram(school, rosters, latest)
  const rows = rosters.filter(r => r.roster_season === latest)
  const { returnRate, newcomerRate } = retentionSeries(rosters)
  return {
    ...base,
    season: latest,
    heightDist: heightDistByPos(rows),
    returnRate: returnRate.length ? returnRate[returnRate.length - 1] : null,
    newcomerRate: newcomerRate.length ? newcomerRate[newcomerRate.length - 1] : null,
  }
}

/** Per-season trajectory for the Trend lens (season-independent of the picker). */
function computeSeries(rosters) {
  const roster = SEASONS
    .map(s => ({ season: s, value: rosters.filter(r => r.roster_season === s).length }))
    .filter(p => p.value > 0)
  const heightByPos = {}
  for (const p of POS) {
    heightByPos[p] = SEASONS
      .map(s => {
        const med = median(rosters.filter(r => r.roster_season === s && r.position === p && r.height_inches != null).map(r => r.height_inches))
        return med != null ? { season: s, value: med } : null
      })
      .filter(Boolean)
  }
  const { returnRate, newcomerRate } = retentionSeries(rosters)
  return { roster, heightByPos, returnRate, newcomerRate }
}

/**
 * Retention per the benchmark definition (CSIP spec §6): for transition Y→Y+1,
 * stored under Y+1. return_rate = of non-graduating (class ≠ SR/GR) classified
 * players in Y, the fraction whose player_id appears in Y+1. newcomer_rate =
 * share of classified Y+1 roster with no player_id on the Y roster. Class-null
 * players excluded; both seasons must clear a light roster floor.
 */
function retentionSeries(rosters) {
  const CLASS = new Set(['FR', 'SO', 'JR', 'SR', 'GR'])
  const bySeason = {}
  for (const r of rosters) { const s = r.roster_season; (bySeason[s] = bySeason[s] || []).push(r) }
  const returnRate = [], newcomerRate = []
  for (const Y of [2021, 2022, 2023, 2024]) {
    const Yp = Y + 1
    const prev = bySeason[Y], cur = bySeason[Yp]
    if (!prev || !cur || prev.length < 9 || cur.length < 9) continue
    const prevIds = new Set(prev.filter(r => r.player_id != null).map(r => r.player_id))
    const curIds = new Set(cur.filter(r => r.player_id != null).map(r => r.player_id))
    const eligible = prev.filter(r => CLASS.has(r.class_year) && r.player_id != null && r.class_year !== 'SR' && r.class_year !== 'GR')
    if (eligible.length) {
      const returned = eligible.filter(r => curIds.has(r.player_id)).length
      returnRate.push({ season: Yp, value: returned / eligible.length })
    }
    const curClassified = cur.filter(r => CLASS.has(r.class_year) && r.player_id != null)
    if (curClassified.length) {
      const newc = curClassified.filter(r => !prevIds.has(r.player_id)).length
      newcomerRate.push({ season: Yp, value: newc / curClassified.length })
    }
  }
  return { returnRate, newcomerRate }
}

function computeProgram(school, rosters, season) {
  const seasonsAvailable = [...new Set(rosters.map(r => r.roster_season))].sort((a, b) => a - b)
  const rows = rosters.filter(r => r.roster_season === season)
  const hasSeason = rows.length > 0

  const heightByPos = {}
  for (const p of POS) {
    heightByPos[p] = median(rows.filter(r => r.position === p && r.height_inches != null).map(r => r.height_inches))
  }

  const posCounts = Object.fromEntries(POS.map(p => [p, 0]))
  for (const r of rows) if (posCounts[r.position] != null) posCounts[r.position]++
  const posTotal = POS.reduce((a, p) => a + posCounts[p], 0)
  const posShare = Object.fromEntries(POS.map(p => [p, { count: posCounts[p], share: posTotal ? posCounts[p] / posTotal : null }]))

  const classCounts = Object.fromEntries(CLASSES.map(c => [c, 0]))
  for (const r of rows) if (classCounts[r.class_year] != null) classCounts[r.class_year]++
  const classTotal = CLASSES.reduce((a, c) => a + classCounts[c], 0)
  const classShare = Object.fromEntries(CLASSES.map(c => [c, { count: classCounts[c], share: classTotal ? classCounts[c] / classTotal : null }]))

  let intlCount = 0, domesticCount = 0, unknown = 0
  const states = {}, countries = {}
  for (const r of rows) {
    const country = (r.hometown_country || '').trim()
    const stateName = (r.hometown_state || '').trim()
    const isIntl = !!country && !US_NAMES.has(country)
    if (isIntl) { intlCount++; countries[country] = (countries[country] || 0) + 1 }
    else if (stateName) { domesticCount++; states[stateName] = (states[stateName] || 0) + 1 }
    else if (country && US_NAMES.has(country)) { domesticCount++ }
    else { unknown++ }
  }
  const known = intlCount + domesticCount
  const intl = { count: intlCount, known, share: known ? intlCount / known : null }
  const geo = {
    states, countries, unknown, domestic: domesticCount, intl: intlCount, total: rows.length,
    topStates: Object.entries(states).sort((a, b) => b[1] - a[1]),
    topCountries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
  }

  return { school, seasonsAvailable, hasSeason, roster: rows.length, heightByPos, posShare, classShare, intl, geo }
}

export function useLandscapePins(client, ids, season) {
  const [raw, setRaw] = useState({ loading: false, error: null, byId: {} })
  const key = (ids || []).join(',')

  useEffect(() => {
    const list = (ids || []).filter(Boolean)
    if (!client || !list.length) { setRaw({ loading: false, error: null, byId: {} }); return }
    let cancelled = false
    setRaw(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const results = await Promise.all(list.map(async id => {
          const [schoolRes, rostersRes] = await Promise.all([
            client.from('schools').select('id, school, division, conference, program_gender').eq('id', id).single(),
            client.from('college_rosters')
              .select('roster_season, position, class_year, height_inches, hometown_state, hometown_country, player_id')
              .eq('school_id', id).eq('is_active', true),
          ])
          if (schoolRes.error) throw schoolRes.error
          if (rostersRes.error) throw rostersRes.error
          return [id, { school: schoolRes.data, rosters: rostersRes.data || [] }]
        }))
        if (cancelled) return
        setRaw({ loading: false, error: null, byId: Object.fromEntries(results) })
      } catch (e) {
        if (!cancelled) setRaw({ loading: false, error: e?.message || String(e), byId: {} })
      }
    })()

    return () => { cancelled = true }
  }, [client, key])

  const items = useMemo(() => (ids || []).map(id => {
    const r = raw.byId[id]
    if (!r) return { loading: raw.loading, hasSeason: false, seasonsAvailable: [], roster: 0, school: null, series: null }
    return { ...computeProgram(r.school, r.rosters, season), series: computeSeries(r.rosters), snapshot: computeSnapshot(r.school, r.rosters) }
  }), [raw, key, season])

  return { loading: raw.loading, error: raw.error, items }
}
