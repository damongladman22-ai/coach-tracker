import { Outlet, useLocation, Link } from 'react-router-dom'
import OPLogo from './OPLogo'
import HamburgerMenu from './HamburgerMenu'
import { useAskAccess } from '../ask/askAccess'

/**
 * CsipShell — shared chrome for every CSIP surface (Explore index, program
 * profile, Landscape). Rendered as a react-router layout route inside CsipGate,
 * so all of them sit under one consistent header with Explore | Find programs |
 * Landscape tabs.
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

export default function CsipShell({ session }) {
  const { pathname } = useLocation()
  const onLandscape = pathname.startsWith('/landscape')
  const onFind = pathname.startsWith('/find')
  const onAsk = pathname.startsWith('/ask')
  // Ask PitchSide (backlog F2): the owner and pilot users (a personal pilot
  // link, no login) while in preview.
  const askStatus = useAskAccess(session).status
  const showAsk = askStatus === 'owner' || askStatus === 'pilot'

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
            <Link to="/schools" className={tabCls(!onLandscape && !onFind && !onAsk)}>Explore</Link>
            <Link to="/find" className={tabCls(onFind)}>Find programs</Link>
            <Link to="/landscape" className={tabCls(onLandscape)}>Landscape</Link>
            {showAsk && <Link to="/ask" className={tabCls(onAsk)}>Ask</Link>}
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  )
}
