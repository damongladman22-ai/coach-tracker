import { divisionMix } from '../lib/divisionMix'

/**
 * DivisionMix — the division make-up of the colleges whose coaches attended
 * (backlog F14, Damon 2026-10-09: "A + B on the event summary").
 *
 *   A  one bar split by division, with the count for each
 *   B  chips that filter the college list: All, then each division present
 *
 * Counts colleges, not coaches. Renders nothing when no college is logged.
 */
export default function DivisionMix({ schools, selected = 'ALL', onSelect }) {
  const { total, parts } = divisionMix(schools)
  if (!total) return null

  const chip = (key, label, count) => {
    const on = selected === key
    return (
      <button
        key={key}
        type="button"
        aria-pressed={on}
        onClick={() => onSelect && onSelect(on && key !== 'ALL' ? 'ALL' : key)}
        className={'inline-flex items-center gap-1.5 text-sm rounded-full px-3 py-1 border transition-colors ' +
          (on ? 'bg-blue-50 border-blue-500 text-blue-800' : 'bg-white border-gray-300 text-gray-700 hover:border-gray-500')}
      >
        {label}
        <span className="font-semibold tabular-nums">{count}</span>
      </button>
    )
  }

  return (
    <div className="mt-4 pt-4 border-t border-gray-100">
      <div className="flex items-baseline justify-between mb-2">
        <span className="text-[10px] sm:text-xs uppercase tracking-wider text-gray-500">Colleges by division</span>
      </div>
      <div className="flex h-2.5 rounded-full overflow-hidden bg-gray-100"
        role="img"
        aria-label={parts.map(p => `${p.name} ${p.count}`).join(', ')}>
        {parts.map(p => (
          <div key={p.key} title={`${p.name}: ${p.count}`}
            style={{ width: `${p.share * 100}%`, background: p.color }} />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2 text-xs text-gray-600">
        {parts.map(p => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-sm" style={{ background: p.color }} aria-hidden="true" />
            {p.label} <span className="tabular-nums">{p.count}</span>
          </span>
        ))}
      </div>
      {parts.length > 1 && (
        <div className="flex flex-wrap gap-2 mt-3" role="group" aria-label="Show colleges by division">
          {chip('ALL', 'All', total)}
          {parts.map(p => chip(p.key, p.label, p.count))}
        </div>
      )}
    </div>
  )
}
