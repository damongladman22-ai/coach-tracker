import React, { useState, useEffect } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageLoader, ErrorMessage } from '../components/LoadingStates';

/**
 * Public Event Landing Page
 * 
 * Shows all teams participating in an event with links to their tracker and summary
 */
export default function EventLanding() {
  const { eventSlug } = useParams();
  
  const [event, setEvent] = useState(null);
  const [eventTeams, setEventTeams] = useState([]);
  const [attendanceStats, setAttendanceStats] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, [eventSlug]);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch event by slug
      const { data: eventData, error: eventError } = await supabase
        .from('events')
        .select('*')
        .eq('slug', eventSlug)
        .single();

      if (eventError) throw new Error('Event not found');
      setEvent(eventData);

      // Fetch all teams for this event
      const { data: teamsData, error: teamsError } = await supabase
        .from('event_teams')
        .select('*, club_teams(*)')
        .eq('event_id', eventData.id)
        .order('club_teams(team_name)');

      if (teamsError) throw teamsError;
      setEventTeams(teamsData || []);

      // Fetch attendance stats for each team
      if (teamsData && teamsData.length > 0) {
        const stats = {};
        
        for (const et of teamsData) {
          // Get games for this event team
          const { data: gamesData } = await supabase
            .from('games')
            .select('id')
            .eq('event_team_id', et.id);

          if (gamesData && gamesData.length > 0) {
            const gameIds = gamesData.map(g => g.id);
            
            // Get attendance for these games
            const { data: attendanceData } = await supabase
              .from('attendance')
              .select('coach_id, coaches(school_id)')
              .in('game_id', gameIds);

            const uniqueSchools = new Set();
            const uniqueCoaches = new Set();
            
            (attendanceData || []).forEach(a => {
              if (a.coaches?.school_id) uniqueSchools.add(a.coaches.school_id);
              if (a.coach_id) uniqueCoaches.add(a.coach_id);
            });

            stats[et.id] = {
              games: gamesData.length,
              schools: uniqueSchools.size,
              coaches: uniqueCoaches.size
            };
          } else {
            stats[et.id] = { games: 0, schools: 0, coaches: 0 };
          }
        }
        
        setAttendanceStats(stats);
      }

    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric'
    });
  };

  const formatDateRange = (startDate, endDate) => {
    if (!startDate) return '';
    if (!endDate || startDate === endDate) {
      return formatDate(startDate);
    }
    const [startYear, startMonth, startDay] = startDate.split('-');
    const [endYear, endMonth, endDay] = endDate.split('-');
    
    const start = new Date(startYear, startMonth - 1, startDay);
    const end = new Date(endYear, endMonth - 1, endDay);
    
    return `${start.toLocaleDateString('en-US', { month: 'long', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;
  };

  // Check if event is currently active
  const isEventActive = () => {
    if (!event) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const [startYear, startMonth, startDay] = event.start_date.split('-');
    const startDate = new Date(startYear, startMonth - 1, startDay);
    
    let endDate = startDate;
    if (event.end_date) {
      const [endYear, endMonth, endDay] = event.end_date.split('-');
      endDate = new Date(endYear, endMonth - 1, endDay);
    }
    endDate.setDate(endDate.getDate() + 1); // Make end date inclusive

    return today >= startDate && today < endDate;
  };

  if (loading) {
    return <PageLoader message="Loading event..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <ErrorMessage 
          title="Could not load event" 
          message={error}
          onRetry={fetchData}
        />
      </div>
    );
  }

  const active = isEventActive();

  // Calculate totals
  const totalSchools = new Set(
    Object.values(attendanceStats).flatMap(s => 
      Array.from({ length: s.schools }, (_, i) => `${s}-${i}`)
    )
  ).size;
  const totalStats = Object.values(attendanceStats).reduce(
    (acc, s) => ({
      games: acc.games + s.games,
      schools: acc.schools + s.schools,
      coaches: acc.coaches + s.coaches
    }),
    { games: 0, schools: 0, coaches: 0 }
  );

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white shadow-sm">
        <div className="max-w-4xl mx-auto px-4 py-6">
          <Link 
            to="/"
            className="text-blue-600 hover:text-blue-800 text-sm mb-2 inline-block"
          >
            ← All Events
          </Link>
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold text-gray-900">{event?.event_name}</h1>
            {active && (
              <span className="bg-green-100 text-green-700 text-sm font-medium px-2.5 py-0.5 rounded flex items-center gap-1">
                <span className="bg-green-500 h-2 w-2 rounded-full animate-pulse"></span>
                LIVE
              </span>
            )}
          </div>
          <p className="text-gray-600 mt-1">
            {formatDateRange(event?.start_date, event?.end_date)}
          </p>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Event Stats */}
        <div className="bg-white rounded-lg shadow-md p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Event Overview</h2>
          <div className="grid grid-cols-4 gap-4 text-center">
            <div className="bg-gray-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-gray-800">{eventTeams.length}</div>
              <div className="text-sm text-gray-500">Teams</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-blue-600">{totalStats.games}</div>
              <div className="text-sm text-gray-500">Games</div>
            </div>
            <div className="bg-green-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-green-600">{totalStats.schools}</div>
              <div className="text-sm text-gray-500">Schools</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-4">
              <div className="text-3xl font-bold text-purple-600">{totalStats.coaches}</div>
              <div className="text-sm text-gray-500">Coaches</div>
            </div>
          </div>
        </div>

        {/* Teams List */}
        <h2 className="text-xl font-semibold text-gray-900 mb-4">Participating Teams</h2>
        
        {eventTeams.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Teams Yet</h3>
            <p className="text-gray-500">
              Teams haven't been assigned to this event yet.
            </p>
          </div>
        ) : (
          <div className="space-y-4">
            {eventTeams.map(et => {
              const stats = attendanceStats[et.id] || { games: 0, schools: 0, coaches: 0 };
              return (
                <div 
                  key={et.id} 
                  className="bg-white rounded-lg shadow-md p-4"
                >
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                    <div>
                      <h3 className="font-semibold text-lg text-gray-900">
                        {et.club_teams?.team_name}
                      </h3>
                      <p className="text-sm text-gray-500">{et.club_teams?.gender}</p>
                      <div className="flex gap-4 mt-2 text-sm text-gray-600">
                        <span>{stats.games} game{stats.games !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>{stats.schools} school{stats.schools !== 1 ? 's' : ''}</span>
                        <span>•</span>
                        <span>{stats.coaches} coach{stats.coaches !== 1 ? 'es' : ''}</span>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Link
                        to={`/e/${eventSlug}/${et.slug}`}
                        className="flex-1 sm:flex-none bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-700 text-center"
                      >
                        {active ? 'Live Tracker' : 'View Games'}
                      </Link>
                      <Link
                        to={`/e/${eventSlug}/${et.slug}/summary`}
                        className="flex-1 sm:flex-none bg-green-100 text-green-700 px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-200 text-center"
                      >
                        Summary
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
