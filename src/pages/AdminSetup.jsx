import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from '../components/OPLogo'

export default function AdminSetup() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [initializing, setInitializing] = useState(true)
  const [sessionReady, setSessionReady] = useState(false)

  useEffect(() => {
    const processInvite = async () => {
      try {
        // Get the hash params
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const refreshToken = hashParams.get('refresh_token')
        const type = hashParams.get('type')
        const errorCode = hashParams.get('error_code')
        const errorDesc = hashParams.get('error_description')

        // Handle error in URL (expired link, etc.)
        if (errorCode) {
          setError(decodeURIComponent(errorDesc || 'Invalid or expired invitation link'))
          window.history.replaceState(null, '', window.location.pathname)
          setInitializing(false)
          return
        }

        // Check if we have invite tokens
        if (accessToken && ['invite', 'signup', 'recovery', 'magiclink'].includes(type)) {
          // Set the session from the URL tokens
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })

          // Clear hash from URL
          window.history.replaceState(null, '', window.location.pathname)

          if (sessionError) {
            console.error('Session error:', sessionError)
            setError('Invalid or expired invitation link. Please request a new invite.')
            setInitializing(false)
            return
          }

          if (data.user) {
            setEmail(data.user.email || '')
            setSessionReady(true)
          }
        } else {
          // No tokens - check if already logged in
          const { data: { session } } = await supabase.auth.getSession()
          
          if (session) {
            // Already logged in, go to dashboard
            navigate('/admin', { replace: true })
            return
          } else {
            // No tokens and not logged in - redirect to login
            navigate('/admin', { replace: true })
            return
          }
        }
      } catch (err) {
        console.error('Error processing invite:', err)
        setError('Something went wrong. Please try again or request a new invite.')
      } finally {
        setInitializing(false)
      }
    }

    processInvite()
  }, [navigate])

  const handleSetPassword = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    if (password !== confirmPassword) {
      setError('Passwords do not match')
      setLoading(false)
      return
    }

    if (password.length < 6) {
      setError('Password must be at least 6 characters')
      setLoading(false)
      return
    }

    try {
      // Update password and set flag
      const { error: updateError } = await supabase.auth.updateUser({ 
        password,
        data: { password_set: true }
      })
      if (updateError) throw updateError
      
      // Update allowed_admins to mark as registered
      if (email) {
        await supabase
          .from('allowed_admins')
          .update({ registered_at: new Date().toISOString() })
          .eq('email', email.toLowerCase())
      }
      
      // Success - redirect to dashboard
      navigate('/admin', { replace: true })
    } catch (err) {
      setError(err.message)
      setLoading(false)
    }
  }

  // Show loading while processing tokens
  if (initializing) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-gray-500">Setting up your account...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 flex flex-col">
      {/* Header */}
      <header className="bg-[#0a1628] text-white">
        <div className="max-w-md mx-auto px-4 py-4 flex items-center justify-between">
          <Link to="/home" className="flex items-center gap-2 hover:opacity-90 transition-opacity">
            <OPLogo className="h-8 w-auto" />
            <span className="font-bold">Coach Tracker</span>
          </Link>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      {/* Content */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
          {error && !sessionReady ? (
            // Error state - show error and link to request new invite
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-red-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-red-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                  </svg>
                </div>
                <h1 className="text-xl font-bold text-gray-800 mb-2">
                  Invitation Link Expired
                </h1>
                <p className="text-gray-500 text-sm">
                  {error}
                </p>
              </div>
              
              <div className="bg-gray-50 rounded-lg p-4 text-center">
                <p className="text-sm text-gray-600 mb-2">
                  Need a new invitation?
                </p>
                <p className="text-xs text-gray-500">
                  Contact an administrator to send you a new invite link.
                </p>
              </div>
              
              <div className="mt-6 text-center">
                <Link to="/admin" className="text-blue-600 hover:text-blue-800 text-sm">
                  Go to Admin Login →
                </Link>
              </div>
            </>
          ) : sessionReady ? (
            // Password setup form
            <>
              <div className="text-center mb-6">
                <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                  <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <h1 className="text-2xl font-bold text-gray-800 mb-2">
                  Welcome to Coach Tracker!
                </h1>
                <p className="text-gray-500 text-sm">
                  Set your password to complete your account setup
                </p>
              </div>

              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleSetPassword}>
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    disabled
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg bg-gray-50 text-gray-500"
                  />
                </div>

                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Enter your password"
                    required
                    minLength={6}
                    autoFocus
                  />
                </div>

                <div className="mb-6">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Confirm Password
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="Confirm your password"
                    required
                    minLength={6}
                  />
                </div>

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full bg-blue-600 text-white py-3 rounded-lg font-medium hover:bg-blue-700 disabled:bg-blue-300 transition-colors"
                >
                  {loading ? (
                    <span className="flex items-center justify-center gap-2">
                      <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      Creating account...
                    </span>
                  ) : (
                    'Create Account'
                  )}
                </button>
              </form>
            </>
          ) : (
            // Fallback - redirect to login
            <div className="text-center">
              <p className="text-gray-500 mb-4">Redirecting to login...</p>
              <Link to="/admin" className="text-blue-600 hover:text-blue-800">
                Click here if not redirected
              </Link>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <footer className="py-4 text-center text-sm text-gray-400">
        <Link to="/home" className="hover:text-gray-600">
          Return to Club Dashboard
        </Link>
      </footer>
    </div>
  )
}
