import { Link } from 'react-router-dom'
import AdminLayout from './AdminLayout'
import { useIsSuperAdmin } from '../lib/useIsSuperAdmin'

/**
 * OwnerLayout — shell for the walled-off /owner section (platform owner only).
 *
 * The owner/admin boundary lives here: this is the single place the super-admin
 * check is enforced for owner pages, and it carries the owner nav. AdminLayout
 * is just the chrome (header, drawer, logout) and renders whatever nav it's
 * given — it has no owner-specific logic. RLS is the real security gate; this
 * controls visibility and keeps club admins out of the owner surfaces.
 *
 * Index 0 of the nav is the "home" target behind the brand logo; for the owner
 * section that's the club Dashboard, giving a one-tap path back to /admin.
 */
const OWNER_LINKS = [
  { to: '/admin', label: 'Dashboard' },
  { to: '/owner/coach-review', label: 'Coach Review' },
  { to: '/owner/schools', label: 'Schools' },
  { to: '/owner/import', label: 'Import Coaches' },
  { to: '/owner/dedup', label: 'Dedup Coaches' },
  { to: '/owner/dedup-schools', label: 'Dedup Schools' },
]

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
    <AdminLayout session={session} title={title} links={OWNER_LINKS} section="Owner">
      {children}
    </AdminLayout>
  )
}
