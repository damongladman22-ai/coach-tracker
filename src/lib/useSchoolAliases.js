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
import { fetchAllRows } from './fetchAllRows';

// WHEN IT LOADS (performance pass, 2026-10-09; Damon: load the short-names
// list only when someone searches, and remember it for the visit). The list
// is about 5,000 rows and used to download on every page, competing with the
// page's own data even where nobody searches. Now:
//   - it loads the first time any text box, search box, select or file input
//     gets focus (every search box, and the admin coach import, start that
//     way), so the matcher has it before the first keystroke lands;
//   - its pages are fetched in parallel;
//   - it is kept in sessionStorage for the rest of the visit, so other pages
//     and reloads use it without downloading it again.
// Still one call at app level, so every search box gets aliases.
const CACHE_KEY = 'pitchside.schoolAliases.v1';
let loaded = false;
let loading = null;

function buildIndex(rows) {
  // rows: [school_id, alias_norm, kind, school name]
  const index = new Map();
  const common = new Map();   // kind 'common_name': Mizzou, Pitt, Cal (F15)
  const names = new Map();    // school_id -> name, for callers without ids
  const add = (map, key, id) => {
    let set = map.get(key);
    if (!set) map.set(key, (set = new Set()));
    set.add(id);
  };
  for (const [id, alias, kind, name] of rows) {
    if (!alias || !id) continue;
    add(index, alias, id);
    if (kind === 'common_name') add(common, alias, id);
    if (name) names.set(id, name);
  }
  setAliasIndex(index, { common, names });
}

/** Load the alias list now (once per visit). Safe to call any number of times. */
export function ensureSchoolAliases() {
  if (loaded) return Promise.resolve();
  if (loading) return loading;
  loading = (async () => {
    try {
      try {
        const cached = sessionStorage.getItem(CACHE_KEY);
        if (cached) {
          buildIndex(JSON.parse(cached));
          loaded = true;
          return;
        }
      } catch { /* no or unreadable cache: fetch */ }
      const data = await fetchAllRows(supabase, 'school_aliases',
        'id, school_id, alias_norm, kind, schools(school)', q => q.order('id'));
      const rows = data.map(r => [r.school_id, r.alias_norm, r.kind, r.schools?.school || null]);
      buildIndex(rows);
      loaded = true;
      try { sessionStorage.setItem(CACHE_KEY, JSON.stringify(rows)); } catch { /* full or blocked: fine */ }
    } catch (err) {
      // Deliberately non-fatal. Search keeps working without aliases.
      console.error('school_aliases failed to load; search continues without them', err);
    } finally {
      loading = null;
    }
  })();
  return loading;
}

const WANTS_ALIASES = 'input, textarea, select';

export function useSchoolAliases() {
  useEffect(() => {
    if (loaded) return;
    const onFocus = e => {
      if (e.target?.matches?.(WANTS_ALIASES)) {
        document.removeEventListener('focusin', onFocus, true);
        ensureSchoolAliases();
      }
    };
    // Already cached this visit: build the index straight away (no network).
    try {
      if (sessionStorage.getItem(CACHE_KEY)) { ensureSchoolAliases(); return; }
    } catch { /* fall through to waiting for a focus */ }
    document.addEventListener('focusin', onFocus, true);
    return () => document.removeEventListener('focusin', onFocus, true);
  }, []);
}
