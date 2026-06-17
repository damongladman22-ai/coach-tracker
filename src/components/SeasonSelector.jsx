import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { listSeasons } from '../lib/season'

/**
 * SeasonSelector — bottom-sheet picker for choosing which club season to view.
 * Used on parent home (/home) so parents can browse past years. Mobile-first
 * design; the bottom-sheet pattern matches native iOS/Android pickers.
 *
 * Built without external dependencies — pure React + Tailwind + CSS transitions.
 * Trade-off vs a library like vaul: no drag-to-dismiss gesture. Backdrop tap
 * and Escape key still close it.
 *
 * Two visual variants:
 *  - 'parent' (default): full-width banner trigger. For /home.
 *  - 'admin':            compact pill trigger. For /admin.
 *
 * Behavior:
 *  - Loads seasons via listSeasons() on mount (cached at the lib level)
 *  - If no `value` passed AND allowAll is false, auto-selects the DB-active
 *    season and emits onChange so the parent sees the initial state immediately.
 *  - When allowAll is true, "All Seasons" is rendered at the top of the sheet;
 *    selecting it fires onChange(null). The admin Events page uses this to
 *    let admins see events across all seasons.
 *  - Tap a season → fires onChange(seasonRecord) and closes after a brief
 *    delay so the checkmark animation registers.
 *
 * IMPORTANT — the overlay is rendered through a portal into document.body.
 * The picker is often mounted inside a wrapper that carries a CSS transform
 * (e.g. PullToRefresh's content div). A transformed ancestor becomes the
 * containing block for `position: fixed` descendants, which would pin this
 * sheet to the bottom of the whole page instead of the viewport — the
 * backdrop covers the screen but the sheet renders off-screen below the fold.
 * Portaling to <body> takes the overlay out of that transformed subtree so
 * `fixed` resolves against the viewport like a modal should.
 *
 * Props:
 *  - value:    selected season record (null = "All Seasons" when allowAll)
 *  - onChange: (seasonRecord | null) => void
 *  - variant:  'parent' | 'admin'  (default 'parent')
 *  - allowAll: boolean, default false. When true, adds an "All Seasons" option
 *              and skips the auto-select-active behavior (parent controls value)
 */
export default function SeasonSelector({
  value,
  onChange,
  variant = 'parent',
  allowAll = false,
}) {
  const [open, setOpen] = useState(false)
  const [seasons, setSeasons] = useState([])
  const [loading, setLoading] = useState(true)
  const [hasAutoSelected, setHasAutoSelected] = useState(false)

  // Load seasons on mount; lib-level cache makes this cheap.
  useEffect(() => {
    let cancelled = false
    listSeasons().then((list) => {
      if (cancelled) return
      setSeasons(list)
      setLoading(false)

      // Auto-select active season on first load if parent hasn't chosen yet.
      // Skipped when allowAll is set — the parent owns initial value entirely
      // (it may legitimately want to start at null / "All Seasons").
      if (!allowAll && !value && !hasAutoSelected && list.length > 0) {
        const active = list.find((s) => s.is_active) || list[0]
        if (active) {
          onChange?.(active)
          setHasAutoSelected(true)
        }
      } else if (list.length === 0) {
        setHasAutoSelected(true)
      }
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Escape closes the sheet, and we lock body scroll while open
  useEffect(() => {
    if (!open) return
    const handler = (e) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', handler)
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = prevOverflow
    }
  }, [open])

  // When allowAll is enabled and the parent explicitly set value=null,
  // we want to show "All Seasons" rather than falling back to active.
  const allSeasonsSelected = allowAll && value === null
  const displayed = allSeasonsSelected
    ? null
    : value || seasons.find((s) => s.is_active) || seasons[0] || null

  const handleSelect = (season) => {
    onChange?.(season)
    setTimeout(() => setOpen(false), 140)
  }

  // The full-screen overlay (backdrop + bottom sheet). Always rendered so the
  // open/close opacity + translate transitions have something to animate; it's
  // pointer-events-none and opacity-0 when closed. Portaled into <body> below.
  const overlay = (
    <div
      className={`fixed inset-0 z-50 transition-opacity duration-300 ${
        open ? 'opacity-100' : 'opacity-0 pointer-events-none'
      }`}
      aria-hidden={!open}
    >
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40"
        onClick={() => setOpen(false)}
        aria-label="Close season picker"
        role="button"
        tabIndex={-1}
      />

      {/* Sheet */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Select Season"
        className={`absolute bottom-0 inset-x-0 bg-white rounded-t-2xl shadow-2xl transition-transform duration-300 ease-out ${
          open ? 'translate-y-0' : 'translate-y-full'
        }`}
        style={{
          maxHeight: 'min(85vh, 720px)',
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        {/* Grab handle — visual cue (no drag behavior without a lib) */}
        <div className="mx-auto mt-3 mb-2 h-1.5 w-12 rounded-full bg-gray-300" />

        <div className="flex items-center justify-between px-5 pt-1 pb-3">
          <h2 className="text-lg font-semibold text-gray-900">
            Select Season
          </h2>
          <button
            type="button"
            onClick={() => setOpen(false)}
            aria-label="Close season picker"
            className="rounded-full p-2 text-gray-500 hover:bg-gray-100 active:bg-gray-200"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div
          className="overflow-y-auto px-2 pb-4"
          style={{ maxHeight: 'calc(min(85vh, 720px) - 80px)' }}
        >
          {seasons.length === 0 ? (
            <div className="px-3 py-10 text-center text-sm text-gray-500">
              No seasons configured yet.
            </div>
          ) : (
            <ul className="space-y-1">
              {allowAll && (
                <li>
                  <button
                    type="button"
                    onClick={() => handleSelect(null)}
                    className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                      allSeasonsSelected
                        ? 'bg-cyan-50 hover:bg-cyan-100 active:bg-cyan-200'
                        : 'hover:bg-gray-50 active:bg-gray-100'
                    }`}
                    style={{ minHeight: 56 }}
                  >
                    <div className="min-w-0 flex-1">
                      <div
                        className={`truncate text-base font-medium ${
                          allSeasonsSelected
                            ? 'text-cyan-900'
                            : 'text-gray-900'
                        }`}
                      >
                        All Seasons
                      </div>
                      <div className="mt-0.5 text-xs text-gray-500">
                        Show across every year
                      </div>
                    </div>
                    {allSeasonsSelected && (
                      <svg
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        className="text-cyan-600 flex-shrink-0"
                        aria-hidden="true"
                      >
                        <path d="M20 6 9 17l-5-5" />
                      </svg>
                    )}
                  </button>
                </li>
              )}
              {seasons.map((season) => {
                const isSelected =
                  !allSeasonsSelected && displayed?.id === season.id
                const isActive = !!season.is_active
                return (
                  <li key={season.id}>
                    <button
                      type="button"
                      onClick={() => handleSelect(season)}
                      className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-3 text-left transition-colors ${
                        isSelected
                          ? 'bg-cyan-50 hover:bg-cyan-100 active:bg-cyan-200'
                          : 'hover:bg-gray-50 active:bg-gray-100'
                      }`}
                      style={{ minHeight: 56 }}
                    >
                      <div className="min-w-0 flex-1">
                        <div
                          className={`truncate text-base font-medium ${
                            isSelected ? 'text-cyan-900' : 'text-gray-900'
                          }`}
                        >
                          {season.name}
                        </div>
                        <div className="mt-0.5 text-xs text-gray-500">
                          {formatRange(season.start_date, season.end_date)}
                        </div>
                      </div>
                      <div className="flex flex-shrink-0 items-center gap-2">
                        {isActive && (
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-emerald-700">
                            Active
                          </span>
                        )}
                        {isSelected && (
                          <svg
                            width="20"
                            height="20"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="text-cyan-600"
                            aria-hidden="true"
                          >
                            <path d="M20 6 9 17l-5-5" />
                          </svg>
                        )}
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  )

  return (
    <>
      <SelectorTrigger
        variant={variant}
        season={displayed}
        allSeasonsSelected={allSeasonsSelected}
        loading={loading}
        disabled={!loading && seasons.length === 0}
        onClick={() => setOpen(true)}
      />

      {/* Portal the overlay to <body> so a transformed ancestor (PullToRefresh)
          can't capture its `position: fixed` and pin it off-screen. */}
      {typeof document !== 'undefined'
        ? createPortal(overlay, document.body)
        : null}
    </>
  )
}

/**
 * The button that opens the sheet. Visual differs by variant.
 */
function SelectorTrigger({
  variant,
  season,
  allSeasonsSelected,
  loading,
  disabled,
  onClick,
}) {
  const label = loading
    ? 'Loading…'
    : allSeasonsSelected
    ? 'All Seasons'
    : season
    ? season.name
    : 'No seasons'

  if (variant === 'admin') {
    return (
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        className="inline-flex items-center gap-2 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-sm font-medium text-gray-800 hover:bg-gray-50 active:bg-gray-100 disabled:opacity-50"
        aria-label={`Season: ${label}. Tap to change.`}
      >
        <span className="text-gray-500" aria-hidden="true">
          Season:
        </span>
        <span className="truncate">{label}</span>
        <Chevron />
      </button>
    )
  }

  // Parent variant — full-width banner-style trigger
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center justify-between gap-3 rounded-lg border border-gray-200 bg-white px-4 py-3 text-left shadow-sm transition-shadow hover:shadow-md active:shadow active:bg-gray-50 disabled:opacity-50"
      style={{ minHeight: 56 }}
      aria-label={`Current season: ${label}. Tap to change.`}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[11px] font-medium uppercase tracking-wide text-gray-500">
          Season
        </div>
        <div className="mt-0.5 truncate text-base font-semibold text-gray-900">
          {label}
        </div>
      </div>
      <Chevron large />
    </button>
  )
}

function Chevron({ large = false }) {
  const size = large ? 20 : 16
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="flex-shrink-0 text-gray-400"
      aria-hidden="true"
    >
      <path d="m6 9 6 6 6-6" />
    </svg>
  )
}

/**
 * Format a season's date range as a subtitle.
 *   "Aug 2025 – Jul 2026"
 *   "Aug 2025"  (same month)
 *   "From Aug 2025"  (no end)
 */
function formatRange(startDate, endDate) {
  const start = parseDate(startDate)
  const end = parseDate(endDate)
  if (!start && !end) return ''
  const fmt = (d) =>
    d ? d.toLocaleDateString('en-US', { month: 'short', year: 'numeric' }) : ''
  if (!start) return fmt(end)
  if (!end) return `From ${fmt(start)}`
  if (
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth()
  ) {
    return fmt(start)
  }
  return `${fmt(start)} – ${fmt(end)}`
}

function parseDate(s) {
  if (!s || typeof s !== 'string') return null
  const [y, m, d] = s.split('-').map(Number)
  if (!y || !m) return null
  // Local timezone — avoid UTC midnight drift.
  return new Date(y, (m || 1) - 1, d || 1)
}
