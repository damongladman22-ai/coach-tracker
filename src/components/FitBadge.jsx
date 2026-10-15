// Reach / Good fit / Safety pill (src/lib/fitTier.js), shared by Find programs
// and Ask PitchSide's program cards. The reasons show on hover.
const STYLE = {
  reach: 'bg-rose-50 text-rose-800 border-rose-200',
  good: 'bg-emerald-50 text-emerald-800 border-emerald-200',
  safety: 'bg-sky-50 text-sky-800 border-sky-200',
}

export default function FitBadge({ fit, className = '' }) {
  if (!fit?.tier || !STYLE[fit.tier]) return null
  return (
    <span title={(fit.why || []).join('\n')}
      className={`inline-block text-[11px] font-semibold rounded-full px-2 py-0.5 border whitespace-nowrap ${STYLE[fit.tier]} ${className}`}>
      {fit.label}
    </span>
  )
}
