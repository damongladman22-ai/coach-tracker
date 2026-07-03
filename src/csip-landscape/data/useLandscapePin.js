import { useEffect, useState } from 'react'

/**
 * useLandscapePin — loads one program's active roster rows and computes its own
 * values for the selected season, to overlay on the division backdrop. Mirrors
 * the College Profiles dual-read (schools + college_rosters) and the metric
 * definitions in college-profiles/data/metrics.js so the pinned numbers match.
 *
 * Returns: { loading, error, school, seasonsAvailable, hasSeason, roster,
 *   heightByPos:{GK,D,M,F}, posShare:{bucket:{share,count}},
 *   classShare:{bucket:{share,count}}, intl:{share,count,known} }
 */
const US_NAMES = new Set(['United States', 'USA', 'US', 'U.S.', 'U.S.A.'])
const POS = ['GK', 'D', 'M', 'F']
const CLASSES = ['FR', 'SO', 'JR', 'SR', 'GR']

function median(arr) {
  if (!arr.length) return null
  const s = [...arr].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export function useLandscapePin(client, schoolId, season) {
  const [state, setState] = useState({ loading: false, error: null, school: null, rosters: [] })

  useEffect(() => {
    if (!client || !schoolId) { setState({ loading: false, error: null, school: null, rosters: [] }); return }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const [schoolRes, rostersRes] = await Promise.all([
          client.from('schools').select('id, school, division, conference, program_gender').eq('id', schoolId).single(),
          client.from('college_rosters')
            .select('roster_season, position, class_year, height_inches, hometown_state, hometown_country')
            .eq('school_id', schoolId).eq('is_active', true),
        ])
        if (cancelled) return
        if (schoolRes.error) throw schoolRes.error
        if (rostersRes.error) throw rostersRes.error
        setState({ loading: false, error: null, school: schoolRes.data, rosters: rostersRes.data || [] })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), school: null, rosters: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  const seasonsAvailable = [...new Set(state.rosters.map(r => r.roster_season))].sort((a, b) => a - b)
  const rows = state.rosters.filter(r => r.roster_season === season)
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
    states, countries, unknown,
    domestic: domesticCount, intl: intlCount, total: rows.length,
    topStates: Object.entries(states).sort((a, b) => b[1] - a[1]),
    topCountries: Object.entries(countries).sort((a, b) => b[1] - a[1]),
  }

  return {
    loading: state.loading, error: state.error, school: state.school,
    seasonsAvailable, hasSeason, roster: rows.length,
    heightByPos, posShare, classShare, intl, geo,
  }
}
