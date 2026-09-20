import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from './LoadingStates';
import { expandTerms, scoreSchool } from '../lib/schoolMatch';

export function SchoolSearch({ selectedSchool, onSelect, programGender = null }) {
  const [query, setQuery] = useState('');
  const [schools, setSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const inputRef = useRef(null);

  // Load all schools when the gender scope resolves (client-side caching).
  // Filters out inactive schools — this component is the picker for
  // live coach attendance entry (admin Attendance Matrix and similar
  // flows), where you wouldn't be tagging coaches against a defunct
  // women's soccer program. The admin Schools page has its own list
  // for managing inactive status; this picker is for active use only.
  // When programGender is 'M'/'W', the pool is scoped to that side (legacy
  // null-program_gender rows are the original women's-only seed, so they
  // count as 'W'); when null, all active schools load. Re-runs if the scope
  // changes (the caller's team gender may resolve after first render).
  useEffect(() => {
    let cancelled = false;

    async function loadSchools() {
      setLoading(true);
      try {
        // Fetch all schools in batches (Supabase default max is 1000)
        let allSchools = [];
        let from = 0;
        const batchSize = 1000;
        
        while (true) {
          let query = supabase
            .from('schools')
            .select('id, school, city, state, division, conference')
            .neq('is_active', false);

          if (programGender === 'W') {
            query = query.or('program_gender.eq.W,program_gender.is.null');
          } else if (programGender === 'M') {
            query = query.eq('program_gender', 'M');
          }

          const { data, error } = await query
            .order('school')
            .range(from, from + batchSize - 1);
          
          if (error) throw error;
          if (!data || data.length === 0) break;
          
          allSchools = [...allSchools, ...data];
          
          if (data.length < batchSize) break;
          from += batchSize;
        }
        
        if (!cancelled) setSchools(allSchools);
      } catch (err) {
        console.error('Error loading schools:', err);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadSchools();
    return () => { cancelled = true; };
  }, [programGender]);

  // Debounce the search query
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedQuery(query);
    }, 150);

    return () => clearTimeout(timer);
  }, [query]);

  // Scoring lives in src/lib/schoolMatch.js so every search surface shares it.
  // This picker searches name, city, state and conference — the module's
  // default field set — because it is an admin lookup where a conference or
  // state hit is a useful way in.
  const getMatchScore = useCallback((school, terms) => scoreSchool(school, terms), []);

  // Filter and sort schools based on query
  const filteredSchools = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    
    // One-to-many: "osu" now expands to Ohio State, Oregon State AND Oklahoma
    // State rather than silently picking one. See ABBREVIATIONS in schoolMatch.
    const expandedTerms = expandTerms(debouncedQuery);
    
    return schools
      .map(school => ({
        ...school,
        score: getMatchScore(school, expandedTerms)
      }))
      .filter(school => school.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Limit to top 20 results
  }, [schools, debouncedQuery, getMatchScore]);

  // Handle school selection
  const handleSelect = (school) => {
    onSelect(school);
    setQuery('');
  };

  // Clear selection
  const handleClear = () => {
    onSelect(null);
    setQuery('');
    setTimeout(() => inputRef.current?.focus(), 0);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-4">
        <Spinner size="sm" />
        <span className="ml-2 text-gray-500">Loading schools...</span>
      </div>
    );
  }

  // If a school is selected, show it as a pill
  if (selectedSchool) {
    return (
      <div className="flex items-center gap-2 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <div className="flex-1">
          <div className="font-medium text-blue-900">{selectedSchool.school}</div>
          <div className="text-sm text-blue-700">
            {selectedSchool.city}, {selectedSchool.state} • {selectedSchool.division}
          </div>
        </div>
        <button
          onClick={handleClear}
          className="p-2 hover:bg-blue-100 rounded-full"
          aria-label="Clear selection"
        >
          <svg className="h-5 w-5 text-blue-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative">
        <input
          ref={inputRef}
          type="text"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
          }}
          placeholder="Search for a college (e.g., Ohio State, OSU)"
          className="w-full px-4 py-3 text-base border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent pr-10"
          autoComplete="off"
        />
        
        {/* Search icon */}
        <div className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 pointer-events-none">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>
      </div>

      {/* Results list (inline, not dropdown) */}
      {debouncedQuery.trim() && (
        <div className="mt-1 border border-gray-200 rounded-lg overflow-hidden">
          {filteredSchools.length === 0 ? (
            <div className="p-4 text-gray-500 text-center">
              No schools found for "{debouncedQuery}"
            </div>
          ) : (
            filteredSchools.map(school => (
              <button
                key={school.id}
                onClick={() => handleSelect(school)}
                className="w-full text-left px-4 py-4 hover:bg-gray-50 active:bg-gray-100 border-b last:border-b-0 focus:bg-gray-50 focus:outline-none"
              >
                <div className="font-medium text-gray-900">{school.school}</div>
                <div className="text-sm text-gray-500">
                  {school.city}, {school.state} • {school.division} • {school.conference}
                </div>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default SchoolSearch;
