/**
 * Loads school_aliases once and hands it to the shared matcher.
 *
 * WHY A MODULE-LEVEL INDEX rather than a prop threaded through every surface:
 * the whole reason schoolMatch.js exists is that five search boxes each had
 * their own rules. Passing an alias index into five call sites would rebuild
 * that coupling one layer up, and a sixth search box would silently miss out —
 * which is exactly the failure mode the consolidation was meant to end. One
 * call at app level, and every consumer of the matcher gets aliases.
 *
 * DEGRADES TO NOTHING. If the fetch fails, the index stays empty and search
 * behaves exactly as it did before the table existed. Alias data is an
 * enhancement, never a dependency — a search box that breaks because a lookup
 * table did not load is worse than one without abbreviations.
 */
import { useEffect } from 'react';
import { supabase } from './supabase';
import { setAliasIndex } from './schoolMatch';

// Fetched once per page load and shared. Not React state: the matcher reads it
// synchronously during scoring, and nothing re-renders on its arrival beyond
// the next keystroke, which is when a search result would change anyway.
let loaded = false;

export function useSchoolAliases() {
  useEffect(() => {
    if (loaded) return;
    loaded = true;
    let cancelled = false;

    (async () => {
      try {
        const rows = [];
        let last = null;
        // Keyset pagination on id, not .range(). Offset paging over a table
        // that is being written skips and repeats rows; seeking cannot.
        for (;;) {
          let q = supabase
            .from('school_aliases')
            .select('id, school_id, alias_norm')
            .order('id')
            .limit(1000);
          if (last !== null) q = q.gt('id', last);
          const { data, error } = await q;
          if (error) throw error;
          if (!data || data.length === 0) break;
          rows.push(...data);
          last = data[data.length - 1].id;
          if (data.length < 1000) break;
        }
        if (cancelled) return;

        const index = new Map();
        for (const r of rows) {
          if (!r.alias_norm || !r.school_id) continue;
          let set = index.get(r.alias_norm);
          if (!set) index.set(r.alias_norm, (set = new Set()));
          set.add(r.school_id);
        }
        setAliasIndex(index);
      } catch (err) {
        // Deliberately non-fatal. Search keeps working without aliases.
        console.error('school_aliases failed to load; search continues without them', err);
        loaded = false;   // allow a retry on the next mount
      }
    })();

    return () => { cancelled = true; };
  }, []);
}
