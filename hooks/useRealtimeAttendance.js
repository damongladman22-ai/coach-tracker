import { useEffect, useState, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';

/**
 * Polling-based attendance updates (works on Supabase free tier!)
 * 
 * Checks for updates every 5 seconds when the tab is visible.
 * Multiple parents will see each other's entries with a small delay.
 */
export function useRealtimeAttendance(eventTeamId) {
  const [attendance, setAttendance] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastUpdate, setLastUpdate] = useState(null);
  
  // Track if component is mounted to avoid state updates after unmount
  const isMounted = useRef(true);
  
  // Polling interval (5 seconds - responsive enough for field use)
  const POLL_INTERVAL = 5000;

  // Fetch attendance data
  const fetchAttendance = useCallback(async (showLoading = false) => {
    if (!eventTeamId) return;
    
    try {
      if (showLoading) setLoading(true);
      setError(null);
      
      const { data, error: fetchError } = await supabase
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
          ),
          games!inner (
            id,
            event_team_id
          )
        `)
        .eq('games.event_team_id', eventTeamId);

      if (fetchError) throw fetchError;
      
      if (isMounted.current) {
        setAttendance(data || []);
        setLastUpdate(new Date());
      }
    } catch (err) {
      console.error('Error fetching attendance:', err);
      if (isMounted.current) {
        setError(err.message);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [eventTeamId]);

  // Initial fetch and polling setup
  useEffect(() => {
    isMounted.current = true;
    
    if (!eventTeamId) {
      setLoading(false);
      return;
    }

    // Initial fetch
    fetchAttendance(true);

    // Set up polling interval
    const pollInterval = setInterval(() => {
      // Only poll if tab is visible (saves bandwidth)
      if (!document.hidden) {
        fetchAttendance(false);
      }
    }, POLL_INTERVAL);

    // Also refresh when tab becomes visible
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        fetchAttendance(false);
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup
    return () => {
      isMounted.current = false;
      clearInterval(pollInterval);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [eventTeamId, fetchAttendance]);

  // Add attendance with optimistic update
  const addAttendance = async (gameId, coachId) => {
    try {
      const { data, error: insertError } = await supabase
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
          ),
          games!inner (
            id,
            event_team_id
          )
        `)
        .single();

      if (insertError) throw insertError;
      
      // Optimistically add to local state immediately
      if (data && isMounted.current) {
        setAttendance(prev => [...prev, data]);
      }
      
      return { success: true, data };
    } catch (err) {
      console.error('Error adding attendance:', err);
      return { success: false, error: err.message };
    }
  };

  // Remove attendance with optimistic update
  const removeAttendance = async (attendanceId) => {
    // Optimistically remove from local state
    const previousAttendance = attendance;
    setAttendance(prev => prev.filter(a => a.id !== attendanceId));
    
    try {
      const { error: deleteError } = await supabase
        .from('attendance')
        .delete()
        .eq('id', attendanceId);

      if (deleteError) throw deleteError;
      return { success: true };
    } catch (err) {
      console.error('Error removing attendance:', err);
      // Rollback on error
      if (isMounted.current) {
        setAttendance(previousAttendance);
      }
      return { success: false, error: err.message };
    }
  };

  return {
    attendance,
    loading,
    error,
    lastUpdate,
    addAttendance,
    removeAttendance,
    refetch: () => fetchAttendance(true)
  };
}

/**
 * Polling-based coaches list (works on Supabase free tier!)
 * When a parent adds a new coach, others see it on next poll.
 */
export function useRealtimeCoaches(schoolId) {
  const [coaches, setCoaches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const isMounted = useRef(true);
  
  const POLL_INTERVAL = 5000;

  const fetchCoaches = useCallback(async (showLoading = false) => {
    if (!schoolId) {
      setCoaches([]);
      setLoading(false);
      return;
    }

    try {
      if (showLoading) setLoading(true);
      
      const { data, error: fetchError } = await supabase
        .from('coaches')
        .select('*')
        .eq('school_id', schoolId)
        .order('last_name');

      if (fetchError) throw fetchError;
      
      if (isMounted.current) {
        setCoaches(data || []);
      }
    } catch (err) {
      console.error('Error fetching coaches:', err);
      if (isMounted.current) {
        setError(err.message);
      }
    } finally {
      if (isMounted.current) {
        setLoading(false);
      }
    }
  }, [schoolId]);

  useEffect(() => {
    isMounted.current = true;
    
    fetchCoaches(true);

    if (!schoolId) return;

    // Poll for new coaches
    const pollInterval = setInterval(() => {
      if (!document.hidden) {
        fetchCoaches(false);
      }
    }, POLL_INTERVAL);

    return () => {
      isMounted.current = false;
      clearInterval(pollInterval);
    };
  }, [schoolId, fetchCoaches]);

  return { coaches, loading, error, refetch: () => fetchCoaches(true) };
}
