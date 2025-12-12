import { useState, useEffect } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from '../components/OPLogo'

export default function AdminLogin() {
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [isInviteFlow, setIsInviteFlow] = useState(false)
  const [checkingSession, setCheckingSession] = useState(true)
  const [inviteUser, setInviteUser] = useState(null)

  useEffect(() => {
    const checkSession = async () => {
      try {
        // Get the hash params (Supabase puts tokens in the URL hash)
        const hashParams = new URLSearchParams(window.location.hash.substring(1))
        const accessToken = hashParams.get('access_token')
        const type = hashParams.get('type')
        const errorCode = hashParams.get('error_code')
        const errorDesc = hashParams.get('error_description')

        // Handle error in URL (expired link, etc.)
        if (errorCode) {
          setError(decodeURIComponent(errorDesc || 'Invalid or expired link'))
          window.history.replaceState(null, '', window.location.pathname)
          setCheckingSession(false)
          return
        }

        if (accessToken && (type === 'invite' || type === 'recovery' || type === 'signup' || type === 'magiclink')) {
          // Set the session from the URL tokens
          const refreshToken = hashParams.get('refresh_token')
          
          const { data, error: sessionError } = await supabase.auth.setSession({
            access_token: accessToken,
            refresh_token: refreshToken
          })

          if (sessionError) {
            console.error('Session error:', sessionError)
            setError('Invalid or expired invitation link. Please request a new invite.')
          } else if (data.user) {
            // Check if user has completed setup (has password_set flag)
            const hasCompletedSetup = data.user.user_metadata?.password_set === true
            
            if (!hasCompletedSetup) {
              setEmail(data.user.email || '')
              setInviteUser(data.user)
              setIsInviteFlow(true)
            }
            // If they've already set password, let them through to dashboard
          }
          
          // Clear the hash from URL
          window.history.replaceState(null, '', window.location.pathname)
        }
      } catch (err) {
        console.error('Error checking session:', err)
      } finally {
        setCheckingSession(false)
      }
    }

    checkSession()
  }, [])

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    setError(null)

    try {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) throw error
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

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
      if (inviteUser?.email) {
        await supabase
          .from('allowed_admins')
          .update({ registered_at: new Date().toISOString() })
          .eq('email', inviteUser.email.toLowerCase())
      }
      
      // Password set successfully - redirect to dashboard
      navigate('/admin')
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (checkingSession) {
    return (
      <div className="min-h-screen bg-gray-100 flex items-center justify-center">
        <div className="text-gray-500">Loading...</div>
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
          <Link to="/home" className="text-sm text-blue-300 hover:text-white">
            ← Club Dashboard
          </Link>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      {/* Form */}
      <div className="flex-1 flex items-center justify-center p-4">
        <div className="bg-white rounded-lg shadow-md p-8 w-full max-w-md">
          {isInviteFlow ? (
            // Set Password Form (for invited users)
            <>
              <h1 className="text-2xl font-bold text-center mb-2 text-gray-800">
                Welcome to Coach Tracker!
              </h1>
              <p className="text-center text-gray-500 text-sm mb-6">
                Set your password to complete your account setup
              </p>

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
                      Setting up account...
                    </span>
                  ) : (
                    'Create Account'
                  )}
                </button>
              </form>
            </>
          ) : (
            // Regular Login Form
            <>
              <h1 className="text-2xl font-bold text-center mb-2 text-gray-800">
                Admin Login
              </h1>
              <p className="text-center text-gray-500 text-sm mb-6">
                Sign in to manage events, teams, and coaches
              </p>
              
              {error && (
                <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded-lg mb-4 text-sm">
                  {error}
                </div>
              )}

              <form onSubmit={handleLogin}>
                <div className="mb-4">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Email
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="you@example.com"
                    required
                  />
                </div>

                <div className="mb-6">
                  <label className="block text-gray-700 text-sm font-medium mb-2">
                    Password
                  </label>
                  <input
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                    placeholder="••••••••"
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
                      Signing in...
                    </span>
                  ) : (
                    'Sign In'
                  )}
                </button>
              </form>

              {/* Invite-only notice */}
              <div className="mt-6 pt-6 border-t border-gray-200">
                <div className="bg-gray-50 rounded-lg p-4 text-center">
                  <p className="text-sm text-gray-600">
                    <strong>Need admin access?</strong>
                  </p>
                  <p className="text-xs text-gray-500 mt-1">
                    Admin accounts are by invitation only. Contact an existing administrator to request access.
                  </p>
                </div>
              </div>
            </>
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
