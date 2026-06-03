import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from './OPLogo'

/**
 * AdminLayout — shell for every admin page.
 *
 * Desktop (md+): horizontal inline nav across the header. Admins live on
 * desktops and prefer visible navigation; collapsing into a hamburger there
 * would hide context they use frequently.
 *
 * Mobile (<md): right-side slide-out drawer with the same animation, backdrop,
 * and behavior as the parent-facing HamburgerMenu. Replaces the older fold-
 * down menu that lived inline under the header. Body scroll locks while
 * open; Escape and backdrop tap close it.
 */
export default function AdminLayout({ session, title, children, links, section = 'Admin' }) {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin')
  }

  // Default (club-admin) nav. Owner surfaces are NOT here — they live in
  // OwnerLayout, which passes its own `links`. AdminLayout just renders whatever
  // nav it's given.
  const navLinks = [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/seasons', label: 'Seasons' },
    { to: '/admin/teams', label: 'Teams' },
    { to: '/admin/athleteone-discover', label: 'Discover Teams' },
    { to: '/admin/events', label: 'Events' },
    { to: '/directory?context=admin', label: 'Directory' },
    { to: '/admin/feedback', label: 'Feedback' },
    { to: '/admin/admins', label: 'Admins' },
    { to: '/help?context=admin', label: 'Help' },
  ]

  const navItems = links || navLinks
  const homeTo = navItems[0]?.to || '/admin'

  // Drawer behavior: lock body scroll + Escape to close, mirroring the parent
  // HamburgerMenu so the two feel like the same component on mobile.
  useEffect(() => {
    if (!drawerOpen) return
    const handler = (e) => {
      if (e.key === 'Escape') setDrawerOpen(false)
    }
    document.addEventListener('keydown', handler)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = prev
    }
  }, [drawerOpen])

  const closeDrawer = () => setDrawerOpen(false)

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="op-header shadow-lg">
        <div className="op-gradient-border"></div>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <Link to={homeTo} className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <OPLogo className="h-10 w-auto" />
              <span className="text-xl font-bold text-white">PitchSide</span>
            </Link>
            {section && section !== 'Admin' && (
              <span className="hidden sm:inline text-xs font-semibold uppercase tracking-wider text-amber-300 border border-amber-300/40 rounded px-2 py-0.5">
                {section}
              </span>
            )}
            {/* Desktop Nav */}
            <nav className="hidden md:flex space-x-4">
              {navItems.slice(1).map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  className="text-gray-300 hover:text-white transition-colors"
                >
                  {link.label}
                </Link>
              ))}
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-400 hidden sm:inline">{session?.user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-400 hover:text-red-300 transition-colors hidden sm:inline"
            >
              Log Out
            </button>
            {/* Mobile hamburger trigger */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="md:hidden rounded-md p-2 -m-2 text-gray-300 hover:text-white hover:bg-white/10 active:bg-white/20"
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
          </div>
        </div>
      </header>

      {/* Mobile slide-out drawer — always rendered, animated via translate */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!drawerOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/40"
          onClick={closeDrawer}
          role="button"
          aria-label="Close menu"
          tabIndex={-1}
        />

        {/* Drawer panel */}
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Admin menu"
          className={`absolute top-0 right-0 h-full w-[280px] max-w-[85%] bg-white shadow-2xl transition-transform duration-300 ease-out ${
            drawerOpen ? 'translate-x-0' : 'translate-x-full'
          }`}
          style={{
            paddingTop: 'env(safe-area-inset-top)',
            paddingBottom: 'env(safe-area-inset-bottom)',
          }}
        >
          {/* Drawer header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-200">
            <div className="min-w-0 flex-1">
              <div className="text-xs uppercase tracking-wider text-gray-500">
                PitchSide
              </div>
              <div className="text-sm font-semibold text-gray-900 mt-0.5">
                {section}
              </div>
            </div>
            <button
              type="button"
              onClick={closeDrawer}
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

          {/* Nav items */}
          <nav className="py-2 overflow-y-auto" style={{ maxHeight: 'calc(100% - 160px)' }}>
            {navItems.map((link) => (
              <Link
                key={link.to}
                to={link.to}
                onClick={closeDrawer}
                className="block px-5 py-3 text-sm font-medium text-gray-800 hover:bg-gray-50 active:bg-gray-100"
                style={{ minHeight: 48 }}
              >
                {link.label}
              </Link>
            ))}
          </nav>

          {/* Bottom: user info + Log Out */}
          <div className="absolute bottom-0 inset-x-0 border-t border-gray-200 px-5 py-3 bg-gray-50">
            {session?.user?.email && (
              <div className="text-xs text-gray-500 truncate mb-2">
                {session.user.email}
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                closeDrawer()
                handleLogout()
              }}
              className="w-full text-left text-sm font-medium text-red-600 hover:text-red-700 hover:bg-red-50 active:bg-red-100 rounded-md px-2 py-2 -mx-2"
            >
              Log Out
            </button>
          </div>
        </div>
      </div>

      {/* Main Content */}
      <main className="max-w-7xl mx-auto px-4 py-8">
        {title && (
          <h1 className="text-2xl font-bold text-gray-800 mb-6">{title}</h1>
        )}
        {children}
      </main>
    </div>
  )
}
