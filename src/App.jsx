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

// Parent Pages
import TeamGames from './pages/TeamGames'
import GameAttendance from './pages/GameAttendance'

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
        
        {/* Parent Routes (no auth required) */}
        <Route path="/e/:eventSlug/:teamSlug" element={<TeamGames />} />
        <Route path="/e/:eventSlug/:teamSlug/game/:gameId" element={<GameAttendance />} />
        
        {/* Default redirect */}
        <Route path="/" element={session ? <AdminDashboard session={session} /> : <AdminLogin />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App
