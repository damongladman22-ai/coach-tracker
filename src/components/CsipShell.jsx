import { Outlet, useLocation, Link } from 'react-router-dom'
import OPLogo from './OPLogo'
import HamburgerMenu from './HamburgerMenu'

/**
 * CsipShell — shared chrome for every CSIP surface (Explore index, program
 * profile, Landscape). Rendered as a react-router layout route inside CsipGate,
 * so all three sit under one consistent header with Explore | Landscape tabs.
 *
 * The tabs are CSIP's OWN internal nav; the drawer (HamburgerMenu) stays as the
 * exit back to the club app. A profile is a drill-down under Explore, so the
 * Explore tab stays active on /school/:id (its own back-link returns to the index).
 */
function tabCls(active) {
  return [
    'text-sm py-2.5 border-b-2 transition-colors',
    active ? 'text-white border-white' : 'text-gray-400 border-transparent hover:text-gray-200',
  ].join(' ')
}

export default function CsipShell() {
  const { pathname } = useLocation()
  const onLandscape = pathname.startsWith('/landscape')

  return (
    <>
      <header className="bg-[#0a1628] text-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between h-14">
            <div className="flex items-center gap-2.5 min-w-0">
              <OPLogo className="h-9 w-9 flex-shrink-0" />
              <span className="text-sm font-semibold truncate">College Soccer Intelligence</span>
            </div>
            <HamburgerMenu />
          </div>
          <nav className="flex gap-6 border-t border-[#22314e]" aria-label="College Soccer Intelligence">
            <Link to="/schools" className={tabCls(!onLandscape)}>Explore</Link>
            <Link to="/landscape" className={tabCls(onLandscape)}>Landscape</Link>
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  )
}
