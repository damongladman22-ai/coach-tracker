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

  useEffect(() => {
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

  return (
    <BrowserRouter>
      <Routes>
        {/* Admin Routes */}
        <Route path="/admin" element={session ? <AdminDashboard session={session} /> : <AdminLogin />} />
        <Route path="/admin/teams" element={session ? <ClubTeams session={session} /> : <AdminLogin />} />
        <Route path="/admin/events" element={session ? <Events session={session} /> : <AdminLogin />} />
        <Route path="/admin/events/:eventId" element={session ? <EventDetail session={session} /> : <AdminLogin />} />
        <Route path="/admin/schools" element={session ? <Schools session={session} /> : <AdminLogin />} />
        <Route path="/admin/import" element={session ? <ImportCoaches session={session} /> : <AdminLogin />} />
        <Route path="/admin/events/:eventId/matrix/:eventTeamId" element={session ? <AttendanceMatrix session={session} /> : <AdminLogin />} />
        <Route path="/admin/dedup" element={session ? <DedupCoaches session={session} /> : <AdminLogin />} />
        <Route path="/admin/dedup-schools" element={session ? <DedupSchools session={session} /> : <AdminLogin />} />
        <Route path="/admin/admins" element={session ? <ManageAdmins session={session} /> : <AdminLogin />} />
        
        {/* Parent Routes (no auth required) */}
        <Route path="/home" element={<ClubDashboard />} />
        <Route path="/directory" element={<CoachDirectory />} />
        <Route path="/help" element={<Help />} />
        <Route path="/e/:eventSlug/:teamSlug" element={<TeamGames />} />
        <Route path="/e/:eventSlug/:teamSlug/game/:gameId" element={<GameAttendance />} />
        <Route path="/e/:eventSlug/:teamSlug/summary" element={<ParentSummary />} />
        <Route path="/e/:eventSlug" element={<EventLanding />} />
        
        {/* Default - Club Dashboard for public, Admin Dashboard if logged in */}
        <Route path="/" element={session ? <AdminDashboard session={session} /> : <ClubDashboard />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
