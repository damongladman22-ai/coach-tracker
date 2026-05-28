import React, { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { ErrorMessage, CardSkeleton, Skeleton } from '../components/LoadingStates';
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

      // v2 schema: there is no event_teams junction table. The
      // "teams participating in an event" relationship is derived
      // from games that reference both event_id and team_id. We pull
      // games with their team info and aggregate.
      const { data: gamesData, error: gamesError } = await supabase
        .from('games')
        .select('id, team_id, event_id, is_closed, teams(id, name, gender, slug)')
        .not('event_id', 'is', null);

      if (gamesError) throw gamesError;

      // Aggregate: for each event, build a map of team_id -> team
      // entry with hasOpenGames. A team is "open" if it has any
      // un-closed game at that event.
      const byEvent = {};
      (gamesData || []).forEach(game => {
        if (!game.teams) return; // skip orphaned games
        const eventId = game.event_id;
        const teamId = game.team_id;

        if (!byEvent[eventId]) byEvent[eventId] = {};

        if (!byEvent[eventId][teamId]) {
          // First sighting of this team at this event
          byEvent[eventId][teamId] = {
            id: teamId,
            slug: game.teams.slug,
            hasOpenGames: !game.is_closed,
            // Wrap in club_teams to match the shape EventCard expects.
            // (Holdover from v1 schema where club_teams was a real
            // junction-joined entity. Renaming the render code is a
            // wider change — left for the broader v2 migration sweep.)
            club_teams: {
              team_name: game.teams.name,
              gender: game.teams.gender === 'M' ? 'Boys'
                : game.teams.gender === 'F' ? 'Girls'
                : game.teams.gender
            }
          };
        } else if (!game.is_closed) {
          // Already saw this team; this game is open → mark open
          byEvent[eventId][teamId].hasOpenGames = true;
        }
      });

      // Convert team maps to sorted arrays
      const result = {};
      Object.entries(byEvent).forEach(([eventId, teamMap]) => {
        result[eventId] = Object.values(teamMap).sort((a, b) =>
          a.club_teams.team_name.localeCompare(b.club_teams.team_name)
        );
      });
      setEventTeams(result);

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
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header skeleton */}
        <header className="op-header shadow-lg">
          <div className="op-gradient-border"></div>
          <div className="max-w-4xl mx-auto px-4 py-6">
            <div className="flex items-center gap-3">
              <Skeleton className="h-12 w-12 rounded-full" />
              <div>
                <Skeleton className="h-7 w-48 mb-2" />
                <Skeleton className="h-4 w-64" />
              </div>
            </div>
          </div>
        </header>
        
        <main className="max-w-4xl mx-auto px-4 py-8 space-y-6">
          <Skeleton className="h-6 w-32 mb-4" />
          <CardSkeleton />
          <CardSkeleton />
          <CardSkeleton />
        </main>
      </div>
    );
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
              <Link 
                to="/admin" 
                className="text-sm text-gray-300 hover:text-white flex items-center gap-1.5 p-2 -m-2 rounded-lg"
                title="Admin login"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 11c0 3.517-1.009 6.799-2.753 9.571m-3.44-2.04l.054-.09A13.916 13.916 0 008 11a4 4 0 118 0c0 1.017-.07 2.019-.203 3m-2.118 6.844A21.88 21.88 0 0015.171 17m3.839 1.132c.645-2.266.99-4.659.99-7.132A8 8 0 008 4.07M3 15.364c.64-1.319 1-2.8 1-4.364 0-1.457.39-2.823 1.07-4" />
                </svg>
                Admin
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
