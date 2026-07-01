/**
 * CoachStaff — the current staff on file for this program, from the coaches
 * table. Head coach first, then associates/assistants, then others; email and
 * phone render as tappable links.
 */
function initials(f, l) {
  const s = ((f || '')[0] || '') + ((l || '')[0] || '')
  return s.toUpperCase() || '—'
}
function rank(title) {
  const t = (title || '').toLowerCase()
  if (t.includes('head') && !t.includes('assoc') && !t.includes('assistant')) return 0
  if (t.includes('assoc')) return 1
  if (t.includes('assistant')) return 2
  return 3
}

export default function CoachStaff({ coaches }) {
  const list = (coaches || []).slice().sort(
    (a, b) => rank(a.title) - rank(b.title) || (a.last_name || '').localeCompare(b.last_name || '')
  )
  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Coaching staff</h3>
      <p className="cp-panel-desc">Current staff on file for this program.</p>
      {list.length === 0 ? (
        <div className="cp-muted" style={{ fontSize: 13 }}>No staff currently listed.</div>
      ) : (
        <ul className="cp-staff">
          {list.map(c => {
            const name = [c.first_name, c.last_name].filter(Boolean).join(' ')
            return (
              <li key={c.id}>
                <span className="cp-av">{initials(c.first_name, c.last_name)}</span>
                <div className="cp-staff-body">
                  <div className="cp-staff-nm">{name || '—'}</div>
                  <div className="cp-staff-role">{c.title || 'Coach'}</div>
                  {(c.email || c.phone) && (
                    <div className="cp-staff-contact">
                      {c.email && <a href={`mailto:${c.email}`}>{c.email}</a>}
                      {c.email && c.phone && <span className="cp-dot">·</span>}
                      {c.phone && <a href={`tel:${c.phone}`}>{c.phone}</a>}
                    </div>
                  )}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
