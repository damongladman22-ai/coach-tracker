import { useEffect, useState } from 'react'

/**
 * useCollegeFacts — the federal college behind this program, its College
 * Scorecard facts, and its undergraduate majors.
 *
 * Three public-read tables, filled by the pipeline's load_college_facts.py
 * (backlog F8, 2026-10-07):
 *   school_federal_college  program -> federal college id (UNITID)
 *   college_facts           one row per federal college
 *   college_majors          undergraduate programs with graduates in the two
 *                           most recent award years
 *
 * Several programs can share one federal college (men's and women's teams;
 * campuses the federal data reports as one college), so the card names the
 * federal college it is showing.
 *
 * NON-CRITICAL. A program with no link (a joint team, a Canadian school) or a
 * failed request returns facts = null and the card renders nothing.
 *
 * Supabase returns numeric columns as strings, so every number is coerced.
 * Portable: takes the injected Supabase `client`; imports no app internals.
 * Returns { loading, error, facts, majors }.
 */
const NUM = [
  'latitude', 'longitude', 'locale', 'control', 'predominant_degree', 'undergrad_enrollment',
  'share_women', 'admission_rate', 'sat_average', 'cost_of_attendance', 'tuition_in_state',
  'tuition_out_of_state', 'avg_net_price', 'net_price_low_income', 'net_price_high_income',
  'graduation_rate', 'retention_rate', 'median_earnings_10yr',
]

function coerce(row) {
  if (!row) return null
  const out = { ...row }
  for (const k of NUM) out[k] = row[k] == null ? null : Number(row[k])
  return out
}

export function useCollegeFacts(client, schoolId) {
  const [state, setState] = useState({ loading: false, error: null, facts: null, majors: [] })

  useEffect(() => {
    if (!client || !schoolId) {
      setState({ loading: false, error: null, facts: null, majors: [] })
      return
    }
    let cancelled = false
    setState({ loading: true, error: null, facts: null, majors: [] })

    ;(async () => {
      try {
        const link = await client.from('school_federal_college')
          .select('unitid, college_facts(*)')
          .eq('school_id', schoolId)
          .maybeSingle()
        if (cancelled) return
        if (link.error) throw link.error
        const facts = coerce(link.data?.college_facts)
        if (!facts) {
          setState({ loading: false, error: null, facts: null, majors: [] })
          return
        }
        // A large university lists 200+ programs; one request covers it.
        const maj = await client.from('college_majors')
          .select('cip_code, title, family_code, family_title, credential_level, graduates_2yr')
          .eq('unitid', facts.unitid)
          .limit(2000)
        if (cancelled) return
        if (maj.error) throw maj.error
        const majors = (maj.data || []).map(m => ({
          cip: m.cip_code,
          title: m.title,
          familyCode: m.family_code,
          family: m.family_title,
          level: Number(m.credential_level),
          graduates: m.graduates_2yr == null ? null : Number(m.graduates_2yr),
        }))
        setState({ loading: false, error: null, facts, majors })
      } catch (e) {
        if (!cancelled) setState({ loading: false, error: e?.message || String(e), facts: null, majors: [] })
      }
    })()

    return () => { cancelled = true }
  }, [client, schoolId])

  return state
}
