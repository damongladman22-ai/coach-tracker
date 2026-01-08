import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { PageLoader, ErrorMessage } from '../components/LoadingStates';
import OPLogo from '../components/OPLogo';
import FeedbackButton from '../components/FeedbackButton';

/**
 * Public Club Dashboard - Landing page for parents
 * 
 * Shows all events organized by status with quick links to teams
 */
export default function ClubDashboard() {
  const [events, setEvents] = useState([]);
  const [eventTeams, setEventTeams] = useState({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    try {
      setLoading(true);
      setError(null);

      // Fetch all events
      const { data: eventsData, error: eventsError } = await supabase
        .from('events')
        .select('*')
        .order('start_date', { ascending: false });

      if (eventsError) throw eventsError;
      setEvents(eventsData || []);

      // Fetch all event teams with club team details
      const { data: eventTeamsData, error: teamsError } = await supabase
        .from('event_teams')
        .select('*, club_teams(*), events(slug)')
        .order('club_teams(team_name)');

      if (teamsError) throw teamsError;

      // Fetch games to check if any are open for each event team
      const eventTeamIds = (eventTeamsData || []).map(et => et.id);
      let gamesData = [];
      if (eventTeamIds.length > 0) {
        const { data } = await supabase
          .from('games')
          .select('id, event_team_id, is_closed')
          .in('event_team_id', eventTeamIds);
        gamesData = data || [];
      }

      // Create a map of event_team_id -> hasOpenGames
      const openGamesMap = {};
      eventTeamIds.forEach(id => {
        const teamGames = gamesData.filter(g => g.event_team_id === id);
        openGamesMap[id] = teamGames.some(g => !g.is_closed);
      });

      // Group by event and attach hasOpenGames
      const byEvent = {};
      (eventTeamsData || []).forEach(et => {
        if (!byEvent[et.event_id]) {
          byEvent[et.event_id] = [];
        }
        byEvent[et.event_id].push({
          ...et,
          hasOpenGames: openGamesMap[et.id] || false
        });
      });
      setEventTeams(byEvent);

    } catch (err) {
      console.error('Error loading data:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Categorize events by status
  const categorizeEvents = () => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    const active = [];
    const upcoming = [];
    const past = [];

    events.forEach(event => {
      const startDate = parseDate(event.start_date);
      const endDate = event.end_date ? parseDate(event.end_date) : startDate;
      
      // Add one day to end date to make it inclusive
      const endDateInclusive = new Date(endDate);
      endDateInclusive.setDate(endDateInclusive.getDate() + 1);

      if (today >= startDate && today < endDateInclusive) {
        active.push(event);
      } else if (startDate > today) {
        upcoming.push(event);
      } else {
        past.push(event);
      }
    });

    // Sort upcoming by date ascending
    upcoming.sort((a, b) => parseDate(a.start_date) - parseDate(b.start_date));
    
    // Past is already sorted descending from the query

    return { active, upcoming, past };
  };

  // Parse date without timezone issues
  const parseDate = (dateStr) => {
    if (!dateStr) return new Date();
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day);
  };

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'short',
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
    
    if (startYear === endYear && startMonth === endMonth) {
      // Same month: "Dec 15-17, 2025"
      return `${start.toLocaleDateString('en-US', { month: 'short' })} ${startDay}-${endDay}, ${startYear}`;
    } else if (startYear === endYear) {
      // Same year: "Dec 15 - Jan 2, 2025"
      return `${start.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - ${end.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}, ${startYear}`;
    } else {
      // Different years
      return `${formatDate(startDate)} - ${formatDate(endDate)}`;
    }
  };

  if (loading) {
    return <PageLoader message="Loading events..." />;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <ErrorMessage 
          title="Could not load events" 
          message={error}
          onRetry={fetchData}
        />
      </div>
    );
  }

  const { active, upcoming, past } = categorizeEvents();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="op-header shadow-lg">
        <div className="op-gradient-border"></div>
        <div className="max-w-4xl mx-auto px-4 py-6">
          <div className="flex items-center justify-between">
            <Link to="/home" className="flex items-center gap-3 hover:opacity-90 transition-opacity">
              <OPLogo className="h-12 w-auto" />
              <div>
                <h1 className="text-2xl font-bold text-white">College Coach Tracker</h1>
                <p className="text-cyan-300 text-sm">Track college coach attendance at events</p>
              </div>
            </Link>
            <nav className="flex items-center gap-2">
              <Link 
                to="/directory" 
                className="text-sm text-gray-300 hover:text-white flex items-center gap-1.5 p-2 -m-2 rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                </svg>
                Directory
              </Link>
              <Link 
                to="/help?context=parent" 
                className="text-sm text-gray-300 hover:text-white flex items-center gap-1.5 p-2 -m-2 rounded-lg"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                Help
              </Link>
            </nav>
          </div>
        </div>
      </header>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-8">
        {/* Active Events */}
        {active.length > 0 && (
          <section>
            <div className="flex items-center gap-2 mb-4">
              <span className="bg-green-500 h-3 w-3 rounded-full animate-pulse"></span>
              <h2 className="text-xl font-semibold text-gray-900">Happening Now</h2>
            </div>
            <div className="space-y-4">
              {active.map(event => (
                <EventCard 
                  key={event.id} 
                  event={event} 
                  teams={eventTeams[event.id] || []}
                  formatDateRange={formatDateRange}
                  isActive={true}
                />
              ))}
            </div>
          </section>
        )}

        {/* Upcoming Events */}
        {upcoming.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Upcoming Events</h2>
            <div className="space-y-4">
              {upcoming.map(event => (
                <EventCard 
                  key={event.id} 
                  event={event} 
                  teams={eventTeams[event.id] || []}
                  formatDateRange={formatDateRange}
                />
              ))}
            </div>
          </section>
        )}

        {/* Past Events */}
        {past.length > 0 && (
          <section>
            <h2 className="text-xl font-semibold text-gray-900 mb-4">Past Events</h2>
            <div className="space-y-4">
              {past.slice(0, 5).map(event => (
                <EventCard 
                  key={event.id} 
                  event={event} 
                  teams={eventTeams[event.id] || []}
                  formatDateRange={formatDateRange}
                  isPast={true}
                />
              ))}
              {past.length > 5 && (
                <p className="text-center text-gray-500 text-sm py-2">
                  And {past.length - 5} more past events...
                </p>
              )}
            </div>
          </section>
        )}

        {/* Empty State */}
        {events.length === 0 && (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Events Yet</h3>
            <p className="text-gray-500">
              Check back soon for upcoming tournaments and showcases.
            </p>
          </div>
        )}

        {/* Admin Link */}
        <div className="text-center pt-4">
          <Link 
            to="/admin" 
            className="text-sm text-gray-400 hover:text-gray-600"
          >
            Admin Login →
          </Link>
        </div>
      </div>

      {/* Feedback Button */}
      <FeedbackButton />
    </div>
  );
}

/**
 * Event Card Component
 */
function EventCard({ event, teams, formatDateRange, isActive = false, isPast = false }) {
  const [expanded, setExpanded] = useState(isActive);

  return (
    <div className={`bg-white rounded-lg shadow-md overflow-hidden ${isActive ? 'ring-2 ring-green-500' : ''}`}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full px-4 py-4 flex justify-between items-center hover:bg-gray-50 transition-colors"
      >
        <div className="text-left">
          <div className="flex items-center gap-2">
            <h3 className={`font-semibold ${isPast ? 'text-gray-600' : 'text-gray-900'}`}>
              {event.event_name}
            </h3>
            {isActive && (
              <span className="bg-green-100 text-green-700 text-xs font-medium px-2 py-0.5 rounded">
                LIVE
              </span>
            )}
          </div>
          <p className={`text-sm ${isPast ? 'text-gray-400' : 'text-gray-500'}`}>
            {formatDateRange(event.start_date, event.end_date)}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-500">
            {teams.length} team{teams.length !== 1 ? 's' : ''}
          </span>
          <svg 
            className={`h-5 w-5 text-gray-400 transition-transform ${expanded ? 'rotate-180' : ''}`} 
            fill="none" 
            viewBox="0 0 24 24" 
            stroke="currentColor"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </button>

      {expanded && (
        <div className="border-t px-4 py-3 bg-gray-50">
          {teams.length === 0 ? (
            <p className="text-sm text-gray-500 italic">No teams assigned to this event yet.</p>
          ) : (
            <div className="space-y-2">
              {teams.map(et => (
                <div 
                  key={et.id} 
                  className="flex items-center justify-between bg-white rounded-lg p-3 shadow-sm"
                >
                  <div>
                    <div className="font-medium text-gray-900">{et.club_teams?.team_name}</div>
                    <div className="text-xs text-gray-500">{et.club_teams?.gender}</div>
                  </div>
                  <div className="flex gap-2">
                    {et.hasOpenGames && (
                      <Link
                        to={`/e/${event.slug}/${et.slug}`}
                        className="op-button px-3 py-1.5 rounded text-sm font-medium"
                      >
                        Live Tracker
                      </Link>
                    )}
                    <Link
                      to={`/e/${event.slug}/${et.slug}/summary`}
                      className={`px-3 py-1.5 rounded text-sm font-medium ${
                        et.hasOpenGames
                          ? 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                          : 'op-button'
                      }`}
                    >
                      Summary
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
          
          {/* Event page link */}
          <div className="mt-3 pt-3 border-t text-center">
            <Link
              to={`/e/${event.slug}`}
              className="text-sm text-gray-500 hover:text-gray-700"
            >
              View all teams at this event →
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
