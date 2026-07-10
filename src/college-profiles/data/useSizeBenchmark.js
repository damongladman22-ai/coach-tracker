import { useEffect, useState } from 'react'

/**
 * useSizeBenchmark — loads the height-by-position benchmark for a program's
 * peer groups from program_benchmarks, so SizeProfile can overlay a
 * median tick + p25–p75 IQR band against the program's own heights.
 *
 * Reads two peer groups in one query:
 *   • division  (conference = 'ALL')  → e.g. "D1 Women"
 *   • conference (school.conference)  → e.g. "Big Ten"      (when present)
 * for the current season and the pooled row (season 0), then resolves each
 * bucket to the current season, falling back to pooled only where a cell is
 * missing or very thin. Player-level rows carry median / p25 / p75 / n.
 *
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, div, conf } where each scope is
 *   { label, genderWord, byBucket:{ [GK|D|M|F|overall]:{median,p25,p75,n,season} }, anyFallback }
 * div is null when the school's division has no benchmark rows; conf is null
 * when the school has no conference (or no conference rows).
 */

const POOLED = 0
const THIN_FALLBACK = 10 // below this, prefer the pooled cell if it's larger

function shortDivision(d) {
  if (!d) return 'Division'
  const m = /D\s*([123])/i.exec(d)
  return m ? `D${m[1]}` : d
}
function genderWord(g) {
  if (g === 'W') return 'Women'
  if (g === 'M') return 'Men'
  return ''
}
function bucketKey(row) {
  return row.dimension === 'overall' ? 'overall' : row.bucket
}

export function useSizeBenchmark(client, school, currentSeason) {
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

        const res = await client
          .from('program_benchmarks')
          .select('conference, roster_season, dimension, bucket, n, median, p25, p75, mean')
          .eq('division', division)
          .eq('program_gender', programGender)
          .eq('metric', 'height_inches')
          .in('conference', conferences)
          .in('roster_season', seasons)

        if (cancelled) return
        if (res.error) throw res.error
        setState({ loading: false, error: null, rows: res.data || [] })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), rows: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, division, programGender, conference, currentSeason])

  // index: idx[conference][season][bucketKey] = row
  const idx = {}
  for (const r of state.rows) {
    const c = r.conference, s = r.roster_season, k = bucketKey(r)
    ;(idx[c] || (idx[c] = {}))
    ;(idx[c][s] || (idx[c][s] = {}))
    idx[c][s][k] = r
  }

  const resolveScope = (confKey, label) => {
    const perConf = idx[confKey]
    if (!perConf) return null
    const byBucket = {}
    let anyFallback = false
    let found = false
    for (const key of ['GK', 'D', 'M', 'F', 'overall']) {
      const cur = currentSeason != null ? perConf[currentSeason]?.[key] : null
      const pooled = perConf[POOLED]?.[key]
      let row = cur, usedSeason = currentSeason
      if (!row) { row = pooled; usedSeason = POOLED; if (row) anyFallback = true }
      else if (cur.n < THIN_FALLBACK && pooled && pooled.n > cur.n) {
        row = pooled; usedSeason = POOLED; anyFallback = true
      }
      if (row) {
        found = true
        byBucket[key] = { median: row.median, p25: row.p25, p75: row.p75, n: row.n, season: usedSeason }
      }
    }
    if (!found) return null
    return { label, genderWord: genderWord(programGender), byBucket, anyFallback }
  }

  const div = resolveScope('ALL', shortDivision(division))
  const conf = conference ? resolveScope(conference, conference) : null

  return { loading: state.loading, error: state.error, div, conf }
}
