import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function AdminDashboard({ session }) {
  return (
    <AdminLayout session={session} title="Dashboard">
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Link
          to="/admin/teams"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Club Teams</h2>
          <p className="text-gray-600">Manage your club's teams</p>
        </Link>

        <Link
          to="/admin/events"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Events</h2>
          <p className="text-gray-600">Create and manage tournaments & showcases</p>
        </Link>

        <Link
          to="/admin/schools"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Schools & Coaches</h2>
          <p className="text-gray-600">View schools and manage coaches</p>
        </Link>
      </div>
    </AdminLayout>
  )
}
