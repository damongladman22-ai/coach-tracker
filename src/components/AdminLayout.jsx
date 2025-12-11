import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

export default function AdminLayout({ session, title, children }) {
  const navigate = useNavigate()

  const handleLogout = async () => {
    await supabase.auth.signOut()
    navigate('/admin')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      {/* Header */}
      <header className="bg-white shadow">
        <div className="max-w-7xl mx-auto px-4 py-4 flex justify-between items-center">
          <div className="flex items-center space-x-6">
            <Link to="/admin" className="text-xl font-bold text-blue-600">
              Coach Tracker
            </Link>
            <nav className="hidden md:flex space-x-4">
              <Link to="/admin/teams" className="text-gray-600 hover:text-gray-900">
                Teams
              </Link>
              <Link to="/admin/events" className="text-gray-600 hover:text-gray-900">
                Events
              </Link>
              <Link to="/admin/schools" className="text-gray-600 hover:text-gray-900">
                Schools
              </Link>
            </nav>
          </div>
          <div className="flex items-center space-x-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{session?.user?.email}</span>
            <button
              onClick={handleLogout}
              className="text-sm text-red-600 hover:text-red-800"
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
