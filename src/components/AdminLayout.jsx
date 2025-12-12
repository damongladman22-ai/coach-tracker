import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from './OPLogo'

export default function AdminLayout({ session, title, children }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="op-header shadow-lg">
        <div className="op-gradient-border"></div>
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <Link to="/admin" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <OPLogo className="h-10 w-auto" />
              <span className="text-xl font-bold text-white">Coach Tracker</span>
            </Link>
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
              <Link to="/admin/admins" className="text-gray-300 hover:text-white transition-colors">
                Admins
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
              className="text-sm text-red-400 hover:text-red-300 transition-colors"
            >
              Log Out
            </button>
          </div>
        </div>
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
