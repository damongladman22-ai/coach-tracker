import { useState, useEffect } from 'react'

/**
 * useProgramResults — loads on-field results (season records) for one program
 * from the public-read program_results table. Coverage-agnostic: a program
 * with no rows returns [] and the ProgramResults card renders nothing, so this
 * degrades cleanly for programs we haven't sourced yet.
 *   row → { season, division, conference, wins, losses, ties, winPct, notes,
 *           confWins, confLosses, confTies, confWinPct, rpiRank }
 * Conference record + national ranking (rpiRank: RPI for D-I, NPI for D-II,
 * null for D-III/unranked/not-yet-backfilled) come from the same source and are
 * null-safe — older or unsourced rows simply carry nulls and the card hides them.
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
      .select('season, division, conference, wins, losses, ties, win_pct, notes, conf_wins, conf_losses, conf_ties, conf_win_pct, rpi_rank')
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
          confWins: r.conf_wins == null ? null : Number(r.conf_wins),
          confLosses: r.conf_losses == null ? null : Number(r.conf_losses),
          confTies: r.conf_ties == null ? null : Number(r.conf_ties),
          confWinPct: r.conf_win_pct == null ? null : Number(r.conf_win_pct),
          rpiRank: r.rpi_rank == null ? null : Number(r.rpi_rank),
        }))
        setState({ loading: false, error: null, rows })
      })
    return () => { alive = false }
  }, [client, schoolId])

  return state
}
