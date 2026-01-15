import React, { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useRealtimeAttendance } from '../hooks/useRealtimeAttendance';
import { 
  PageLoader, 
  ErrorMessage, 
  EmptyState,
  ConnectionStatus,
  GameCardSkeleton,
  Skeleton
} from '../components/LoadingStates';
import OPLogo from '../components/OPLogo';
import FeedbackButton from '../components/FeedbackButton';

/**
 * Live Tracker - Team Games List
 * 
 * Shows all games for a team at an event.
 * Each game links to the individual game attendance page.
 * Auto-refreshes attendance counts every 5 seconds.
 */
export default function TeamGames() {
  const { eventSlug, teamSlug } = useParams();
  const navigate = useNavigate();
  
  // Page data
  const [eventTeam, setEventTeam] = useState(null);
  const [games, setGames] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  const [unlockMinutes, setUnlockMinutes] = useState(30);
  const [currentTime, setCurrentTime] = useState(new Date());
  
  // Polling-based attendance hook (auto-refreshes every 5 seconds)
  const { 
    attendance, 
    lastUpdate
  } = useRealtimeAttendance(eventTeam?.id);

  // Update current time every minute for lock/unlock checks
  useEffect(() => {
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000); // Update every minute
    return () => clearInterval(interval);
  }, []);

  // Load page data
  useEffect(() => {
    async function loadPageData() {
      try {
        setPageLoading(true);
        setPageError(null);

        // Load unlock minutes setting
        const { data: settingsData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'game_unlock_minutes')
          .single();
        
        if (settingsData?.value) {
          setUnlockMinutes(parseInt(settingsData.value, 10) || 30);
        }

        // Get event team by slugs
        const { data: eventTeamData, error: eventTeamError } = await supabase
          .from('event_teams')
          .select(`
            id,
            slug,
            events!inner (
              id,
              event_name,
              slug,
              start_date,
              end_date
            ),
            club_teams!inner (
              id,
              team_name,
              gender
            )
          `)
          .eq('events.slug', eventSlug)
          .eq('slug', teamSlug)
          .single();

        if (eventTeamError) throw new Error('Team not found');
        setEventTeam(eventTeamData);

        // Get games for this event team
        const { data: gamesData, error: gamesError } = await supabase
          .from('games')
          .select('*')
          .eq('event_team_id', eventTeamData.id)
          .order('game_date');

        if (gamesError) throw gamesError;
        
        // If all games are closed, redirect to summary
        if (gamesData && gamesData.length > 0 && gamesData.every(g => g.is_closed)) {
          navigate(`/e/${eventSlug}/${teamSlug}/summary`, { replace: true });
          return;
        }
        
        setGames(gamesData || []);

      } catch (err) {
        console.error('Error loading page data:', err);
        setPageError(err.message || 'Failed to load team data');
      } finally {
        setPageLoading(false);
      }
    }

    loadPageData();
  }, [eventSlug, teamSlug, navigate]);

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-').map(Number);
    const date = new Date(year, month - 1, day);
    return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
  };

  // Get attendance count for a specific game
  const getGameAttendanceCount = (gameId) => {
    return attendance.filter(a => a.game_id === gameId).length;
  };

  // Get unique schools count for a specific game
  const getGameSchoolCount = (gameId) => {
    const gameAttendance = attendance.filter(a => a.game_id === gameId);
    const schoolIds = new Set(gameAttendance.map(a => a.coaches?.school_id).filter(Boolean));
    return schoolIds.size;
  };

  // Check if a game is unlocked (available for parents to log coaches)
  const isGameUnlocked = (game) => {
    // If game is closed by admin, it's not accessible
    if (game.is_closed) return false;
    
    // If no time is set, game is always open
    if (!game.game_time || !game.timezone) return true;
    
    // Calculate unlock time (game time - unlock minutes)
    const [hours, minutes] = game.game_time.split(':').map(Number);
    const gameDateTime = new Date(`${game.game_date}T${game.game_time}`);
    
    // Create date in the game's timezone
    const gameTimeInTz = new Date(gameDateTime.toLocaleString('en-US', { timeZone: game.timezone }));
    const unlockTime = new Date(gameTimeInTz.getTime() - unlockMinutes * 60000);
    
    // Get current time in game's timezone for comparison
    const nowInTz = new Date(currentTime.toLocaleString('en-US', { timeZone: game.timezone }));
    
    return nowInTz >= unlockTime;
  };

  // Get the unlock time for display
  const getUnlockTime = (game) => {
    if (!game.game_time || !game.timezone) return null;
    
    const [hours, minutes] = game.game_time.split(':').map(Number);
    
    // Calculate unlock time
    let unlockHours = hours;
    let unlockMinutesVal = minutes - unlockMinutes;
    
    if (unlockMinutesVal < 0) {
      unlockMinutesVal += 60;
      unlockHours -= 1;
      if (unlockHours < 0) unlockHours += 24;
    }
    
    const ampm = unlockHours >= 12 ? 'PM' : 'AM';
    const hour12 = unlockHours % 12 || 12;
    
    // Get timezone abbreviation
    const tzAbbrevs = {
      'America/New_York': 'ET',
      'America/Chicago': 'CT',
      'America/Denver': 'MT',
      'America/Phoenix': 'MST',
      'America/Los_Angeles': 'PT',
      'America/Anchorage': 'AKT',
      'Pacific/Honolulu': 'HT',
    };
    const tzAbbr = tzAbbrevs[game.timezone] || '';
    
    return `${hour12}:${unlockMinutesVal.toString().padStart(2, '0')} ${ampm} ${tzAbbr}`;
  };

  // Format game time for display
  const formatGameTime = (game) => {
    if (!game.game_time) return '';
    const [hours, minutes] = game.game_time.split(':').map(Number);
    const ampm = hours >= 12 ? 'PM' : 'AM';
    const hour12 = hours % 12 || 12;
    const tzAbbrevs = {
      'America/New_York': 'ET',
      'America/Chicago': 'CT',
      'America/Denver': 'MT',
      'America/Phoenix': 'MST',
      'America/Los_Angeles': 'PT',
      'America/Anchorage': 'AKT',
      'Pacific/Honolulu': 'HT',
    };
    const tzAbbr = tzAbbrevs[game.timezone] || '';
    return `${hour12}:${minutes.toString().padStart(2, '0')} ${ampm} ${tzAbbr}`;
  };

  // Loading state - show skeleton with page structure
  if (pageLoading) {
    return (
      <div className="min-h-screen bg-gray-50 pb-8">
        {/* Header skeleton */}
        <header className="op-header border-b border-gray-700">
          <div className="op-gradient-border"></div>
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 text-sm text-gray-400 mb-2">
              <Skeleton className="h-4 w-16" />
              <span>›</span>
              <Skeleton className="h-4 w-24" />
            </div>
            <Skeleton className="h-7 w-48 mb-1" />
            <Skeleton className="h-4 w-32" />
          </div>
        </header>
        
        <main className="p-4">
          <GameCardSkeleton count={3} />
        </main>
      </div>
    );
  }

  // Error state
  if (pageError) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <ErrorMessage 
          title="Could not load team" 
          message={pageError}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Auto-refresh status indicator */}
      <ConnectionStatus lastUpdate={lastUpdate} />

      {/* Header */}
      <header className="op-header border-b border-gray-700 sticky top-0 z-40">
        <div className="op-gradient-border"></div>
        <div className="px-4 py-3">
          {/* Breadcrumb navigation */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2 text-sm text-gray-400">
              <Link to="/home" className="flex items-center gap-1 hover:text-white">
                <OPLogo className="h-5 w-5" />
                Home
              </Link>
              <span>›</span>
              <Link to={`/e/${eventSlug}`} className="hover:text-white truncate max-w-[120px]">
                {eventTeam?.events?.event_name}
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={`/help?context=parent`}
                className="text-gray-400 hover:text-white p-1"
                title="Help"
              >
                <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </Link>
              <Link
                to={`/e/${eventSlug}/${teamSlug}/summary`}
                className="flex items-center gap-1 text-sm bg-gray-700 hover:bg-gray-600 text-white px-3 py-1.5 rounded-lg"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                Summary
              </Link>
            </div>
          </div>
          
          {/* Team name */}
          <h1 className="text-xl font-bold text-white">
            {eventTeam?.club_teams?.team_name}
          </h1>
          <p className="text-sm text-gray-400">
            Tap a game to log coaches
          </p>
        </div>
      </header>

      {/* Content */}
      <main className="p-4">
        {games.length === 0 ? (
          <EmptyState
            icon="calendar"
            title="No games scheduled"
            message="Games will appear here once the admin adds them"
          />
        ) : (
          <div className="space-y-4">
            {games.map((game, index) => {
              const coachCount = getGameAttendanceCount(game.id);
              const schoolCount = getGameSchoolCount(game.id);
              const isClosed = game.is_closed;
              const isUnlocked = isGameUnlocked(game);
              const isLocked = !isClosed && !isUnlocked && game.game_time;
              
              return (
                <div key={game.id}>
                  {isClosed ? (
                    // Closed game - show as non-clickable card
                    <div className="bg-white rounded-lg border shadow-sm p-4 opacity-75">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <svg className="h-5 w-5 text-gray-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                          </svg>
                          <div className="min-w-0">
                            <p className="text-sm text-gray-500">
                              <span className="font-medium text-gray-700">Game {index + 1}</span> • {formatDate(game.game_date)}
                              {game.game_time && <span className="ml-1">@ {formatGameTime(game)}</span>}
                              <span className="ml-2 text-xs bg-gray-200 text-gray-600 px-2 py-0.5 rounded">Closed</span>
                            </p>
                            <p className="font-semibold text-lg text-gray-700 truncate">vs {game.opponent}</p>
                          </div>
                        </div>
                        <Link
                          to={`/e/${eventSlug}/${teamSlug}/summary`}
                          className="bg-gray-500 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-gray-600 flex-shrink-0"
                        >
                          View Summary
                        </Link>
                      </div>
                      {coachCount > 0 && (
                        <div className="mt-3 pt-3 border-t text-sm text-gray-500">
                          {coachCount} coach{coachCount !== 1 ? 'es' : ''} from {schoolCount} school{schoolCount !== 1 ? 's' : ''} logged
                        </div>
                      )}
                    </div>
                  ) : isLocked ? (
                    // Locked game - not yet time to log coaches
                    <div className="bg-white rounded-lg border shadow-sm p-4 opacity-90">
                      <div className="flex justify-between items-start gap-3">
                        <div className="flex items-start gap-2 min-w-0 flex-1">
                          <svg className="h-5 w-5 text-amber-500 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <div className="min-w-0">
                            <p className="text-sm text-gray-500">
                              <span className="font-medium text-gray-700">Game {index + 1}</span> • {formatDate(game.game_date)} @ {formatGameTime(game)}
                            </p>
                            <p className="font-semibold text-lg text-gray-700 truncate">vs {game.opponent}</p>
                          </div>
                        </div>
                        <div className="bg-amber-100 text-amber-800 px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0 text-center">
                          <div className="text-xs text-amber-600">Opens at</div>
                          <div>{getUnlockTime(game)}</div>
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t text-sm text-amber-600">
                        <svg className="h-4 w-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                        Logging opens {unlockMinutes} minutes before game time
                      </div>
                    </div>
                  ) : (
                    // Open game - clickable link to game page
                    <Link
                      to={`/e/${eventSlug}/${teamSlug}/game/${game.id}`}
                      className="block bg-white rounded-lg border shadow-sm p-4 hover:shadow-md hover:border-blue-300 transition-all active:bg-gray-50"
                    >
                      <div className="flex justify-between items-start gap-3">
                        <div className="min-w-0 flex-1">
                          <p className="text-sm text-gray-500">
                            <span className="font-medium text-gray-700">Game {index + 1}</span> • {formatDate(game.game_date)}
                            {game.game_time && <span className="ml-1">@ {formatGameTime(game)}</span>}
                          </p>
                          <p className="font-semibold text-lg truncate">vs {game.opponent}</p>
                        </div>
                        <div className="bg-blue-600 text-white px-3 py-2 rounded-lg text-sm font-medium flex-shrink-0">
                          + Add Coaches
                        </div>
                      </div>
                      
                      {coachCount > 0 ? (
                        <div className="mt-3 pt-3 border-t text-sm text-gray-600">
                          <span className="text-green-600 font-medium">{coachCount}</span> coach{coachCount !== 1 ? 'es' : ''} from <span className="font-medium">{schoolCount}</span> school{schoolCount !== 1 ? 's' : ''} logged
                        </div>
                      ) : (
                        <div className="mt-3 pt-3 border-t text-sm text-gray-400">
                          No coaches logged yet. Tap to add.
                        </div>
                      )}
                    </Link>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </main>

      {/* Feedback Button */}
      <FeedbackButton />
    </div>
  );
}
