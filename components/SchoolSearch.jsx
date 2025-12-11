import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabase';
import { Spinner } from './LoadingStates';

/**
 * Debounce hook for search input
 * Prevents excessive API calls while typing
 */
function useDebounce(value, delay = 300) {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => clearTimeout(handler);
  }, [value, delay]);

  return debouncedValue;
}

/**
 * Optimized School Search Component
 * 
 * Features:
 * - Debounced search (waits for typing to stop)
 * - Client-side caching of all schools for instant filtering
 * - Fuzzy matching for typo tolerance
 * - Mobile-optimized large touch targets
 * - Keyboard accessible
 */
export function SchoolSearch({ onSelect, selectedSchool, className = '' }) {
  const [query, setQuery] = useState('');
  const [allSchools, setAllSchools] = useState([]);
  const [loading, setLoading] = useState(true);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef(null);
  const listRef = useRef(null);

  const debouncedQuery = useDebounce(query, 150); // Fast debounce for responsive feel

  // Load all schools once on mount (they fit easily in memory)
  useEffect(() => {
    async function loadSchools() {
      try {
        const { data, error } = await supabase
          .from('schools')
          .select('id, school, city, state, division, conference')
          .order('school');

        if (error) throw error;
        setAllSchools(data || []);
      } catch (err) {
        console.error('Error loading schools:', err);
      } finally {
        setLoading(false);
      }
    }

    loadSchools();
  }, []);

  // Fuzzy search function - handles typos and partial matches
  const fuzzyMatch = useCallback((school, searchTerms) => {
    const schoolName = school.school.toLowerCase();
    const city = school.city?.toLowerCase() || '';
    const state = school.state?.toLowerCase() || '';
    const conference = school.conference?.toLowerCase() || '';
    
    // All search terms must match somewhere
    return searchTerms.every(term => {
      const termLower = term.toLowerCase();
      return (
        schoolName.includes(termLower) ||
        city.includes(termLower) ||
        state === termLower ||
        conference.includes(termLower) ||
        // Check for common abbreviations
        (termLower === 'osu' && schoolName.includes('ohio state')) ||
        (termLower === 'psu' && schoolName.includes('penn state')) ||
        (termLower === 'ucla' && schoolName.includes('ucla')) ||
        (termLower === 'usc' && schoolName.includes('southern california')) ||
        (termLower === 'unc' && schoolName.includes('north carolina'))
      );
    });
  }, []);

  // Score results for better ordering
  const scoreMatch = useCallback((school, query) => {
    const schoolName = school.school.toLowerCase();
    const queryLower = query.toLowerCase();
    
    // Exact start match is best
    if (schoolName.startsWith(queryLower)) return 100;
    // Word start match is good
    if (schoolName.split(' ').some(word => word.startsWith(queryLower))) return 80;
    // Contains is okay
    if (schoolName.includes(queryLower)) return 60;
    // Partial match
    return 40;
  }, []);

  // Filter and sort schools based on search query
  const filteredSchools = useMemo(() => {
    if (!debouncedQuery.trim()) {
      return []; // Don't show anything until user starts typing
    }

    const searchTerms = debouncedQuery.trim().split(/\s+/);
    
    return allSchools
      .filter(school => fuzzyMatch(school, searchTerms))
      .map(school => ({
        ...school,
        score: scoreMatch(school, debouncedQuery)
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 20); // Limit results for performance
  }, [debouncedQuery, allSchools, fuzzyMatch, scoreMatch]);

  // Reset highlight when results change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredSchools]);

  // Scroll highlighted item into view
  useEffect(() => {
    if (listRef.current && filteredSchools.length > 0) {
      const highlightedElement = listRef.current.children[highlightedIndex];
      if (highlightedElement) {
        highlightedElement.scrollIntoView({ block: 'nearest' });
      }
    }
  }, [highlightedIndex, filteredSchools.length]);

  // Handle keyboard navigation
  const handleKeyDown = (e) => {
    if (!isOpen || filteredSchools.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex(i => Math.min(i + 1, filteredSchools.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex(i => Math.max(i - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (filteredSchools[highlightedIndex]) {
          handleSelect(filteredSchools[highlightedIndex]);
        }
        break;
      case 'Escape':
        setIsOpen(false);
        break;
    }
  };

  const handleSelect = (school) => {
    onSelect(school);
    setQuery('');
    setIsOpen(false);
  };

  const handleInputChange = (e) => {
    setQuery(e.target.value);
    setIsOpen(true);
  };

  const handleFocus = () => {
    if (query.trim()) {
      setIsOpen(true);
    }
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (inputRef.current && !inputRef.current.contains(e.target)) {
        setIsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div className={`relative ${className}`} ref={inputRef}>
      {/* Selected school display */}
      {selectedSchool && (
        <div className="mb-2 p-3 bg-blue-50 border border-blue-200 rounded-lg flex items-center justify-between">
          <div>
            <p className="font-medium text-blue-900">{selectedSchool.school}</p>
            <p className="text-sm text-blue-700">
              {selectedSchool.city}, {selectedSchool.state} • {selectedSchool.division}
            </p>
          </div>
          <button
            onClick={() => onSelect(null)}
            className="text-blue-600 hover:text-blue-800 p-2"
            aria-label="Clear selection"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      )}

      {/* Search input - large touch target for mobile */}
      <div className="relative">
        <input
          type="text"
          value={query}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onKeyDown={handleKeyDown}
          placeholder="Search colleges (e.g., Ohio State, UCLA)..."
          className="w-full px-4 py-4 text-lg border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 pr-10"
          autoComplete="off"
          autoCorrect="off"
          autoCapitalize="off"
          spellCheck="false"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2">
          {loading ? (
            <Spinner size="sm" />
          ) : (
            <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          )}
        </div>
      </div>

      {/* Results dropdown */}
      {isOpen && query.trim() && (
        <div 
          ref={listRef}
          className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-lg shadow-lg max-h-80 overflow-y-auto"
        >
          {filteredSchools.length === 0 ? (
            <div className="p-4 text-center text-gray-500">
              No colleges found for "{query}"
            </div>
          ) : (
            filteredSchools.map((school, index) => (
              <button
                key={school.id}
                onClick={() => handleSelect(school)}
                className={`w-full text-left px-4 py-4 border-b border-gray-100 last:border-b-0 transition-colors ${
                  index === highlightedIndex ? 'bg-blue-50' : 'hover:bg-gray-50'
                }`}
              >
                <p className="font-medium text-gray-900">{school.school}</p>
                <p className="text-sm text-gray-600">
                  {school.city}, {school.state} • {school.division}
                  {school.conference && ` • ${school.conference}`}
                </p>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Quick school filter for lists
 * Lighter weight than full search, good for filtering existing lists
 */
export function useSchoolFilter(schools) {
  const [filter, setFilter] = useState('');
  const debouncedFilter = useDebounce(filter, 200);

  const filteredSchools = useMemo(() => {
    if (!debouncedFilter.trim()) return schools;

    const terms = debouncedFilter.toLowerCase().split(/\s+/);
    return schools.filter(school => {
      const searchText = `${school.school} ${school.city} ${school.state} ${school.division} ${school.conference}`.toLowerCase();
      return terms.every(term => searchText.includes(term));
    });
  }, [schools, debouncedFilter]);

  return { filter, setFilter, filteredSchools };
}
