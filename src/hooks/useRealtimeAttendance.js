import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook for polling-based attendance updates
 * Features:
 * - Adaptive polling: starts at 5s, slows to 10s if fetches are slow
 * - Visibility-aware: pauses when tab is hidden
 * - Free tier friendly - no realtime subscription needed
 */
export function useRealtimeAttendance(eventTeamId) {
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const intervalRef = useRef(null);
  const pollIntervalRef = useRef(5000); // Start at 5 seconds
  const isVisibleRef = useRef(true);

  // Fetch attendance data with coach and school info
  const fetchAttendance = useCallback(async () => {
    if (!eventTeamId) return;
    
    // Skip if tab is not visible
    if (!isVisibleRef.current) return;
    
    const startTime = Date.now();

    try {
      // Get all game IDs for this event team
      const { data: games, error: gamesError } = await supabase
        .from('games')
        .select('id')
        .eq('event_team_id', eventTeamId);

      if (gamesError) throw gamesError;
      
      if (!games || games.length === 0) {
        setAttendance([]);
        setLoading(false);
        setLastUpdate(new Date());
        return;
      }

      const gameIds = games.map(g => g.id);

      // Get attendance for all games with coach and school details
      const { data: attendanceData, error: attendanceError } = await supabase
        .from('attendance')
        .select(`
          id,
          game_id,
          coach_id,
          coaches (
            id,
            first_name,
            last_name,
            school_id,
            schools (
              id,
              school,
              city,
              state,
              division,
              conference
            )
          )
        `)
        .in('game_id', gameIds);

      if (attendanceError) throw attendanceError;

      setAttendance(attendanceData || []);
      setError(null);
      setLastUpdate(new Date());
      
      // Adaptive polling: if fetch took > 2 seconds, slow down polling
      const fetchTime = Date.now() - startTime;
      if (fetchTime > 2000 && pollIntervalRef.current < 10000) {
        pollIntervalRef.current = 10000; // Slow to 10 seconds
      } else if (fetchTime < 1000 && pollIntervalRef.current > 5000) {
        pollIntervalRef.current = 5000; // Speed back up to 5 seconds
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setError(err.message);
      // On error, slow down polling
      pollIntervalRef.current = 10000;
    } finally {
      setLoading(false);
    }
  }, [eventTeamId]);

  // Initial fetch and adaptive polling setup
  useEffect(() => {
    if (!eventTeamId) {
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchAttendance();

    // Adaptive polling function
    const poll = () => {
      fetchAttendance();
      // Schedule next poll with current interval
      intervalRef.current = setTimeout(poll, pollIntervalRef.current);
    };
    
    // Start polling
    intervalRef.current = setTimeout(poll, pollIntervalRef.current);

    // Handle visibility change - pause polling when tab is hidden
    const handleVisibilityChange = () => {
      isVisibleRef.current = document.visibilityState === 'visible';
      
      if (isVisibleRef.current) {
        // Tab became visible - fetch immediately and restart polling
        fetchAttendance();
        if (!intervalRef.current) {
          intervalRef.current = setTimeout(poll, pollIntervalRef.current);
        }
      } else {
        // Tab hidden - clear polling
        if (intervalRef.current) {
          clearTimeout(intervalRef.current);
          intervalRef.current = null;
        }
      }
    };
    
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      if (intervalRef.current) {
        clearTimeout(intervalRef.current);
      }
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [eventTeamId, fetchAttendance]);

  // Add attendance (optimistic update)
  const addAttendance = useCallback(async (gameId, coachId) => {
    try {
      const { data, error } = await supabase
        .from('attendance')
        .insert({ game_id: gameId, coach_id: coachId })
        .select(`
          id,
          game_id,
          coach_id,
          coaches (
            id,
            first_name,
            last_name,
            school_id,
            schools (
              id,
              school,
              city,
              state,
              division,
              conference
            )
          )
        `)
        .single();

      if (error) throw error;

      // Optimistic update
      setAttendance(prev => [...prev, data]);
      return { success: true, data };
    } catch (err) {
      console.error('Error adding attendance:', err);
      return { success: false, error: err.message };
    }
  }, []);

  // Remove attendance (optimistic update)
  const removeAttendance = useCallback(async (attendanceId) => {
    try {
      // Optimistic update - remove immediately
      setAttendance(prev => prev.filter(a => a.id !== attendanceId));

      const { error } = await supabase
        .from('attendance')
        .delete()
        .eq('id', attendanceId);

      if (error) throw error;

      return { success: true };
    } catch (err) {
      console.error('Error removing attendance:', err);
      // Refetch to restore state if delete failed
      fetchAttendance();
      return { success: false, error: err.message };
    }
  }, [fetchAttendance]);

  return {
    attendance,
    loading,
    error,
    lastUpdate,
    addAttendance,
    removeAttendance,
    refetch: fetchAttendance
  };
}

/**
 * Hook for fetching coaches for a specific school
 * With polling to catch newly added coaches
 */
export function useRealtimeCoaches(schoolId) {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const fetchCoaches = useCallback(async () => {
    if (!schoolId) {
      setCoaches([]);
      setLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('coaches')
        .select('*')
        .eq('school_id', schoolId)
        .order('last_name');

      if (error) throw error;

      setCoaches(data || []);
      setError(null);
    } catch (err) {
      console.error('Error fetching coaches:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [schoolId]);

  useEffect(() => {
    setLoading(true);
    fetchCoaches();
  }, [schoolId, fetchCoaches]);

  return {
    coaches,
    loading,
    error,
    refetch: fetchCoaches
  };
}
