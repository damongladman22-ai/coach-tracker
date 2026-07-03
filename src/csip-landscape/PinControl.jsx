import { useEffect, useMemo, useRef, useState } from 'react'
import { divShort, genderLabel } from './data/landscapeFormat'

/**
 * PinControl — prop-injected program picker (never imports an app client).
 * Supports pinning up to `max` programs; shows each as a colored chip with a
 * clear button, and a search to add more while under the cap.
 */
export default function PinControl({ client, division, gender, pins, colors, onAdd, onRemove, max = 3 }) {
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

  const pinnedIds = new Set(pins.map(p => p.id))
  const matches = useMemo(() => {
    const q = query.trim().toLowerCase()
    const base = schools.filter(s => !pinnedIds.has(s.id))
    if (!q) return base.slice(0, 40)
    return base.filter(s => s.school.toLowerCase().includes(q)).slice(0, 40)
  }, [query, schools, pins])

  const atMax = pins.length >= max

  return (
    <div className="csl-pinctl" ref={ref}>
      <span className="csl-glabel">Pin programs</span>

      {pins.map((p, i) => (
        <span className="csl-pin-chip" key={p.id} style={{ '--c': colors[i] }}>
          <i className="csl-pin-dot" style={{ background: colors[i] }} />
          {p.name}
          <button type="button" className="csl-pin-x" aria-label={`Unpin ${p.name}`} onClick={() => onRemove(p.id)}>×</button>
        </span>
      ))}

      {!atMax && (
        <div className="csl-pin-search">
          <input
            className="csl-pin-input"
            type="text"
            placeholder={loading ? 'Loading programs…' : pins.length ? 'Add another…' : `Search ${divShort(division)} ${genderLabel(gender)} programs…`}
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
                  <button type="button" className="csl-pin-opt" onClick={() => { onAdd(s.id, s.school); setQuery(''); setOpen(false) }}>
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
