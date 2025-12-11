import React, { useState, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useRealtimeAttendance, useRealtimeCoaches } from '../hooks/useRealtimeAttendance';
import { SchoolSearch } from '../components/SchoolSearch';
import { 
  PageLoader, 
  Spinner, 
  LoadingButton, 
  ErrorMessage, 
  Toast, 
  EmptyState,
  ConnectionStatus,
  CardSkeleton 
} from '../components/LoadingStates';

/**
 * Mobile-Optimized Parent Team Page
 * 
 * Features:
 * - Auto-refresh polling (updates every 5 seconds - free tier friendly!)
 * - Large touch targets for field use
 * - Optimistic updates for instant feedback
 * - Toast notifications for feedback
 * - Loading states throughout
 */
export default function TeamGames() {
  const { eventSlug, teamSlug } = useParams();
  
  // Page data
  const [eventTeam, setEventTeam] = useState(null);
  const [games, setGames] = useState([]);
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState(null);
  
  // Modal state
  const [selectedGame, setSelectedGame] = useState(null);
  const [showAddCoachModal, setShowAddCoachModal] = useState(false);
  
  // (removed - using polling-based auto-refresh now)
  
  // Toast notifications
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // View toggle
  const [viewMode, setViewMode] = useState('games'); // 'games' or 'colleges'

  // Polling-based attendance hook (auto-refreshes every 5 seconds)
  const { 
    attendance, 
    loading: attendanceLoading,
    lastUpdate,
    addAttendance, 
    removeAttendance,
    refetch: refetchAttendance 
  } = useRealtimeAttendance(eventTeam?.id);

  // Show toast notification
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

  // Format date for display (handles timezone correctly)
  const formatDate = (dateStr) => {
    if (!dateStr) return '';
    const [year, month, day] = dateStr.split('-');
    return new Date(year, month - 1, day).toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
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
      bySchool[school.id].coaches.push({
        ...a.coaches,
        attendanceId: a.id
      });
    });
    
    return Object.values(bySchool);
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
      bySchool[school.id].gameCoaches[gameId].push({
        ...a.coaches,
        attendanceId: a.id
      });
    });
    
    return Object.values(bySchool).sort((a, b) => 
      a.school.school.localeCompare(b.school.school)
    );
  }, [attendance]);

  // Handle removing a coach attendance
  const handleRemoveAttendance = async (attendanceId, coachName) => {
    const confirmed = window.confirm(`Remove ${coachName} from this game?`);
    if (!confirmed) return;

    const result = await removeAttendance(attendanceId);
    if (result.success) {
      showToast(`${coachName} removed`);
    } else {
      showToast('Failed to remove. Please try again.', 'error');
    }
  };

  // Loading state
  if (pageLoading) {
    return <PageLoader message="Loading team schedule..." />;
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
    <div className="min-h-screen bg-gray-50 pb-20">
      {/* Auto-refresh status indicator */}
      <ConnectionStatus lastUpdate={lastUpdate} />

      {/* Header */}
      <header className="bg-white border-b sticky top-0 z-40">
        <div className="px-4 py-4">
          <h1 className="text-xl font-bold text-gray-900">
            {eventTeam?.club_teams?.team_name}
          </h1>
          <p className="text-gray-600">
            {eventTeam?.events?.event_name}
          </p>
        </div>

        {/* View toggle */}
        <div className="px-4 pb-3 flex gap-2">
          <button
            onClick={() => setViewMode('games')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'games'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            By Game
          </button>
          <button
            onClick={() => setViewMode('colleges')}
            className={`flex-1 py-2 px-4 rounded-lg text-sm font-medium transition-colors ${
              viewMode === 'colleges'
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700'
            }`}
          >
            By College
          </button>
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
        ) : viewMode === 'games' ? (
          /* Game-centric view */
          <div className="space-y-4">
            {games.map(game => {
              const schoolAttendance = getGameAttendanceBySchool(game.id);
              return (
                <div key={game.id} className="bg-white rounded-lg border shadow-sm">
                  {/* Game header */}
                  <div className="p-4 border-b">
                    <div className="flex justify-between items-start">
                      <div>
                        <p className="text-sm text-gray-500">{formatDate(game.game_date)}</p>
                        <p className="font-semibold text-lg">vs {game.opponent}</p>
                      </div>
                      <button
                        onClick={() => setSelectedGame(game)}
                        className="bg-blue-600 text-white px-4 py-3 rounded-lg text-sm font-medium hover:bg-blue-700 active:bg-blue-800"
                      >
                        + Add Coaches
                      </button>
                    </div>
                  </div>

                  {/* Attendance list */}
                  <div className="p-4">
                    {attendanceLoading ? (
                      <div className="flex justify-center py-4">
                        <Spinner size="sm" />
                      </div>
                    ) : schoolAttendance.length === 0 ? (
                      <p className="text-gray-500 text-center py-4">
                        No coaches logged yet. Tap "Add Coaches" to start.
                      </p>
                    ) : (
                      <div className="space-y-3">
                        {schoolAttendance.map(({ school, coaches }) => (
                          <div key={school.id} className="bg-gray-50 rounded-lg p-3">
                            <p className="font-medium text-gray-900">{school.school}</p>
                            <p className="text-xs text-gray-500 mb-2">
                              {school.division} • {school.conference || school.state}
                            </p>
                            <div className="flex flex-wrap gap-2">
                              {coaches.map(coach => (
                                <span 
                                  key={coach.attendanceId}
                                  onClick={() => handleRemoveAttendance(
                                    coach.attendanceId, 
                                    `${coach.first_name} ${coach.last_name}`
                                  )}
                                  className="inline-flex items-center gap-1 bg-white px-3 py-1.5 rounded-full text-sm border cursor-pointer hover:bg-red-50 hover:border-red-200 hover:text-red-700 transition-colors"
                                >
                                  {coach.first_name} {coach.last_name}
                                  <svg className="h-4 w-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                                  </svg>
                                </span>
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
          /* College-centric view */
          <div className="space-y-4">
            {attendanceLoading ? (
              <CardSkeleton count={3} />
            ) : getAttendanceBySchool().length === 0 ? (
              <EmptyState
                icon="users"
                title="No colleges logged yet"
                message="Switch to 'By Game' view and tap 'Add Coaches' to start logging"
              />
            ) : (
              getAttendanceBySchool().map(({ school, gameCoaches }) => (
                <div key={school.id} className="bg-white rounded-lg border shadow-sm p-4">
                  <h3 className="font-semibold text-lg text-gray-900">{school.school}</h3>
                  <p className="text-sm text-gray-500 mb-3">
                    {school.division} • {school.conference || school.state}
                  </p>
                  
                  <div className="space-y-2">
                    {Object.entries(gameCoaches).map(([gameId, coaches]) => {
                      const game = games.find(g => g.id === parseInt(gameId));
                      return (
                        <div key={gameId} className="text-sm">
                          <span className="text-gray-500">
                            {formatDate(game?.game_date)} vs {game?.opponent}:
                          </span>
                          <span className="text-gray-900 ml-1">
                            {coaches.map(c => `${c.first_name} ${c.last_name}`).join(', ')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </main>

      {/* Add Coach Modal */}
      {selectedGame && (
        <AddCoachModal
          game={selectedGame}
          onClose={() => setSelectedGame(null)}
          onAdd={async (coachId) => {
            const result = await addAttendance(selectedGame.id, coachId);
            if (result.success) {
              showToast('Coach added!');
            } else {
              showToast('Failed to add coach', 'error');
            }
            return result;
          }}
          existingCoachIds={getGameAttendance(selectedGame.id).map(a => a.coach_id)}
        />
      )}

      {/* Toast notifications */}
      <Toast 
        show={toast.show}
        message={toast.message}
        type={toast.type}
        onClose={() => setToast(t => ({ ...t, show: false }))}
      />
    </div>
  );
}

/**
 * Modal for adding coaches to a game
 * Mobile-optimized with large touch targets
 */
function AddCoachModal({ game, onClose, onAdd, existingCoachIds = [] }) {
  const [selectedSchool, setSelectedSchool] = useState(null);
  const [selectedCoaches, setSelectedCoaches] = useState([]);
  const [saving, setSaving] = useState(false);
  const [showNewCoachForm, setShowNewCoachForm] = useState(false);
  const [newCoach, setNewCoach] = useState({ firstName: '', lastName: '' });
  const [addingNewCoach, setAddingNewCoach] = useState(false);

  // Real-time coaches for selected school
  const { coaches, loading: coachesLoading, refetch: refetchCoaches } = useRealtimeCoaches(selectedSchool?.id);

  // Filter out already-added coaches
  const availableCoaches = coaches.filter(c => !existingCoachIds.includes(c.id));

  // Toggle coach selection
  const toggleCoach = (coach) => {
    setSelectedCoaches(prev => {
      const isSelected = prev.some(c => c.id === coach.id);
      if (isSelected) {
        return prev.filter(c => c.id !== coach.id);
      }
      return [...prev, coach];
    });
  };

  // Save selected coaches
  const handleSave = async () => {
    if (selectedCoaches.length === 0) return;
    
    setSaving(true);
    try {
      for (const coach of selectedCoaches) {
        await onAdd(coach.id);
      }
      onClose();
    } catch (err) {
      console.error('Error saving:', err);
    } finally {
      setSaving(false);
    }
  };

  // Add new coach to database
  const handleAddNewCoach = async (e) => {
    e.preventDefault();
    if (!newCoach.firstName.trim() || !newCoach.lastName.trim() || !selectedSchool) return;

    setAddingNewCoach(true);
    try {
      const { data, error } = await supabase
        .from('coaches')
        .insert({
          first_name: newCoach.firstName.trim(),
          last_name: newCoach.lastName.trim(),
          school_id: selectedSchool.id
        })
        .select()
        .single();

      if (error) throw error;

      // Auto-select the new coach
      setSelectedCoaches(prev => [...prev, data]);
      setNewCoach({ firstName: '', lastName: '' });
      setShowNewCoachForm(false);
      await refetchCoaches();
    } catch (err) {
      console.error('Error adding coach:', err);
      alert('Failed to add coach. Please try again.');
    } finally {
      setAddingNewCoach(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-end sm:items-center justify-center">
      <div className="bg-white w-full max-w-lg max-h-[90vh] rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col">
        {/* Header */}
        <div className="p-4 border-b flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="font-semibold text-lg">Add College Coaches</h2>
            <p className="text-sm text-gray-600">vs {game.opponent}</p>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-200 rounded-full"
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          {/* School search */}
          <div className="mb-4">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              1. Search for a college
            </label>
            <SchoolSearch 
              selectedSchool={selectedSchool}
              onSelect={school => {
                setSelectedSchool(school);
                setSelectedCoaches([]);
              }}
            />
          </div>

          {/* Coach selection */}
          {selectedSchool && (
            <div className="mb-4">
              <div className="flex justify-between items-center mb-2">
                <label className="block text-sm font-medium text-gray-700">
                  2. Select coaches present
                </label>
                <button
                  onClick={() => setShowNewCoachForm(true)}
                  className="text-sm text-blue-600 hover:text-blue-700 font-medium"
                >
                  + Add New Coach
                </button>
              </div>

              {/* New coach form */}
              {showNewCoachForm && (
                <form onSubmit={handleAddNewCoach} className="mb-4 p-3 bg-blue-50 rounded-lg">
                  <p className="text-sm text-blue-700 mb-2">Add coach for {selectedSchool.school}</p>
                  <div className="flex gap-2 mb-2">
                    <input
                      type="text"
                      placeholder="First name"
                      value={newCoach.firstName}
                      onChange={e => setNewCoach(p => ({ ...p, firstName: e.target.value }))}
                      className="flex-1 px-3 py-3 border rounded-lg text-base"
                      autoFocus
                    />
                    <input
                      type="text"
                      placeholder="Last name"
                      value={newCoach.lastName}
                      onChange={e => setNewCoach(p => ({ ...p, lastName: e.target.value }))}
                      className="flex-1 px-3 py-3 border rounded-lg text-base"
                    />
                  </div>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => setShowNewCoachForm(false)}
                      className="flex-1 px-4 py-2 bg-white border rounded-lg"
                    >
                      Cancel
                    </button>
                    <LoadingButton
                      type="submit"
                      loading={addingNewCoach}
                      className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg"
                    >
                      Add Coach
                    </LoadingButton>
                  </div>
                </form>
              )}

              {coachesLoading ? (
                <div className="flex justify-center py-8">
                  <Spinner />
                </div>
              ) : availableCoaches.length === 0 && !showNewCoachForm ? (
                <div className="text-center py-8 text-gray-500">
                  <p>No coaches found for this school.</p>
                  <button
                    onClick={() => setShowNewCoachForm(true)}
                    className="mt-2 text-blue-600 hover:text-blue-700"
                  >
                    Add the first coach
                  </button>
                </div>
              ) : (
                <div className="space-y-2">
                  {availableCoaches.map(coach => {
                    const isSelected = selectedCoaches.some(c => c.id === coach.id);
                    return (
                      <button
                        key={coach.id}
                        onClick={() => toggleCoach(coach)}
                        className={`w-full text-left p-4 rounded-lg border-2 transition-colors ${
                          isSelected 
                            ? 'border-blue-500 bg-blue-50' 
                            : 'border-gray-200 hover:border-gray-300'
                        }`}
                      >
                        <div className="flex items-center justify-between">
                          <span className="font-medium">
                            {coach.first_name} {coach.last_name}
                          </span>
                          {isSelected && (
                            <svg className="h-5 w-5 text-blue-600" fill="currentColor" viewBox="0 0 20 20">
                              <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                            </svg>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer with save button */}
        <div className="p-4 border-t bg-gray-50">
          <LoadingButton
            onClick={handleSave}
            loading={saving}
            disabled={selectedCoaches.length === 0}
            className="w-full py-4 bg-blue-600 text-white rounded-lg font-semibold text-lg disabled:bg-gray-300 disabled:cursor-not-allowed"
          >
            {selectedCoaches.length === 0 
              ? 'Select coaches to add' 
              : `Add ${selectedCoaches.length} Coach${selectedCoaches.length !== 1 ? 'es' : ''}`}
          </LoadingButton>
        </div>
      </div>
    </div>
  );
}
