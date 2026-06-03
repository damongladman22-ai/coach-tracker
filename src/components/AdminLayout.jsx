import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'
import OPLogo from './OPLogo'

/**
 * AdminLayout — the shell for every admin and owner page.
 *
 * Desktop (md+): a persistent dark left sidebar with grouped sections and a
 * collapse toggle (icons-only), state remembered in localStorage. Sidebars suit
 * a tool people work in — nav stays visible and discoverable, and grouping
 * scales as features grow — which a flat top bar didn't.
 *
 * Mobile (<md): a slim brand top bar with a hamburger that opens a left
 * slide-out drawer carrying the same grouped nav.
 *
 * The component is generic chrome: it renders whatever `groups` it's given
 * (default = club-admin nav) and has no owner-specific logic — OwnerLayout
 * passes the owner groups + section.
 */

const CLUB_GROUPS = [
  { items: [{ to: '/admin', label: 'Dashboard', icon: 'home' }] },
  {
    heading: 'Club',
    items: [
      { to: '/admin/seasons', label: 'Seasons', icon: 'calendar' },
      { to: '/admin/teams', label: 'Teams', icon: 'users' },
      { to: '/admin/athleteone-discover', label: 'Discover Teams', icon: 'search' },
      { to: '/admin/events', label: 'Events', icon: 'flag' },
    ],
  },
  {
    heading: 'Recruiting',
    items: [{ to: '/directory?context=admin', label: 'Directory', icon: 'book' }],
  },
  {
    heading: 'Settings',
    items: [
      { to: '/admin/feedback', label: 'Feedback', icon: 'chat' },
      { to: '/admin/admins', label: 'Admins', icon: 'shield' },
      { to: '/help?context=admin', label: 'Help', icon: 'help' },
    ],
  },
]

// Appended to the sidebar for platform owners only (super-admins). Visibility
// lives here; access to the pages themselves is gated by OwnerLayout + RLS.
const OWNER_GROUP = {
  heading: 'Owner',
  divider: true,
  items: [
    { to: '/owner/coach-review', label: 'Coach Review', icon: 'clipboard' },
    { to: '/owner/schools', label: 'Schools', icon: 'building' },
    { to: '/owner/import', label: 'Import Coaches', icon: 'upload' },
    { to: '/owner/dedup', label: 'Dedup Coaches', icon: 'layers' },
    { to: '/owner/dedup-schools', label: 'Dedup Schools', icon: 'layers' },
  ],
}

const ICONS = {
  home: 'M3 11.5 12 4l9 7.5M5 10v9h5v-5h4v5h5v-9',
  calendar:
    'M7 3v3m10-3v3M4 8h16M5 6h14a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z',
  users:
    'M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm13 8v-1a4 4 0 0 0-3-3.87M16 4.13a4 4 0 0 1 0 7.74',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm10 2-4.35-4.35',
  flag: 'M5 21V4c4-2 8 2 12 0v9c-4 2-8-2-12 0',
  book: 'M5 4h11a2 2 0 0 1 2 2v14a2 2 0 0 0-2-2H5V4Zm0 0v14',
  chat: 'M21 12a8 8 0 0 1-11.5 7.2L4 20l1-4.5A8 8 0 1 1 21 12Z',
  shield: 'M12 3l7 3v6c0 4-3 7-7 9-4-2-7-5-7-9V6l7-3Z',
  help: 'M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-1 .5-1.5 1-1.5 2.2M12 17h.01M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  clipboard:
    'M9 4h6a1 1 0 0 1 1 1v1H8V5a1 1 0 0 1 1-1Zm-1 2H6a1 1 0 0 0-1 1v13a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1h-2m-7 7 2 2 4-4',
  building: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3',
  upload: 'M12 16V4m0 0 4 4m-4-4-4 4M4 17v2a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-2',
  layers: 'M12 3 3 8l9 5 9-5-9-5Zm-9 9 9 5 9-5',
  logout: 'M15 12H3m0 0 4-4m-4 4 4 4M11 4h6a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-6',
  chevron: 'm14 6-6 6 6 6',
}

function Icon({ name, className = 'h-5 w-5' }) {
  const d = ICONS[name] || ICONS.home
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={d} />
    </svg>
  )
}

const pathOf = (to) => to.split('?')[0]

export default function AdminLayout({ session, title, children, section = 'Admin' }) {
  const navigate = useNavigate()
  const location = useLocation()
  const isSuper = useIsSuperAdmin(session) === 'allowed'
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [collapsed, setCollapsed] = useState(() => {
    try {
      return localStorage.getItem('pitchside_sidebar_collapsed') === '1'
    } catch {
      return false
    }
  })

  const navGroups = isSuper ? [...CLUB_GROUPS, OWNER_GROUP] : CLUB_GROUPS

  useEffect(() => {
    try {
      localStorage.setItem('pitchside_sidebar_collapsed', collapsed ? '1' : '0')
    } catch {
      /* ignore */
    }
  }, [collapsed])

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin')
  }

  // Drawer: lock body scroll + Escape to close (mirrors the parent HamburgerMenu).
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

  const isActive = (to) => {
    const p = pathOf(to)
    if (p === '/admin') return location.pathname === '/admin'
    return location.pathname === p || location.pathname.startsWith(p + '/')
  }

  const renderGroups = (compact, onNavigate) => (
    <nav className="flex-1 overflow-y-auto py-2">
      {navGroups.map((group, gi) => (
        <div key={gi} className="px-2">
          {group.divider && !compact && <div className="mx-3 my-2 border-t border-white/10" />}
          {group.heading && !compact && (
            <div className="px-3 pt-2 pb-1 text-[11px] font-semibold uppercase tracking-wider text-gray-500">
              {group.heading}
            </div>
          )}
          {group.heading && compact && gi > 0 && <div className="my-2 border-t border-white/10" />}
          {group.items.map((item) => {
            const active = isActive(item.to)
            return (
              <Link
                key={item.to}
                to={item.to}
                onClick={onNavigate}
                title={compact ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors ${
                  active
                    ? 'bg-white/15 text-white font-medium'
                    : 'text-gray-300 hover:text-white hover:bg-white/10'
                } ${compact ? 'justify-center' : ''}`}
              >
                <Icon name={item.icon} className="h-5 w-5 shrink-0" />
                {!compact && <span className="truncate">{item.label}</span>}
              </Link>
            )
          })}
        </div>
      ))}
    </nav>
  )

  return (
    <div className="min-h-screen bg-gray-100 md:flex">
      {/* Desktop sidebar */}
      <aside
        className={`hidden md:flex md:flex-col md:sticky md:top-0 md:h-screen shrink-0 bg-gray-900 transition-all duration-200 ${
          collapsed ? 'md:w-16' : 'md:w-60'
        }`}
      >
        {/* Brand */}
        <div className="flex items-center gap-2 px-3 h-16 border-b border-white/10">
          <Link to="/admin" className="flex items-center gap-2 min-w-0 hover:opacity-90 transition-opacity">
            <OPLogo className="h-8 w-auto shrink-0" />
            {!collapsed && <span className="text-lg font-bold text-white truncate">PitchSide</span>}
          </Link>
        </div>

        {section && section !== 'Admin' && !collapsed && (
          <div className="px-3 pt-3">
            <span className="text-[11px] font-semibold uppercase tracking-wider text-amber-300 border border-amber-300/40 rounded px-2 py-0.5">
              {section}
            </span>
          </div>
        )}

        {renderGroups(collapsed)}

        {/* Footer: user + logout + collapse toggle */}
        <div className="border-t border-white/10 p-2">
          {!collapsed && session?.user?.email && (
            <div className="px-3 py-1 text-xs text-gray-400 truncate">{session.user.email}</div>
          )}
          <button
            onClick={handleLogout}
            title={collapsed ? 'Log Out' : undefined}
            className={`flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm text-red-300 hover:text-red-200 hover:bg-white/10 transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <Icon name="logout" className="h-5 w-5 shrink-0" />
            {!collapsed && <span>Log Out</span>}
          </button>
          <button
            onClick={() => setCollapsed((c) => !c)}
            title={collapsed ? 'Expand' : 'Collapse'}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`mt-1 flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm text-gray-400 hover:text-white hover:bg-white/10 transition-colors ${
              collapsed ? 'justify-center' : ''
            }`}
          >
            <Icon name="chevron" className={`h-5 w-5 shrink-0 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
            {!collapsed && <span>Collapse</span>}
          </button>
        </div>
      </aside>

      {/* Main column */}
      <div className="flex-1 min-w-0 flex flex-col">
        {/* Mobile top bar */}
        <header className="op-header shadow-lg md:hidden">
          <div className="op-gradient-border"></div>
          <div className="flex items-center justify-between px-4 h-14">
            <Link to="/admin" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
              <OPLogo className="h-8 w-auto" />
              <span className="text-lg font-bold text-white">PitchSide</span>
            </Link>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
              aria-expanded={drawerOpen}
              className="rounded-md p-2 -m-2 text-gray-300 hover:text-white hover:bg-white/10 active:bg-white/20"
            >
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M3 6h18M3 12h18M3 18h18" />
              </svg>
            </button>
          </div>
        </header>

        <main className="max-w-7xl w-full mx-auto px-4 py-8">
          {title && <h1 className="text-2xl font-bold text-gray-800 mb-6">{title}</h1>}
          {children}
        </main>
      </div>

      {/* Mobile slide-out drawer (left) */}
      <div
        className={`md:hidden fixed inset-0 z-50 transition-opacity duration-300 ${
          drawerOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
        aria-hidden={!drawerOpen}
      >
        <div className="absolute inset-0 bg-black/40" onClick={closeDrawer} role="button" aria-label="Close menu" tabIndex={-1} />
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
          className={`absolute top-0 left-0 h-full w-[280px] max-w-[85%] bg-gray-900 shadow-2xl flex flex-col transition-transform duration-300 ease-out ${
            drawerOpen ? 'translate-x-0' : '-translate-x-full'
          }`}
          style={{ paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)' }}
        >
          <div className="flex items-center justify-between px-4 h-14 border-b border-white/10">
            <div className="flex items-center gap-2 min-w-0">
              <OPLogo className="h-8 w-auto shrink-0" />
              <span className="text-base font-semibold text-white truncate">{section}</span>
            </div>
            <button type="button" onClick={closeDrawer} aria-label="Close menu" className="rounded-full p-2 text-gray-300 hover:bg-white/10 active:bg-white/20">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          {renderGroups(false, closeDrawer)}

          <div className="border-t border-white/10 p-2">
            {session?.user?.email && <div className="px-3 py-1 text-xs text-gray-400 truncate">{session.user.email}</div>}
            <button
              type="button"
              onClick={() => {
                closeDrawer()
                handleLogout()
              }}
              className="flex items-center gap-3 w-full rounded-md px-3 py-2 text-sm text-red-300 hover:text-red-200 hover:bg-white/10"
            >
              <Icon name="logout" className="h-5 w-5 shrink-0" />
              <span>Log Out</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
