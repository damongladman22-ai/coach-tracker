import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function ManageAdmins({ session }) {
  const [admins, setAdmins] = useState([])
  const [invites, setInvites] = useState([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [toast, setToast] = useState(null)
  
  // Form state
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')

  useEffect(() => {
    fetchData()
  }, [])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const fetchData = async () => {
    try {
      // Fetch all invites
      const { data: inviteData, error } = await supabase
        .from('allowed_admins')
        .select('*')
        .order('invited_at', { ascending: false })

      if (error) throw error

      // Separate registered vs pending
      const registered = inviteData?.filter(i => i.registered_at) || []
      const pending = inviteData?.filter(i => !i.registered_at) || []

      setAdmins(registered)
      setInvites(pending)
    } catch (err) {
      console.error('Error fetching admins:', err)
      showToast('Error loading admin list', 'error')
    } finally {
      setLoading(false)
    }
  }

  const sendInvite = async (e) => {
    e.preventDefault()
    
    if (!name.trim() || !email.trim()) {
      showToast('Please enter both name and email', 'error')
      return
    }

    // Basic email validation
    if (!email.includes('@') || !email.includes('.')) {
      showToast('Please enter a valid email address', 'error')
      return
    }

    setSending(true)

    try {
      // Call the Edge Function
      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/invite-admin`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_ANON_KEY}`
          },
          body: JSON.stringify({
            name: name.trim(),
            email: email.trim().toLowerCase(),
            invitedBy: session.user.id,
            inviterName: session.user.email
          })
        }
      )

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send invitation')
      }

      showToast(`Invitation sent to ${email}`)
      setName('')
      setEmail('')
      fetchData()
    } catch (err) {
      console.error('Error sending invite:', err)
      showToast(err.message || 'Error sending invitation', 'error')
    } finally {
      setSending(false)
    }
  }

  const cancelInvite = async (invite) => {
    if (!confirm(`Cancel invitation for ${invite.name}?`)) return

    try {
      const { error } = await supabase
        .from('allowed_admins')
        .delete()
        .eq('id', invite.id)

      if (error) throw error

      showToast('Invitation cancelled')
      fetchData()
    } catch (err) {
      console.error('Error cancelling invite:', err)
      showToast('Error cancelling invitation', 'error')
    }
  }

  const formatDate = (dateStr) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  if (loading) {
    return (
      <AdminLayout session={session} title="Manage Admins">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title="Manage Admins">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg ${
          toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'
        } text-white max-w-md`}>
          {toast.message}
        </div>
      )}

      <div className="grid md:grid-cols-2 gap-6">
        {/* Invite Form */}
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold mb-4">Invite New Admin</h2>
          <p className="text-sm text-gray-600 mb-4">
            Enter the name and email of the person you want to invite. They'll receive an email with a link to create their account.
          </p>
          
          <form onSubmit={sendInvite} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Name
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Jane Smith"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={sending}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="jane@example.com"
                className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                disabled={sending}
              />
            </div>
            
            <button
              type="submit"
              disabled={sending}
              className="w-full bg-blue-600 text-white py-2 px-4 rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
            >
              {sending ? (
                <span className="flex items-center justify-center gap-2">
                  <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Sending Invitation...
                </span>
              ) : (
                'Send Invitation'
              )}
            </button>
          </form>
        </div>

        {/* Info Card */}
        <div className="bg-blue-50 rounded-lg p-6">
          <h3 className="font-semibold text-blue-900 mb-2">How it works</h3>
          <ul className="space-y-2 text-sm text-blue-800">
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">1.</span>
              Enter the person's name and email above
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">2.</span>
              They'll receive an email invitation
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">3.</span>
              Clicking the link lets them set their password
            </li>
            <li className="flex items-start gap-2">
              <span className="text-blue-500 mt-0.5">4.</span>
              Once registered, they have full admin access
            </li>
          </ul>
          <div className="mt-4 p-3 bg-blue-100 rounded-lg">
            <p className="text-xs text-blue-700">
              <strong>Note:</strong> Invitation links expire after 24 hours. You can resend by cancelling the pending invite and sending a new one.
            </p>
          </div>
        </div>
      </div>

      {/* Pending Invites */}
      <div className="mt-8 bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold">Pending Invitations</h2>
        </div>
        {invites.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No pending invitations
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Invited</th>
                <th className="px-6 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {invites.map((invite) => (
                <tr key={invite.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">{invite.name}</td>
                  <td className="px-6 py-4 text-gray-600">{invite.email}</td>
                  <td className="px-6 py-4 text-gray-500 text-sm">
                    {formatDate(invite.invited_at)}
                  </td>
                  <td className="px-6 py-4">
                    <button
                      onClick={() => cancelInvite(invite)}
                      className="text-red-600 hover:text-red-800 text-sm font-medium"
                    >
                      Cancel
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Current Admins */}
      <div className="mt-6 bg-white rounded-lg shadow-md overflow-hidden">
        <div className="px-6 py-4 border-b bg-gray-50">
          <h2 className="text-lg font-semibold">Current Admins</h2>
        </div>
        {admins.length === 0 ? (
          <div className="p-6 text-center text-gray-500">
            No registered admins yet (invites that have been accepted will appear here)
          </div>
        ) : (
          <table className="w-full">
            <thead className="bg-gray-50 text-left text-sm text-gray-600">
              <tr>
                <th className="px-6 py-3 font-medium">Name</th>
                <th className="px-6 py-3 font-medium">Email</th>
                <th className="px-6 py-3 font-medium">Registered</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {admins.map((admin) => (
                <tr key={admin.id} className="hover:bg-gray-50">
                  <td className="px-6 py-4">{admin.name}</td>
                  <td className="px-6 py-4 text-gray-600">{admin.email}</td>
                  <td className="px-6 py-4 text-gray-500 text-sm">
                    {formatDate(admin.registered_at)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Current User Note */}
      <div className="mt-6 text-center text-sm text-gray-500">
        You are logged in as <strong>{session.user.email}</strong>
      </div>
    </AdminLayout>
  )
}
