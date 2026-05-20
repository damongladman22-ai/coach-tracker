import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClub, clearClubCache } from '../lib/club'

/**
 * Club settings page. Edit the current club's branding fields.
 *
 * For now there's a single club. When L3 (multi-club SaaS) ships,
 * this becomes the "current club's settings" with club switching
 * elsewhere.
 */
export default function ClubSettings({ session }) {
  const [club, setClub] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    loadClub()
  }, [])

  const loadClub = async () => {
    setLoading(true)
    const c = await getCurrentClub()
    setClub(c)
    setLoading(false)
  }

  const handleChange = (field, value) => {
    setClub({ ...club, [field]: value })
    setSaved(false)
  }

  const handleSave = async (e) => {
    e.preventDefault()
    if (!club) return
    setSaving(true)
    const { error } = await supabase
      .from('clubs')
      .update({
        name: club.name,
        slug: club.slug,
        logo_url: club.logo_url || null,
        primary_color: club.primary_color || null,
        secondary_color: club.secondary_color || null,
        accent_color: club.accent_color || null,
        custom_domain: club.custom_domain || null,
      })
      .eq('id', club.id)
    setSaving(false)
    if (error) {
      alert('Could not save: ' + error.message)
      return
    }
    clearClubCache()
    setSaved(true)
    setTimeout(() => setSaved(false), 3000)
  }

  if (loading)
    return (
      <AdminLayout session={session} title="Club Settings">
        <div className="text-center py-8">Loading...</div>
      </AdminLayout>
    )

  if (!club)
    return (
      <AdminLayout session={session} title="Club Settings">
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No club configured.
        </div>
      </AdminLayout>
    )

  return (
    <AdminLayout session={session} title="Club Settings">
      <div className="bg-white rounded-lg shadow-md p-6 max-w-2xl">
        <form onSubmit={handleSave} className="space-y-5" noValidate>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Club Name *
            </label>
            <input
              type="text"
              value={club.name || ''}
              onChange={(e) => handleChange('name', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Slug *
            </label>
            <input
              type="text"
              value={club.slug || ''}
              onChange={(e) => handleChange('slug', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
            <p className="text-xs text-gray-400 mt-1">
              Used in URLs and as a short identifier. Lowercase, hyphens, no spaces.
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Logo URL
            </label>
            <input
              type="text"
              value={club.logo_url || ''}
              onChange={(e) => handleChange('logo_url', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="https://..."
            />
            <p className="text-xs text-gray-400 mt-1">
              Optional. If blank, the bundled OP Soccer logo is used.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Primary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={club.primary_color || '#0b1f3a'}
                  onChange={(e) => handleChange('primary_color', e.target.value)}
                  className="h-10 w-12 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={club.primary_color || ''}
                  onChange={(e) => handleChange('primary_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="#0b1f3a"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Secondary Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={club.secondary_color || '#2196f3'}
                  onChange={(e) => handleChange('secondary_color', e.target.value)}
                  className="h-10 w-12 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={club.secondary_color || ''}
                  onChange={(e) => handleChange('secondary_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="#2196f3"
                />
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Accent Color
              </label>
              <div className="flex items-center gap-2">
                <input
                  type="color"
                  value={club.accent_color || '#00bcd4'}
                  onChange={(e) => handleChange('accent_color', e.target.value)}
                  className="h-10 w-12 rounded cursor-pointer"
                />
                <input
                  type="text"
                  value={club.accent_color || ''}
                  onChange={(e) => handleChange('accent_color', e.target.value)}
                  className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm"
                  placeholder="#00bcd4"
                />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-400 -mt-2">
            Colors are stored now and will drive header/accent styling in a later sprint.
          </p>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Custom Domain
            </label>
            <input
              type="text"
              value={club.custom_domain || ''}
              onChange={(e) => handleChange('custom_domain', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="(optional, e.g. tracker.opsoccer.com)"
            />
            <p className="text-xs text-gray-400 mt-1">
              Optional. Configure DNS separately; this just stores it.
            </p>
          </div>

          <div className="flex items-center gap-4">
            <button
              type="submit"
              disabled={saving}
              className="bg-blue-600 text-white px-5 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300"
            >
              {saving ? 'Saving...' : 'Save Changes'}
            </button>
            {saved && (
              <span className="text-green-600 text-sm">✓ Saved</span>
            )}
          </div>
        </form>
      </div>
    </AdminLayout>
  )
}
