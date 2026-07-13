import { useState, useEffect } from 'react'

/**
 * useProgramResults — loads on-field results (season records) for one program
 * from the public-read program_results table. Coverage-agnostic: a program
 * with no rows returns [] and the ProgramResults card renders nothing, so this
 * degrades cleanly for programs we haven't sourced yet.
 *   row → { season, division, conference, wins, losses, ties, winPct, notes }
 * Supabase returns numeric columns as strings, so every number is coerced.
 */
export function useProgramResults(client, schoolId) {
  const [state, setState] = useState({ loading: true, error: null, rows: [] })

  useEffect(() => {
    let alive = true
    if (!client || !schoolId) {
      setState({ loading: false, error: null, rows: [] })
      return
    }
    setState({ loading: true, error: null, rows: [] })
    client
      .from('program_results')
      .select('season, division, conference, wins, losses, ties, win_pct, notes')
      .eq('school_id', schoolId)
      .order('season', { ascending: true })
      .then(({ data, error }) => {
        if (!alive) return
        if (error) {
          setState({ loading: false, error: error.message, rows: [] })
          return
        }
        const rows = (data || []).map(r => ({
          season: Number(r.season),
          division: r.division || null,
          conference: r.conference || null,
          wins: Number(r.wins),
          losses: Number(r.losses),
          ties: Number(r.ties),
          winPct: r.win_pct == null ? null : Number(r.win_pct),
          notes: r.notes || null,
        }))
        setState({ loading: false, error: null, rows })
      })
    return () => { alive = false }
  }, [client, schoolId])

  return state
}
