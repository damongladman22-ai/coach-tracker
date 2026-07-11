import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from './LoadingStates';

/**
 * Optimized school search component
 * 
 * Features:
 * - Client-side caching (loads all schools once)
 * - Debounced input (150ms delay)
 * - Fuzzy matching (handles typos)
 * - Mobile-optimized with large touch targets
 * - Optional gender scoping: pass programGender ('M'/'W') to restrict the
 *   pool to one side. Legacy null-program_gender rows count as women's ('W').
 *   Omit (or null) to search all active schools.
 */
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

  // Fuzzy match scoring
  const getMatchScore = useCallback((school, searchTerms) => {
    const name = school.school.toLowerCase();
    const nameNoSpaces = name.replace(/\s+/g, '');
    const city = (school.city || '').toLowerCase();
    const state = (school.state || '').toLowerCase();
    const conference = (school.conference || '').toLowerCase();
    
    let score = 0;
    
    for (const term of searchTerms) {
      const termNoSpaces = term.replace(/\s+/g, '');
      
      // Exact match in name gets highest score
      if (name === term) score += 100;
      // Starts with term
      else if (name.startsWith(term)) score += 50;
      // Word in name starts with term
      else if (name.split(' ').some(word => word.startsWith(term))) score += 30;
      // Contains term
      else if (name.includes(term)) score += 20;
      // Space-collapsed match (handles "LaSalle" or "lasalle" matching "La Salle")
      else if (nameNoSpaces.includes(termNoSpaces)) score += 18;
      // Space-collapsed starts with (handles "las" matching "lasalle" from "La Salle")  
      else if (nameNoSpaces.startsWith(termNoSpaces)) score += 16;
      // State match
      else if (state === term || state.startsWith(term)) score += 12;
      // City match
      else if (city.includes(term)) score += 10;
      // Conference match
      else if (conference.includes(term)) score += 5;
      // Fuzzy match (allows typos)
      else if (fuzzyMatch(name, term)) score += 8;
    }
    
    return score;
  }, []);

  // Simple fuzzy matching (allows 1-2 character differences)
  const fuzzyMatch = (str, term) => {
    if (term.length < 3) return false;
    
    // Check if most characters match
    let matches = 0;
    for (let i = 0; i < term.length; i++) {
      if (str.includes(term[i])) matches++;
    }
    return matches >= term.length * 0.7;
  };

  // Filter and sort schools based on query
  const filteredSchools = useMemo(() => {
    if (!debouncedQuery.trim()) return [];
    
    const searchTerms = debouncedQuery.toLowerCase().trim().split(/\s+/);
    
    // Handle common abbreviations
    const expandedTerms = searchTerms.map(term => {
      const abbrevs = {
        'osu': 'ohio state',
        'psu': 'penn state',
        'msu': 'michigan state',
        'usc': 'southern california',
        'ucla': 'ucla',
        'unc': 'north carolina',
        'ut': 'texas',
        'um': 'michigan',
        'iu': 'indiana',
      };
      return abbrevs[term] || term;
    });
    
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
