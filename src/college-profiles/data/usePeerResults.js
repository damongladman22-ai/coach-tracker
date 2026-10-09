import { useEffect, useMemo, useState } from 'react'
import { buildPeerIndex } from './resultsStanding'

/**
 * usePeerResults — the peers' records behind the Program performance card's
 * standing lines (backlog G2). For each division the program played in, loads
 * every program_results row of that division, for the seasons it played there,
 * limited to the same men's / women's program.
 *
 * About 350 rows per season for the largest group (D-I women), paged 1,000 at
 * a time. It runs after the profile has loaded and does not hold the card up:
 * the record shows at once and the standing lines appear when this finishes.
 *
 *   rows           the program's own rows from useProgramResults
 *   programGender  'W' or 'M' (schools.program_gender)
 * Returns { loading, error, index } where index comes from buildPeerIndex.
 */
const PAGE = 1000

function planKey(rows, programGender) {
  if (!programGender || !rows || !rows.length) return null
  const byDiv = new Map()
  for (const r of rows) {
    if (!r.division) continue
    if (!byDiv.has(r.division)) byDiv.set(r.division, new Set())
    byDiv.get(r.division).add(r.season)
  }
  if (!byDiv.size) return null
  const parts = [...byDiv.keys()].sort().map(d => d + ':' + [...byDiv.get(d)].sort((a, b) => a - b).join(','))
  return programGender + '|' + parts.join(';')
}

async function fetchPeers(client, key) {
  const [gender, plan] = key.split('|')
  let all = []
  for (const part of plan.split(';')) {
    const i = part.lastIndexOf(':')
    const division = part.slice(0, i)
    const seasons = part.slice(i + 1).split(',').map(Number)
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await client
        .from('program_results')
        .select('school_id, season, division, conference, wins, losses, ties, win_pct, conf_wins, conf_losses, conf_ties, conf_win_pct, rpi_rank, schools!inner(program_gender)')
        .eq('division', division)
        .eq('schools.program_gender', gender)
        .in('season', seasons)
        .order('school_id', { ascending: true })
        .order('season', { ascending: true })
        .range(from, from + PAGE - 1)
      if (error) throw error
      all = all.concat(data || [])
      if (!data || data.length < PAGE) break
    }
  }
  return all
}

export function usePeerResults(client, rows, programGender) {
  const key = useMemo(() => planKey(rows, programGender), [rows, programGender])
  const [state, setState] = useState({ key: null, rows: [], error: null })

  useEffect(() => {
    if (!client || !key) return
    let alive = true
    fetchPeers(client, key)
      .then(data => { if (alive) setState({ key, rows: data, error: null }) })
      .catch(e => { if (alive) setState({ key, rows: [], error: e?.message || String(e) }) })
    return () => { alive = false }
  }, [client, key])

  const ready = key != null && state.key === key
  const index = useMemo(() => (ready && !state.error ? buildPeerIndex(state.rows) : null), [ready, state])
  return { loading: key != null && !ready, error: ready ? state.error : null, index }
}
