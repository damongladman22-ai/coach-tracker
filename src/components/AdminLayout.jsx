import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from './OPLogo'

export default function AdminLayout({ session, title, children }) {
  const navigate = useNavigate()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin')
  }

  const navLinks = [
    { to: '/admin', label: 'Dashboard' },
    { to: '/admin/teams', label: 'Teams' },
    { to: '/admin/events', label: 'Events' },
    { to: '/admin/schools', label: 'Schools' },
    { to: '/admin/admins', label: 'Admins' },
    { to: '/help?context=admin', label: 'Help' },
  ]

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="op-header shadow-lg">
        <div className="op-gradient-border"></div>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <Link to="/admin" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <OPLogo className="h-10 w-auto" />
              <span className="text-xl font-bold text-white hidden sm:inline">Coach Tracker</span>
            </Link>
            {/* Desktop Nav */}
            <nav className="hidden md:flex space-x-4">
              <Link to="/admin/teams" className="text-gray-300 hover:text-white transition-colors">
                Teams
              </Link>
              <Link to="/admin/events" className="text-gray-300 hover:text-white transition-colors">
                Events
              </Link>
              <Link to="/admin/schools" className="text-gray-300 hover:text-white transition-colors">
                Schools
              </Link>
              <Link to="/help?context=admin" className="text-gray-300 hover:text-white transition-colors">
                Help
              </Link>
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
            {/* Mobile Menu Button */}
            <button
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="md:hidden text-white p-2"
              aria-label="Toggle menu"
            >
              {mobileMenuOpen ? (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {/* Mobile Menu */}
        {mobileMenuOpen && (
          <div className="md:hidden bg-[#0a1628] border-t border-gray-700">
            <nav className="px-4 py-3 space-y-1">
              {navLinks.map((link) => (
                <Link
                  key={link.to}
                  to={link.to}
                  onClick={() => setMobileMenuOpen(false)}
                  className="block px-3 py-2 text-gray-300 hover:text-white hover:bg-gray-700 rounded-lg transition-colors"
                >
                  {link.label}
                </Link>
              ))}
              <div className="border-t border-gray-700 mt-2 pt-2">
                <div className="px-3 py-2 text-sm text-gray-500">
                  {session?.user?.email}
                </div>
                <button
                  onClick={() => {
                    setMobileMenuOpen(false)
                    handleLogout()
                  }}
                  className="block w-full text-left px-3 py-2 text-red-400 hover:text-red-300 hover:bg-gray-700 rounded-lg transition-colors"
                >
                  Log Out
                </button>
              </div>
            </nav>
          </div>
        )}
      </header>

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
