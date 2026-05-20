/**
 * VideoBadge — small pill button shown on a game card when the game
 * has one or more ready videos. Clicking toggles expansion of the
 * GameVideosPanel below.
 *
 * Props:
 *  - count: number of videos
 *  - expanded: bool
 *  - onClick: () => void
 */
export default function VideoBadge({ count, expanded, onClick }) {
  if (!count || count <= 0) return null
  return (
    <button
      onClick={onClick}
      aria-expanded={expanded}
      aria-label={`${count} video${count === 1 ? '' : 's'} available, ${expanded ? 'collapse' : 'expand'}`}
      className={`inline-flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-md min-h-[28px] ${
        expanded
          ? 'bg-purple-600 text-white'
          : 'bg-purple-100 text-purple-800 hover:bg-purple-200 active:bg-purple-300'
      }`}
    >
      <span aria-hidden="true">🎥</span>
      <span>{count}</span>
      <span aria-hidden="true" className="opacity-80">
        {expanded ? '▴' : '▾'}
      </span>
    </button>
  )
}
