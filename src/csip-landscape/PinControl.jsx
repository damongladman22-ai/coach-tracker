import { useEffect, useMemo, useRef, useState } from 'react'
import { divShort, genderLabel } from './data/landscapeFormat'

/**
 * PinControl — a self-contained, prop-injected program picker (never imports an
 * app client). Loads the schools for the current division + gender once, filters
 * client-side, and reports the chosen school up. Shows the current pin with a
 * clear button.
 */
export default function PinControl({ client, division, gender, pinnedId, pinnedName, onPin, onClear }) {
  const [schools, setSchools] = useState([])
  const [loading, setLoading] = useState(true)
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!client || !division || !gender) return
    let cancelled = false
    setLoading(true)
    ;(async () => {
      try {
        const { data, error } = await client
          .from('schools')
          .select('id, school, city, state')
          .eq('division', division)
          .eq('program_gender', gender)
          .neq('is_active', false)
          .order('school')
        if (cancelled) return
        if (error) throw error
        setSchools(data || [])
      } catch {
        if (!cancelled) setSchools([])
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => { cancelled = true }
  }, [client, division, gender])

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('touchstart', onDoc) }
  }, [open])

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return schools.slice(0, 40)
    return schools.filter(s => s.school.toLowerCase().includes(q)).slice(0, 40)
  }, [query, schools])

  return (
    <div className="csl-pinctl" ref={ref}>
      <span className="csl-glabel">Pin a program</span>
      {pinnedId ? (
        <span className="csl-pin-chip">
          <i className="csl-pin-dot" />
          {pinnedName}
          <button type="button" className="csl-pin-x" aria-label="Clear pinned program" onClick={onClear}>×</button>
        </span>
      ) : (
        <div className="csl-pin-search">
          <input
            className="csl-pin-input"
            type="text"
            placeholder={loading ? 'Loading programs…' : `Search ${divShort(division)} ${genderLabel(gender)} programs…`}
            value={query}
            disabled={loading}
            onFocus={() => setOpen(true)}
            onChange={e => { setQuery(e.target.value); setOpen(true) }}
            aria-label="Search programs to pin"
          />
          {open && matches.length > 0 && (
            <ul className="csl-pin-menu" role="listbox">
              {matches.map(s => (
                <li key={s.id}>
                  <button type="button" className="csl-pin-opt" onClick={() => { onPin(s.id, s.school); setQuery(''); setOpen(false) }}>
                    <span className="csl-pin-opt-name">{s.school}</span>
                    {(s.city || s.state) && <span className="csl-pin-opt-loc">{[s.city, s.state].filter(Boolean).join(', ')}</span>}
                  </button>
                </li>
              ))}
            </ul>
          )}
          {open && !loading && matches.length === 0 && (
            <ul className="csl-pin-menu"><li className="csl-pin-empty">No matching programs</li></ul>
          )}
        </div>
      )}
    </div>
  )
}
