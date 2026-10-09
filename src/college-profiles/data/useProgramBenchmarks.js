import { useEffect, useState } from 'react'

/**
 * useProgramBenchmarks — one read of program_benchmarks for a program's peer
 * groups, exposed as scopes the profile cards overlay against. Replaces the
 * per-metric useSizeBenchmark: every family (height, roster size, retention,
 * composition, geography) comes back in a single query, and a global peer
 * toggle in CollegeProfile picks which scope the whole page compares against.
 *
 * Loads two peer groups for the current season + the pooled (season 0) row:
 *   • division  (conference = 'ALL')      → e.g. "D1 Women"
 *   • conference (school.conference)       → e.g. "Big Ten"   (when present)
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, divLabel, confLabel, genderWord, div, conf }
 * where div / conf are Scope objects (or null) with a resolver:
 *
 *   scope.cell(metric, dimension, bucket, opts?) ->
 *     { median, p25, p75, mean, n, season } | null
 *
 * By default cell() uses the current season and falls back to the pooled row
 * only where the current cell is missing or very thin. Pass { pooled: true }
 * to force the all-seasons row (used for the multi-year retention tiles).
 *
 *   scope.seasonCell(metric, dimension, bucket, season) -> same shape | null
 *
 * seasonCell() reads one exact season with no fallback. It serves the
 * per-season return-rate ticks on Roster stability (backlog G4, 2026-10-09)
 * and the recruiting-style shift line (backlog G8, 2026-10-09), so the
 * return_rate and experienced_newcomer_rate rows are also loaded for every
 * season (a second, small query: one row per season per metric per scope).
 */

const POOLED = 0
const THIN_FALLBACK = 10 // below this many programs/players, prefer the larger pooled cell

function shortDivision(d) {
  const m = /D\s*([123])/i.exec(d || '')
  return m ? `D${m[1]}` : (d || 'Division')
}
function genderWordOf(g) {
  if (g === 'W') return 'Women'
  if (g === 'M') return 'Men'
  return ''
}
const num = v => (v == null ? null : Number(v))

function buildScope(rows, currentSeason, label, gword) {
  if (!rows || !rows.length) return null
  const idx = {} // idx[season]['metric|dimension|bucket'] = row
  for (const r of rows) {
    const key = `${r.metric}|${r.dimension}|${r.bucket}`
    ;(idx[r.roster_season] || (idx[r.roster_season] = {}))[key] = r
  }
  const shape = (r, season) => ({
    median: num(r.median), p25: num(r.p25), p75: num(r.p75), mean: num(r.mean), n: r.n, season,
  })
  const cell = (metric, dimension, bucket, opts = {}) => {
    const key = `${metric}|${dimension}|${bucket}`
    if (opts.pooled) {
      const r = idx[POOLED]?.[key]
      return r ? shape(r, POOLED) : null
    }
    const cur = currentSeason != null ? idx[currentSeason]?.[key] : null
    const pooled = idx[POOLED]?.[key]
    if (!cur) return pooled ? shape(pooled, POOLED) : null
    if (cur.n < THIN_FALLBACK && pooled && pooled.n > cur.n) return shape(pooled, POOLED)
    return shape(cur, currentSeason)
  }
  const seasonCell = (metric, dimension, bucket, season) => {
    const r = idx[season]?.[`${metric}|${dimension}|${bucket}`]
    return r ? shape(r, season) : null
  }
  return { label, genderWord: gword, cell, seasonCell }
}

export function useProgramBenchmarks(client, school, currentSeason) {
  const division = school?.division || null
  const programGender = school?.program_gender || null
  const conference = school?.conference || null

  const [state, setState] = useState({ loading: false, error: null, rows: [] })

  useEffect(() => {
    if (!client || !division || !programGender) {
      setState({ loading: false, error: null, rows: [] })
      return
    }
    let cancelled = false
    setState(s => ({ ...s, loading: true, error: null }))

    ;(async () => {
      try {
        const conferences = ['ALL']
        if (conference) conferences.push(conference)
        const seasons = [POOLED]
        if (currentSeason != null && currentSeason !== POOLED) seasons.push(currentSeason)

        const cols = 'conference, roster_season, metric, dimension, bucket, unit, n, median, p25, p75, mean'
        const [res, perSeason] = await Promise.all([
          client
            .from('program_benchmarks')
            .select(cols)
            .eq('division', division)
            .eq('program_gender', programGender)
            .in('conference', conferences)
            .in('roster_season', seasons),
          // Every season's return rate (per-season ticks, G4) and experienced
          // newcomer rate (recruiting-style shift, G8).
          client
            .from('program_benchmarks')
            .select(cols)
            .eq('division', division)
            .eq('program_gender', programGender)
            .in('conference', conferences)
            .in('metric', ['return_rate', 'experienced_newcomer_rate']),
        ])

        if (cancelled) return
        if (res.error) throw res.error
        // The per-season rows are an extra; if they fail the page keeps every other overlay.
        const extra = perSeason.error ? [] : (perSeason.data || [])
        setState({ loading: false, error: null, rows: (res.data || []).concat(extra) })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), rows: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, division, programGender, conference, currentSeason])

  const gword = genderWordOf(programGender)
  const divRows = state.rows.filter(r => r.conference === 'ALL')
  const confRows = conference ? state.rows.filter(r => r.conference === conference) : []

  return {
    loading: state.loading,
    error: state.error,
    divLabel: shortDivision(division),
    confLabel: conference || null,
    genderWord: gword,
    div: buildScope(divRows, currentSeason, shortDivision(division), gword),
    conf: buildScope(confRows, currentSeason, conference || '', gword),
  }
}
