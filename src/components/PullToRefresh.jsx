import { useEffect, useRef, useState } from 'react'

const PULL_THRESHOLD = 70 // px the user must pull before release triggers refresh
const MAX_PULL = 120 // px hard cap on visible pull distance (rubber-band feel)
const INDICATOR_HEIGHT = 60 // px where the spinner finally rests when refreshing

/**
 * PullToRefresh — mobile pull-to-refresh wrapper.
 *
 * Usage:
 *   <PullToRefresh onRefresh={async () => { await reload() }}>
 *     <main>...</main>
 *   </PullToRefresh>
 *
 * Behavior:
 *  - Only activates when the user starts a touch with the page scrolled to the top.
 *  - Pulling down past PULL_THRESHOLD and releasing triggers onRefresh.
 *  - Releasing before the threshold cancels with no action.
 *  - During refresh the indicator spins. Indicator hides again when onRefresh resolves.
 *  - Desktop / mouse users are unaffected — no touch events fire.
 *
 * iOS / Android notes:
 *  - We don't preventDefault on touchmove because doing so would block scrolling
 *    elsewhere. Instead, we apply CSS overscroll-behavior: contain on the document
 *    so the native browser-level pull-to-refresh (Android Chrome especially)
 *    doesn't fight ours.
 *  - iOS rubber-band overscroll on top can still occur briefly; our indicator
 *    sits above it.
 */
export default function PullToRefresh({ onRefresh, children }) {
  const [pullDistance, setPullDistance] = useState(0)
  const [refreshing, setRefreshing] = useState(false)
  const startY = useRef(null)
  const startedAtTop = useRef(false)
  const canPull = useRef(false)

  // Suppress native browser pull-to-refresh while this component is mounted so
  // our handler is the only one responding. Restored on unmount.
  useEffect(() => {
    const prev = document.body.style.overscrollBehaviorY
    document.body.style.overscrollBehaviorY = 'contain'
    return () => {
      document.body.style.overscrollBehaviorY = prev
    }
  }, [])

  useEffect(() => {
    const handleTouchStart = (e) => {
      // Only arm the gesture if the page is scrolled to the top. We capture
      // this on touchstart because later in the gesture scrollY may change.
      if (window.scrollY > 0 || refreshing) {
        canPull.current = false
        return
      }
      startY.current = e.touches[0].clientY
      startedAtTop.current = true
      canPull.current = true
    }

    const handleTouchMove = (e) => {
      if (!canPull.current || refreshing) return
      const currentY = e.touches[0].clientY
      const delta = currentY - startY.current
      if (delta > 0) {
        // Rubber-banding: square-root curve makes the pull feel like it's
        // working against resistance the further you go.
        const dampened = Math.min(MAX_PULL, Math.sqrt(delta) * 8)
        setPullDistance(dampened)
      } else {
        // User scrolled up past start — abandon gesture
        setPullDistance(0)
        canPull.current = false
      }
    }

    const handleTouchEnd = async () => {
      if (!canPull.current) {
        setPullDistance(0)
        return
      }
      canPull.current = false
      const shouldRefresh = pullDistance >= PULL_THRESHOLD
      if (shouldRefresh) {
        setRefreshing(true)
        // Snap indicator to its resting position while refresh runs
        setPullDistance(INDICATOR_HEIGHT)
        try {
          await onRefresh?.()
        } catch (err) {
          console.error('PullToRefresh: onRefresh threw', err)
        } finally {
          setRefreshing(false)
          setPullDistance(0)
        }
      } else {
        // Cancel — snap back
        setPullDistance(0)
      }
    }

    // passive: true lets us observe without blocking scroll. We only want to
    // *observe* — we don't actually block scroll at any point.
    window.addEventListener('touchstart', handleTouchStart, { passive: true })
    window.addEventListener('touchmove', handleTouchMove, { passive: true })
    window.addEventListener('touchend', handleTouchEnd, { passive: true })
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true })

    return () => {
      window.removeEventListener('touchstart', handleTouchStart)
      window.removeEventListener('touchmove', handleTouchMove)
      window.removeEventListener('touchend', handleTouchEnd)
      window.removeEventListener('touchcancel', handleTouchEnd)
    }
  }, [pullDistance, refreshing, onRefresh])

  const reachedThreshold = pullDistance >= PULL_THRESHOLD
  // Indicator opacity ramps with pull: invisible at 0, fully solid past threshold
  const indicatorOpacity = Math.min(1, pullDistance / PULL_THRESHOLD)
  // Spinner rotation while pulling — visualizes "the harder you pull, the more it rotates"
  const indicatorRotation = (pullDistance / PULL_THRESHOLD) * 270

  // While refreshing OR while user is actively pulling, push the content down
  // by the pull distance so the indicator has room above. When idle, content
  // sits flush at the top.
  const contentTransform =
    pullDistance > 0
      ? `translate3d(0, ${pullDistance}px, 0)`
      : 'translate3d(0, 0, 0)'

  return (
    <>
      {/* Floating refresh indicator above the page content */}
      <div
        aria-hidden={pullDistance === 0 && !refreshing}
        className="fixed top-0 inset-x-0 z-30 flex justify-center pointer-events-none"
        style={{
          opacity: indicatorOpacity,
          transform: `translate3d(0, ${
            pullDistance > 0 ? pullDistance - 50 : -50
          }px, 0)`,
          transition: pullDistance === 0 || refreshing
            ? 'transform 250ms ease-out, opacity 250ms ease-out'
            : 'none',
        }}
      >
        <div className="bg-white shadow-md rounded-full p-2 flex items-center justify-center">
          {refreshing ? (
            <Spinner spinning />
          ) : (
            <Spinner
              rotation={indicatorRotation}
              colored={reachedThreshold}
            />
          )}
        </div>
      </div>

      {/* Page content — translated downward during pull */}
      <div
        style={{
          transform: contentTransform,
          transition:
            pullDistance === 0 ? 'transform 250ms ease-out' : 'none',
          willChange: 'transform',
        }}
      >
        {children}
      </div>
    </>
  )
}

/**
 * Spinner — single SVG used in both pulling and refreshing states.
 *  - `rotation` prop (0..270): degrees of rotation while pulling
 *  - `spinning` prop: applies a continuous spin animation (refreshing)
 *  - `colored` prop: turns the spinner cyan once the threshold is met
 */
function Spinner({ rotation = 0, spinning = false, colored = false }) {
  return (
    <svg
      width="22"
      height="22"
      viewBox="0 0 24 24"
      fill="none"
      className={`${
        spinning ? 'animate-spin' : ''
      } ${colored || spinning ? 'text-cyan-600' : 'text-gray-400'}`}
      style={
        spinning
          ? undefined
          : { transform: `rotate(${rotation}deg)`, transition: 'transform 80ms linear' }
      }
      aria-hidden="true"
    >
      <path
        d="M12 4v3"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
      <path
        d="M12 21a9 9 0 1 1 9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        opacity="0.4"
      />
    </svg>
  )
}
