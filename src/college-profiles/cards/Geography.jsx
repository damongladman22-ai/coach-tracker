/**
 * Geography — where the current roster is from, as ranked bars. Buckets come
 * from the normalized location columns (U.S. → state, international → country),
 * so counts don't split on formatting.
 */
export default function Geography({ buckets }) {
  const max = Math.max(1, ...buckets.map(b => b.count))
  return (
    <div className="cp-panel">
      <h3 className="cp-panel-h">Where they’re from</h3>
      <p className="cp-panel-desc">Home state / country across the current roster.</p>
      {buckets.length === 0 ? (
        <div className="cp-muted" style={{ fontSize: 13 }}>No hometown data on file.</div>
      ) : (
        <ul className="cp-geo">
          {buckets.map(b => (
            <li key={(b.intl ? 'C:' : 'S:') + b.name}>
              <span className="cp-gname">
                {b.name}
                {b.intl && <span className="cp-gflag" title="International">intl</span>}
              </span>
              <span className="cp-gtrack"><span className="cp-gfill" style={{ width: `${100 * b.count / max}%` }} /></span>
              <span className="cp-gn cp-num">{b.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
