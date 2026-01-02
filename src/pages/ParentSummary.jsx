import React, { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { 
  PageLoader, 
  ErrorMessage,
  Toast
} from '../components/LoadingStates';
import OPLogo from '../components/OPLogo';

/**
 * Parent Summary Page - Read-only view of event attendance
 * 
 * Features:
 * - Game-centric and College-centric views
 * - CSV export
 * - No editing capabilities
 */
export default function ParentSummary() {
  const { eventSlug, teamSlug } = useParams();
  
  // Page data
  const [eventTeam, setEventTeam] = useState(null);
  const [games, setGames] = useState([]);
  const [attendance, setAttendance] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  
  // View toggle
  const [viewMode, setViewMode] = useState('games'); // 'games' or 'colleges'
  
  // Export state
  const [exporting, setExporting] = useState(false);
  
  // Toast
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  const showToast = useCallback((message, type = 'success') => {
    setToast({ show: true, message, type });
  }, []);

  // Load page data
  useEffect(() => {
    async function loadPageData() {
      try {
        setPageLoading(true);
        setPageError(null);

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
        setGames(gamesData || []);

        // Get all attendance for these games
        if (gamesData && gamesData.length > 0) {
          const gameIds = gamesData.map(g => g.id);
          const { data: attendanceData, error: attendanceError } = await supabase
            .from('attendance')
            .select('*, coaches(*, schools(*))')
            .in('game_id', gameIds);

          if (attendanceError) throw attendanceError;
          setAttendance(attendanceData || []);
        }

      } catch (err) {
        console.error('Error loading page:', err);
        setPageError(err.message);
      } finally {
        setPageLoading(false);
      }
    }

    if (eventSlug && teamSlug) {
      loadPageData();
    }
  }, [eventSlug, teamSlug]);

  // Format date for display
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric'
    });
  };

  const formatDateShort = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      month: 'numeric',
      day: 'numeric'
    });
  };

  // Get attendance for a specific game
  const getGameAttendance = useCallback((gameId) => {
    return attendance.filter(a => a.game_id === gameId);
  }, [attendance]);

  // Group attendance by school for a game
  const getGameAttendanceBySchool = useCallback((gameId) => {
    const gameAttendance = getGameAttendance(gameId);
    const bySchool = {};
    
    gameAttendance.forEach(a => {
      const school = a.coaches?.schools;
      if (!school) return;
      
      if (!bySchool[school.id]) {
        bySchool[school.id] = {
          school,
          coaches: []
        };
      }
      bySchool[school.id].coaches.push(a.coaches);
    });
    
    // Sort by school name
    return Object.values(bySchool).sort((a, b) => 
      a.school.school.localeCompare(b.school.school)
    );
  }, [getGameAttendance]);

  // Group all attendance by school (for college-centric view)
  const getAttendanceBySchool = useCallback(() => {
    const bySchool = {};
    
    attendance.forEach(a => {
      const school = a.coaches?.schools;
      if (!school) return;
      
      if (!bySchool[school.id]) {
        bySchool[school.id] = {
          school,
          gameCoaches: {} // gameId -> coaches
        };
      }
      
      const gameId = a.game_id;
      if (!bySchool[school.id].gameCoaches[gameId]) {
        bySchool[school.id].gameCoaches[gameId] = [];
      }
      bySchool[school.id].gameCoaches[gameId].push(a.coaches);
    });
    
    return Object.values(bySchool).sort((a, b) => 
      a.school.school.localeCompare(b.school.school)
    );
  }, [attendance]);

  // Export to CSV
  const exportToCSV = async () => {
    setExporting(true);
    
    try {
      if (games.length === 0) {
        showToast('No games to export', 'error');
        setExporting(false);
        return;
      }

      if (attendance.length === 0) {
        showToast('No attendance data to export', 'error');
        setExporting(false);
        return;
      }

      // Build pivot data: group by school, then by game
      const schoolData = {};
      attendance.forEach(record => {
        const school = record.coaches?.schools;
        const coach = record.coaches;
        if (!school || !coach) return;

        if (!schoolData[school.id]) {
          schoolData[school.id] = {
            school: school.school,
            division: school.division || '',
            conference: school.conference || '',
            state: school.state || '',
            // Collect unique emails from coaches at this school
            emails: new Set(),
            games: {}
          };
        }

        // Add coach email if present
        if (coach.email) {
          schoolData[school.id].emails.add(coach.email);
        }

        const gameId = record.game_id;
        if (!schoolData[school.id].games[gameId]) {
          schoolData[school.id].games[gameId] = [];
        }
        schoolData[school.id].games[gameId].push(`${coach.first_name} ${coach.last_name}`);
      });

      // Create CSV header - now includes Email column
      const headers = ['College', 'Division', 'Conference', 'State', 'Email(s)',
        ...games.map(g => `${formatDateShort(g.game_date)} vs ${g.opponent}`)
      ];

      // Create CSV rows
      const rows = Object.values(schoolData)
        .sort((a, b) => a.school.localeCompare(b.school))
        .map(data => {
          const row = [
            `"${data.school}"`,
            `"${data.division}"`,
            `"${data.conference}"`,
            `"${data.state}"`,
            `"${[...data.emails].join('; ')}"`
          ];
          games.forEach(game => {
            const coaches = data.games[game.id] || [];
            row.push(`"${coaches.join(', ')}"`)
          });
          return row.join(',');
        });

      // Combine into CSV content
      const csvContent = [headers.map(h => `"${h}"`).join(','), ...rows].join('\n');

      // Download file
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${eventTeam.events.event_name} - ${eventTeam.club_teams.team_name}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      showToast('Export downloaded!');
    } catch (err) {
      console.error('Export error:', err);
      showToast('Error exporting data', 'error');
    }
    
    setExporting(false);
  };

  // Get unique schools count
  const uniqueSchools = new Set(attendance.map(a => a.coaches?.schools?.id).filter(Boolean)).size;
  const uniqueCoaches = new Set(attendance.map(a => a.coaches?.id).filter(Boolean)).size;

  // Loading state
  if (pageLoading) {
    return <PageLoader message="Loading summary..." />;
  }

  // Error state
  if (pageError) {
    return (
      <div className="min-h-screen bg-gray-50 p-4">
        <ErrorMessage 
          title="Could not load summary" 
          message={pageError}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50 pb-8">
      {/* Header */}
      <div className="op-header shadow-lg">
        <div className="op-gradient-border"></div>
        <div className="max-w-4xl mx-auto px-4 py-4">
          <div className="flex justify-between items-start">
            <div className="flex-1 min-w-0">
              {/* Breadcrumb navigation */}
              <div className="flex items-center gap-2 text-sm text-gray-400 mb-2 flex-wrap">
                <Link to="/home" className="flex items-center gap-1.5 hover:text-cyan-300 transition-colors">
                  <OPLogo className="h-5 w-auto" />
                  <span>Home</span>
                </Link>
                <span>›</span>
                <Link to={`/e/${eventSlug}`} className="hover:text-cyan-300 transition-colors truncate">
                  {eventTeam?.events?.event_name}
                </Link>
                <span className="hidden sm:inline">›</span>
                <Link to={`/e/${eventSlug}/${teamSlug}`} className="hover:text-cyan-300 transition-colors hidden sm:inline truncate">
                  {eventTeam?.club_teams?.team_name}
                </Link>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-white truncate">
                {eventTeam?.club_teams?.team_name} - Summary
              </h1>
              {eventTeam?.events?.start_date && (
                <p className="text-sm text-cyan-300">
                  {formatDate(eventTeam.events.start_date)}
                  {eventTeam.events.end_date && eventTeam.events.end_date !== eventTeam.events.start_date && 
                    ` - ${formatDate(eventTeam.events.end_date)}`}
                </p>
              )}
            </div>
            <Link
              to="/help?context=parent"
              className="ml-2 bg-gray-700 text-gray-200 p-1.5 rounded-lg text-sm font-medium hover:bg-gray-600 transition-colors flex-shrink-0"
              title="Help"
            >
              <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </Link>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6">
        {/* Stats Summary */}
        <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Attendance Summary</h2>
          <div className="grid grid-cols-3 gap-2 sm:gap-4 text-center">
            <div className="bg-cyan-50 rounded-lg p-3 sm:p-4">
              <div className="text-2xl sm:text-3xl font-bold text-cyan-600">{games.length}</div>
              <div className="text-xs sm:text-sm text-gray-600">Games</div>
            </div>
            <div className="bg-blue-50 rounded-lg p-3 sm:p-4">
              <div className="text-2xl sm:text-3xl font-bold text-blue-600">{uniqueSchools}</div>
              <div className="text-xs sm:text-sm text-gray-600">Schools</div>
            </div>
            <div className="bg-purple-50 rounded-lg p-3 sm:p-4">
              <div className="text-2xl sm:text-3xl font-bold text-purple-600">{uniqueCoaches}</div>
              <div className="text-xs sm:text-sm text-gray-600">Coaches</div>
            </div>
          </div>
        </div>

        {/* View Toggle and Export */}
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mb-6">
          <div className="flex bg-white rounded-lg shadow-sm p-1">
            <button
              onClick={() => setViewMode('games')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'games'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              By Game
            </button>
            <button
              onClick={() => setViewMode('colleges')}
              className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                viewMode === 'colleges'
                  ? 'bg-gradient-to-r from-blue-600 to-cyan-600 text-white'
                  : 'text-gray-600 hover:bg-gray-100'
              }`}
            >
              By College
            </button>
          </div>

          <button
            onClick={exportToCSV}
            disabled={exporting || attendance.length === 0}
            className="flex items-center gap-2 bg-green-600 text-white px-4 py-2 rounded-lg hover:bg-green-700 disabled:bg-gray-300 disabled:cursor-not-allowed text-sm font-medium"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            {exporting ? 'Exporting...' : 'Export CSV'}
          </button>
        </div>

        {/* No Data State */}
        {attendance.length === 0 ? (
          <div className="bg-white rounded-lg shadow-md p-8 text-center">
            <div className="text-gray-400 mb-4">
              <svg className="h-16 w-16 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
            </div>
            <h3 className="text-lg font-medium text-gray-900 mb-2">No Attendance Recorded</h3>
            <p className="text-gray-500 mb-4">
              No college coaches have been logged for this event yet.
            </p>
            {games.some(g => !g.is_closed) && (
              <Link
                to={`/e/${eventSlug}/${teamSlug}`}
                className="inline-flex items-center text-blue-600 hover:text-blue-800"
              >
                Go to Live Tracker to add coaches →
              </Link>
            )}
          </div>
        ) : viewMode === 'games' ? (
          /* Game-Centric View */
          <div className="space-y-4">
            {games.map((game, index) => {
              const schoolAttendance = getGameAttendanceBySchool(game.id);
              return (
                <div key={game.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                  <div className="bg-gray-50 px-4 py-3 border-b">
                    <div className="flex items-center gap-3">
                      <span className="bg-blue-100 text-blue-800 text-sm font-medium px-2.5 py-0.5 rounded">
                        Game {index + 1}
                      </span>
                      <div>
                        <span className="font-semibold">{formatDate(game.game_date)}</span>
                        <span className="text-gray-600"> vs {game.opponent}</span>
                      </div>
                    </div>
                  </div>
                  <div className="p-4">
                    {schoolAttendance.length === 0 ? (
                      <p className="text-gray-500 text-sm italic">No coaches logged</p>
                    ) : (
                      <div className="space-y-3">
                        {schoolAttendance.map(({ school, coaches }) => (
                          <div key={school.id} className="border-l-4 border-blue-400 pl-3">
                            <div className="font-medium text-gray-900">{school.school}</div>
                            <div className="text-xs text-gray-500 mb-1">
                              {school.division} • {school.conference || 'Independent'} • {school.state}
                            </div>
                            <div className="text-sm space-y-0.5">
                              {coaches.map(c => (
                                <div key={c.id} className="flex flex-wrap items-center gap-x-2">
                                  <span className="text-gray-700">
                                    {c.first_name} {c.last_name}
                                    {c.title && <span className="text-gray-400 text-xs ml-1">({c.title})</span>}
                                  </span>
                                  {c.email && (
                                    <a
                                      href={`mailto:${c.email}`}
                                      className="text-blue-600 hover:text-blue-800 text-xs"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      {c.email}
                                    </a>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          /* College-Centric View */
          <div className="space-y-4">
            {getAttendanceBySchool().map(({ school, gameCoaches }) => (
              <div key={school.id} className="bg-white rounded-lg shadow-md overflow-hidden">
                <div className="bg-gray-50 px-4 py-3 border-b">
                  <div className="font-semibold text-gray-900">{school.school}</div>
                  <div className="text-xs text-gray-500">
                    {school.division} • {school.conference || 'Independent'} • {school.state}
                  </div>
                </div>
                <div className="p-4">
                  <div className="space-y-2">
                    {games.map((game, index) => {
                      const coaches = gameCoaches[game.id] || [];
                      if (coaches.length === 0) return null;
                      return (
                        <div key={game.id} className="flex items-start gap-3 text-sm">
                          <span className="bg-gray-100 text-gray-700 text-xs font-medium px-2 py-0.5 rounded shrink-0">
                            Game {index + 1}
                          </span>
                          <div>
                            <span className="text-gray-500">
                              {formatDateShort(game.game_date)} vs {game.opponent}:
                            </span>
                            <div className="text-gray-900 mt-0.5">
                              {coaches.map((c, i) => (
                                <span key={c.id}>
                                  {i > 0 && ', '}
                                  <span>{c.first_name} {c.last_name}</span>
                                  {c.email && (
                                    <a
                                      href={`mailto:${c.email}`}
                                      className="text-blue-600 hover:text-blue-800 text-xs ml-1"
                                      onClick={e => e.stopPropagation()}
                                    >
                                      ({c.email})
                                    </a>
                                  )}
                                </span>
                              ))}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Toast */}
      <Toast 
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast(t => ({ ...t, show: false }))}
      />
    </div>
  );
}
