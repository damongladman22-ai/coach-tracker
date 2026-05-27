import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect, lazy, Suspense } from 'react'
import { supabase } from './lib/supabase'
import ErrorBoundary from './components/ErrorBoundary'
import { PageLoader } from './components/LoadingStates'

// Parent Pages - loaded immediately (primary use case)
import TeamGames from './pages/TeamGames'
import GameAttendance from './pages/GameAttendance'
import ParentSummary from './pages/ParentSummary'
import ClubDashboard from './pages/ClubDashboard'
import EventLanding from './pages/EventLanding'
import PublicTeamPage from './pages/PublicTeamPage'
import TeamCollegeDetail from './pages/TeamCollegeDetail'
import TeamGameDetail from './pages/TeamGameDetail'
import CoachDirectory from './pages/CoachDirectory'
import Help from './pages/Help'

// Admin Pages - lazy loaded (secondary use case, larger components)
const AdminLogin = lazy(() => import('./pages/AdminLogin'))
const AdminSetup = lazy(() => import('./pages/AdminSetup'))
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'))
const Teams = lazy(() => import('./pages/Teams'))
const TeamDetail = lazy(() => import('./pages/TeamDetail'))
const AthleteOneDiscover = lazy(() => import('./pages/AthleteOneDiscover'))
const GameDedup = lazy(() => import('./pages/GameDedup'))
const Seasons = lazy(() => import('./pages/Seasons'))
const Programs = lazy(() => import('./pages/Programs'))
const AgeGroups = lazy(() => import('./pages/AgeGroups'))
const GameTypes = lazy(() => import('./pages/GameTypes'))
const ClubSettings = lazy(() => import('./pages/ClubSettings'))
const Events = lazy(() => import('./pages/Events'))
const EventDetail = lazy(() => import('./pages/EventDetail'))
const Schools = lazy(() => import('./pages/Schools'))
const ImportCoaches = lazy(() => import('./pages/ImportCoaches'))
const AttendanceMatrix = lazy(() => import('./pages/AttendanceMatrix'))
const AdminGameAttendance = lazy(() => import('./pages/AdminGameAttendance'))
const AdminGameVideos = lazy(() => import('./pages/AdminGameVideos'))
const ImportGames = lazy(() => import('./pages/ImportGames'))
const DedupCoaches = lazy(() => import('./pages/DedupCoaches'))
const DedupSchools = lazy(() => import('./pages/DedupSchools'))
const ManageAdmins = lazy(() => import('./pages/ManageAdmins'))
const Feedback = lazy(() => import('./pages/Feedback'))

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
    <ErrorBoundary>
      <BrowserRouter>
        <Suspense fallback={<PageLoader message="Loading..." />}>
          <Routes>
            {/* Admin Routes */}
            <Route path="/admin" element={session ? <AdminDashboard session={session} /> : <AdminLogin />} />
            <Route path="/admin/setup" element={<AdminSetup />} />
            <Route path="/admin/teams" element={session ? <Teams session={session} /> : <AdminLogin />} />
            <Route path="/admin/teams/:teamId" element={session ? <TeamDetail session={session} /> : <AdminLogin />} />
            <Route path="/admin/teams/:teamId/game-dedup" element={session ? <GameDedup session={session} /> : <AdminLogin />} />
            <Route path="/admin/athleteone-discover" element={session ? <AthleteOneDiscover session={session} /> : <AdminLogin />} />
            <Route path="/admin/seasons" element={session ? <Seasons session={session} /> : <AdminLogin />} />
            <Route path="/admin/programs" element={session ? <Programs session={session} /> : <AdminLogin />} />
            <Route path="/admin/age-groups" element={session ? <AgeGroups session={session} /> : <AdminLogin />} />
            <Route path="/admin/game-types" element={session ? <GameTypes session={session} /> : <AdminLogin />} />
            <Route path="/admin/club-settings" element={session ? <ClubSettings session={session} /> : <AdminLogin />} />
            <Route path="/admin/events" element={session ? <Events session={session} /> : <AdminLogin />} />
            <Route path="/admin/events/:eventId" element={session ? <EventDetail session={session} /> : <AdminLogin />} />
            <Route path="/admin/schools" element={session ? <Schools session={session} /> : <AdminLogin />} />
            <Route path="/admin/import" element={session ? <ImportCoaches session={session} /> : <AdminLogin />} />
            <Route path="/admin/events/:eventId/matrix/:teamId" element={session ? <AttendanceMatrix session={session} /> : <AdminLogin />} />
            <Route path="/admin/games/:gameId" element={session ? <AdminGameAttendance session={session} /> : <AdminLogin />} />
            <Route path="/admin/games/:gameId/videos" element={session ? <AdminGameVideos session={session} /> : <AdminLogin />} />
            <Route path="/admin/import-games" element={session ? <ImportGames session={session} /> : <AdminLogin />} />
            <Route path="/admin/dedup" element={session ? <DedupCoaches session={session} /> : <AdminLogin />} />
            <Route path="/admin/dedup-schools" element={session ? <DedupSchools session={session} /> : <AdminLogin />} />
            <Route path="/admin/admins" element={session ? <ManageAdmins session={session} /> : <AdminLogin />} />
            <Route path="/admin/feedback" element={session ? <Feedback session={session} /> : <AdminLogin />} />
          
            {/* Parent Routes (no auth required) */}
            <Route path="/home" element={<ClubDashboard />} />
            <Route path="/directory" element={<CoachDirectory />} />
            <Route path="/help" element={<Help />} />
            <Route path="/t/:teamSlug" element={<PublicTeamPage />} />
            <Route path="/t/:teamSlug/college/:schoolId" element={<TeamCollegeDetail />} />
            <Route path="/t/:teamSlug/game/:gameId" element={<TeamGameDetail />} />
            <Route path="/e/:eventSlug/:teamSlug" element={<TeamGames />} />
            <Route path="/e/:eventSlug/:teamSlug/game/:gameId" element={<GameAttendance />} />
            <Route path="/e/:eventSlug/:teamSlug/summary" element={<ParentSummary />} />
            <Route path="/e/:eventSlug" element={<EventLanding />} />
          
            {/* Default - Club Dashboard for public, Admin Dashboard if logged in */}
            <Route path="/" element={session ? <AdminDashboard session={session} /> : <ClubDashboard />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
    </ErrorBoundary>
  )
}

export default App
