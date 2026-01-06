import { useState, useEffect } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function AdminDashboard({ session }) {
  const [copied, setCopied] = useState(false)
  const [settings, setSettings] = useState({
    summary_email_enabled: true,
    directory_email_enabled: true
  })
  const [savingSettings, setSavingSettings] = useState(false)
  const [settingsToast, setSettingsToast] = useState({ show: false, message: '' })

  // Load settings on mount
  useEffect(() => {
    async function loadSettings() {
      const { data, error } = await supabase
        .from('app_settings')
        .select('key, value')
      
      if (data && data.length > 0) {
        const settingsObj = {}
        data.forEach(row => {
          settingsObj[row.key] = row.value === 'true'
        })
        setSettings(prev => ({ ...prev, ...settingsObj }))
      }
    }
    loadSettings()
  }, [])

  // Save a setting
  const updateSetting = async (key, value) => {
    setSavingSettings(true)
    
    // Upsert the setting
    const { error } = await supabase
      .from('app_settings')
      .upsert({ key, value: String(value) }, { onConflict: 'key' })
    
    if (error) {
      console.error('Error saving setting:', error)
      setSettingsToast({ show: true, message: 'Failed to save setting' })
    } else {
      setSettings(prev => ({ ...prev, [key]: value }))
      setSettingsToast({ show: true, message: 'Setting saved!' })
    }
    
    setSavingSettings(false)
    setTimeout(() => setSettingsToast({ show: false, message: '' }), 2000)
  }

  const getClubLink = () => {
    return `${window.location.origin}/home`
  }

  const copyClubLink = () => {
    navigator.clipboard.writeText(getClubLink())
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <AdminLayout session={session} title="Dashboard">
      {/* Share with Parents/Players Section */}
      <div className="bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg shadow-lg p-6 mb-6 text-white">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold mb-1">Share with Parents/Players</h2>
            <p className="text-blue-100 text-sm">
              Send this link to your club — parents and players can find their team and track coach attendance
            </p>
          </div>
          <div className="flex items-center gap-3">
            <code className="bg-white/20 px-3 py-2 rounded text-sm font-mono hidden sm:block">
              {getClubLink()}
            </code>
            <button
              onClick={copyClubLink}
              className={`px-4 py-2 rounded-lg font-medium transition-all flex items-center gap-2 ${
                copied 
                  ? 'bg-green-500 text-white' 
                  : 'bg-white text-blue-600 hover:bg-blue-50'
              }`}
            >
              {copied ? (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  Copied!
                </>
              ) : (
                <>
                  <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                  </svg>
                  Copy Link
                </>
              )}
            </button>
          </div>
        </div>
        <div className="mt-3 pt-3 border-t border-white/20">
          <Link
            to="/home"
            className="text-sm text-blue-100 hover:text-white inline-flex items-center gap-1"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
            Preview what parents/players see →
          </Link>
        </div>
      </div>

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

        <Link
          to="/admin/import"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border-2 border-dashed border-gray-300"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Import Coaches</h2>
          <p className="text-gray-600">Bulk import coaches from Excel or CSV</p>
        </Link>

        <Link
          to="/admin/dedup"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border-2 border-dashed border-gray-300"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Dedup Coaches</h2>
          <p className="text-gray-600">Find and merge duplicate coaches</p>
        </Link>

        <Link
          to="/admin/dedup-schools"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow border-2 border-dashed border-gray-300"
        >
          <h2 className="text-xl font-semibold text-gray-800 mb-2">Dedup Schools</h2>
          <p className="text-gray-600">Find and merge duplicate schools</p>
        </Link>
      </div>

      {/* Settings Section */}
      <h2 className="text-lg font-semibold text-gray-700 mt-8 mb-4">Settings & Help</h2>
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {/* Email Settings Card */}
        <div className="bg-white p-6 rounded-lg shadow-md">
          <div className="flex items-center gap-3 mb-4">
            <div className="p-2 bg-yellow-100 rounded-lg">
              <svg className="h-6 w-6 text-yellow-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800">Email Settings</h2>
          </div>
          <p className="text-gray-600 text-sm mb-4">Control whether users can send emails to coaches from the app.</p>
          
          <div className="space-y-4">
            {/* Summary Email Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Summary Page Emails</div>
                <div className="text-xs text-gray-500">Email buttons and addresses in attendance summary</div>
              </div>
              <button
                onClick={() => updateSetting('summary_email_enabled', !settings.summary_email_enabled)}
                disabled={savingSettings}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.summary_email_enabled ? 'bg-blue-600' : 'bg-gray-300'
                } ${savingSettings ? 'opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.summary_email_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            
            {/* Directory Email Toggle */}
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-medium text-gray-700">Directory Email Links</div>
                <div className="text-xs text-gray-500">Clickable email links in coach directory</div>
              </div>
              <button
                onClick={() => updateSetting('directory_email_enabled', !settings.directory_email_enabled)}
                disabled={savingSettings}
                className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                  settings.directory_email_enabled ? 'bg-blue-600' : 'bg-gray-300'
                } ${savingSettings ? 'opacity-50' : ''}`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                    settings.directory_email_enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
          
          {settingsToast.show && (
            <div className="mt-3 text-sm text-green-600 flex items-center gap-1">
              <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {settingsToast.message}
            </div>
          )}
        </div>

        <Link
          to="/admin/admins"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-gray-100 rounded-lg">
              <svg className="h-6 w-6 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800">Manage Admins</h2>
          </div>
          <p className="text-gray-600">Invite new admins and manage access</p>
        </Link>

        <Link
          to="/help?context=admin"
          className="bg-white p-6 rounded-lg shadow-md hover:shadow-lg transition-shadow"
        >
          <div className="flex items-center gap-3 mb-2">
            <div className="p-2 bg-blue-100 rounded-lg">
              <svg className="h-6 w-6 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h2 className="text-xl font-semibold text-gray-800">Help & FAQ</h2>
          </div>
          <p className="text-gray-600">View guides, FAQs, and troubleshooting tips</p>
        </Link>
      </div>
    </AdminLayout>
  )
}
