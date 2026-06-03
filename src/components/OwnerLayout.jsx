import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'

/**
 * OwnerLayout — the access gate for the /owner section (platform owner only).
 *
 * It does two things: enforce the super-admin check for owner pages, and set
 * the "Owner" section badge. It does NOT define its own nav — AdminLayout shows
 * the unified sidebar (club groups + the Owner group for super-admins) on every
 * page, so an owner has one consistent menu wherever they are. RLS is the real
 * security gate; this keeps non-owners out of the owner surfaces.
 */
export default function OwnerLayout({ session, title, children }) {
  const status = useIsSuperAdmin(session)

  if (status === 'checking') {
    return (
      <AdminLayout session={session} title={title}>
        <div className="text-gray-500">Checking access…</div>
      </AdminLayout>
    )
  }

  if (status === 'denied') {
    return (
      <AdminLayout session={session} title={title}>
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold text-gray-800 mb-2">Not authorized</h2>
          <p className="text-gray-600">The owner tools are limited to platform owners.</p>
          <Link to="/admin" className="text-blue-600 hover:text-blue-700 text-sm mt-4 inline-block">
            ← Back to Dashboard
          </Link>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title={title} section="Owner">
      {children}
    </AdminLayout>
  )
}
