import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect } from 'react'
import { supabase } from './lib/supabase'

// Admin Pages
import AdminLogin from './pages/AdminLogin'
import AdminDashboard from './pages/AdminDashboard'
import ClubTeams from './pages/ClubTeams'
import Events from './pages/Events'
import EventDetail from './pages/EventDetail'
import Schools from './pages/Schools'
import ImportCoaches from './pages/ImportCoaches'
import AttendanceMatrix from './pages/AttendanceMatrix'
import DedupCoaches from './pages/DedupCoaches'
import DedupSchools from './pages/DedupSchools'
import ManageAdmins from './pages/ManageAdmins'

// Parent Pages
import TeamGames from './pages/TeamGames'
import GameAttendance from './pages/GameAttendance'
import ParentSummary from './pages/ParentSummary'
import ClubDashboard from './pages/ClubDashboard'
import EventLanding from './pages/EventLanding'
import CoachDirectory from './pages/CoachDirectory'
import Help from './pages/Help'

function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)
  const [hasInviteTokens, setHasInviteTokens] = useState(false)

  useEffect(() => {
    // Check if URL has invite tokens BEFORE setting up session listener
    const hashParams = new URLSearchParams(window.location.hash.substring(1))
    const type = hashParams.get('type')
    if (type === 'invite' || type === 'signup' || type === 'recovery' || type === 'magiclink') {
      setHasInviteTokens(true)
    }

    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-lg">Loading...</div>
      </div>
    )
  }

  // Check if user is fully authenticated
  // - Has session AND
  // - Either password_set is true OR password_set is undefined (legacy users)
  // - AND not coming from an invite link that needs processing
  const passwordSet = session?.user?.user_metadata?.password_set
  const isFullyAuthenticated = session && (passwordSet === true || passwordSet === undefined) && !hasInviteTokens

  // For /admin route, always show AdminLogin to handle invite flow
  const AdminRoute = ({ children }) => {
    if (!session) return <AdminLogin />
    if (hasInviteTokens) return <AdminLogin />
    if (passwordSet === false) return <AdminLogin />
    return children
  }

  return (
    <BrowserRouter>
      <Routes>
        {/* Admin Routes - /admin always goes through AdminLogin for invite handling */}
        <Route path="/admin" element={
          isFullyAuthenticated ? <AdminDashboard session={session} /> : <AdminLogin />
        } />
        <Route path="/admin/teams" element={<AdminRoute><ClubTeams session={session} /></AdminRoute>} />
        <Route path="/admin/events" element={<AdminRoute><Events session={session} /></AdminRoute>} />
        <Route path="/admin/events/:eventId" element={<AdminRoute><EventDetail session={session} /></AdminRoute>} />
        <Route path="/admin/schools" element={<AdminRoute><Schools session={session} /></AdminRoute>} />
        <Route path="/admin/import" element={<AdminRoute><ImportCoaches session={session} /></AdminRoute>} />
        <Route path="/admin/events/:eventId/matrix/:eventTeamId" element={<AdminRoute><AttendanceMatrix session={session} /></AdminRoute>} />
        <Route path="/admin/dedup" element={<AdminRoute><DedupCoaches session={session} /></AdminRoute>} />
        <Route path="/admin/dedup-schools" element={<AdminRoute><DedupSchools session={session} /></AdminRoute>} />
        <Route path="/admin/admins" element={<AdminRoute><ManageAdmins session={session} /></AdminRoute>} />
        
        {/* Parent Routes (no auth required) */}
        <Route path="/home" element={<ClubDashboard />} />
        <Route path="/directory" element={<CoachDirectory />} />
        <Route path="/help" element={<Help />} />
        <Route path="/e/:eventSlug/:teamSlug" element={<TeamGames />} />
        <Route path="/e/:eventSlug/:teamSlug/game/:gameId" element={<GameAttendance />} />
        <Route path="/e/:eventSlug/:teamSlug/summary" element={<ParentSummary />} />
        <Route path="/e/:eventSlug" element={<EventLanding />} />
        
        {/* Default - Club Dashboard for public, Admin Dashboard if logged in */}
        <Route path="/" element={isFullyAuthenticated ? <AdminDashboard session={session} /> : <ClubDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
