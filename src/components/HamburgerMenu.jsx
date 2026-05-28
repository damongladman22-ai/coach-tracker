import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

/**
 * HamburgerMenu — right-side slide-out drawer for parent-facing pages.
 *
 * Replaces the inline "Coach Directory | Help | Admin" link cluster that
 * used to sit on the right of every parent page header. Cleaner on phones,
 * no horizontal crowding, room for more items as the app grows.
 *
 * Drawer items:
 *  - Coach Directory      → /directory
 *  - Help                  → /help?context=parent
 *  - Submit Feedback       → fires 'open-feedback' window event so the
 *                            existing FeedbackButton opens its modal
 *  - Admin Login           → /admin   (secondary, at the bottom)
 *
 * Backdrop tap or Escape closes. Body scroll locked while open.
 * Built pure React + Tailwind + CSS transitions (no external lib).
 *
 * Props:
 *  - className?: extra classes for the trigger button (positioning, etc.)
 *  - dark?: when the surrounding header is dark, render the trigger icon
 *           in white instead of dark-gray. Defaults to true (parent pages
 *           all have dark headers today).
 */
export default function HamburgerMenu({ className = '', dark = true }) {
  const [open, setOpen] = useState(false)

  // Escape closes; lock body scroll while open
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

  const close = () => setOpen(false)

  const openFeedback = () => {
    close()
    // Small delay so the close animation starts before the modal pops,
    // avoiding a visual collision.
    setTimeout(() => {
      window.dispatchEvent(new Event('open-feedback'))
    }, 180)
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Open menu"
        aria-expanded={open}
        className={`rounded-md p-2 -m-2 ${
          dark
            ? 'text-gray-300 hover:text-white hover:bg-white/10 active:bg-white/20'
            : 'text-gray-700 hover:text-gray-900 hover:bg-gray-100 active:bg-gray-200'
        } ${className}`}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M3 6h18M3 12h18M3 18h18" />
        </svg>
      </button>

      {/* Drawer + backdrop — always rendered, animated via opacity / translate */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          open ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!open}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40"
          onClick={close}
          role="button"
          aria-label="Close menu"
          tabIndex={-1}
        />

        {/* Drawer panel — slides in from the right */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute top-0 right-0 h-full w-[280px] max-w-[85%] bg-white shadow-2xl transition-transform duration-300 ease-out ${
            open ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div>
              <div className="text-xs uppercase tracking-wider text-gray-500">
                PitchSide
              </div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">
                Ohio Premier Soccer
              </div>
            </div>
            <button
              type="button"
              onClick={close}
              aria-label="Close menu"
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

          {/* Primary nav items */}
          <nav className="py-2">
            <DrawerLink to="/home" onClick={close} icon={HomeIcon}>
              Home
            </DrawerLink>
            <DrawerLink to="/directory" onClick={close} icon={DirectoryIcon}>
              Coach Directory
            </DrawerLink>
            <DrawerLink
              to="/help?context=parent"
              onClick={close}
              icon={HelpIcon}
            >
              Help
            </DrawerLink>
            <DrawerButton onClick={openFeedback} icon={FeedbackIcon}>
              Submit Feedback
            </DrawerButton>

            {/* Secondary nav (admin) — rendered inline as a normal block,
                separated by a top border. Previously sat in an
                absolute-positioned bottom strip which could be hidden by
                safe-area padding or just blend into the background; the
                inline placement is reliable across viewports. */}
            <div className="mt-2 pt-2 border-t border-gray-200 px-2">
              <Link
                to="/admin"
                onClick={close}
                className="block px-3 py-2 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-50 rounded"
              >
                Admin Login
              </Link>
            </div>
          </nav>
        </div>
      </div>
    </>
  )
}

/** Single drawer link row — Link variant. */
function DrawerLink({ to, onClick, icon: Icon, children }) {
  return (
    <Link
      to={to}
      onClick={onClick}
      className="flex items-center gap-3 px-5 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 active:bg-gray-100"
      style={{ minHeight: 48 }}
    >
      {Icon && <Icon />}
      <span>{children}</span>
    </Link>
  )
}

/** Single drawer button row — for actions that aren't navigations. */
function DrawerButton({ onClick, icon: Icon, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3 px-5 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 active:bg-gray-100 text-left"
      style={{ minHeight: 48 }}
    >
      {Icon && <Icon />}
      <span>{children}</span>
    </button>
  )
}

/* Minimal inline icons — keeps the drawer self-contained, no external icon lib. */

function HomeIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-500 flex-shrink-0"
      aria-hidden="true"
    >
      <path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <polyline points="9 22 9 12 15 12 15 22" />
    </svg>
  )
}

function DirectoryIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-500 flex-shrink-0"
      aria-hidden="true"
    >
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="9" cy="7" r="4" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  )
}

function HelpIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-500 flex-shrink-0"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}

function FeedbackIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-gray-500 flex-shrink-0"
      aria-hidden="true"
    >
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}
