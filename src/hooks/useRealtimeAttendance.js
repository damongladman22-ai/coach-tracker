import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Hook for polling-based attendance updates
 * Auto-refreshes every 5 seconds (free tier friendly - no realtime subscription needed)
 * Multiple parents will see each other's entries with slight delay
 */
export function useRealtimeAttendance(eventTeamId) {
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  const intervalRef = useRef(null);

  // Fetch attendance data with coach and school info
  const fetchAttendance = useCallback(async () => {
    if (!eventTeamId) return;

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
    } catch (err) {
      console.error('Error fetching attendance:', err);
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [eventTeamId]);

  // Initial fetch and polling setup
  useEffect(() => {
    if (!eventTeamId) {
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchAttendance();

    // Set up polling every 5 seconds
    intervalRef.current = setInterval(fetchAttendance, 5000);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
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
