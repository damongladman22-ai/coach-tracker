import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { isValidEmail } from '../lib/validation';
import OPLogo from '../components/OPLogo';
import FeedbackButton from '../components/FeedbackButton';
import HamburgerMenu from '../components/HamburgerMenu';
import GenderBadge from '../components/GenderBadge';

// US States for filter dropdown
const US_STATES = [
  'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut',
  'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa',
  'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan',
  'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire',
  'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio',
  'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota',
  'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia',
  'Wisconsin', 'Wyoming', 'District of Columbia'
];

const DIVISIONS = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'Junior College'];

export default function CoachDirectory() {
  const [searchParams, setSearchParams] = useSearchParams();
  const isAdminContext = searchParams.get('context') === 'admin';
  const urlSchoolId = searchParams.get('school');
  const urlGender = searchParams.get('gender');
  
  const [coaches, setCoaches] = useState([]);
  const [schools, setSchools] = useState([]);
  const [conferences, setConferences] = useState([]);
  const [loading, setLoading] = useState(true);
  
  // Settings
  const [emailLinksEnabled, setEmailLinksEnabled] = useState(true);
  
  // Search/Filter state - separate input value from debounced value
  const [searchInput, setSearchInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [stateFilter, setStateFilter] = useState('');
  const [divisionFilter, setDivisionFilter] = useState('');
  const [conferenceFilter, setConferenceFilter] = useState('');
  const [showOnlyWithEmail, setShowOnlyWithEmail] = useState(false);
  const [showInactive, setShowInactive] = useState(false);
  const [showFilters, setShowFilters] = useState(false); // Mobile filter toggle
  const [togglingActive, setTogglingActive] = useState(null); // coach id whose active state is being toggled
  // School-id filter from URL. When set (e.g. /directory?school=123) the
  // directory locks to a single school's coaches and shows a dismissable
  // banner above results. Useful for deep-links from the team page's
  // recruiting hero panel pills. Cleared by tapping × on the banner or by
  // "Clear all filters", both of which also drop the URL param.
  const [schoolIdFilter, setSchoolIdFilter] = useState(urlSchoolId || '');

  // Gender filter: 'W' (women's) or 'M' (men's).
  // - URL ?gender=W|M (e.g. from team page deep-links): wins over both
  //   admin defaults and localStorage. Persists like a normal selection
  //   so the next visit reflects the override — see persistence rationale
  //   in the useEffect below.
  // - Admin context (no URL param): defaults to 'W'; admin toggles to 'M'
  //   when working on the other side.
  // - Parent/player context (no URL param): defaults to 'W' on first
  //   visit, but their last selection is persisted in localStorage so
  //   they only have to pick once. (A "Both" option was removed — a
  //   parent is either looking for boys' or girls' coaches; combining
  //   the two creates noise without value.)
  const [genderFilter, setGenderFilter] = useState(() => {
    if (urlGender === 'M' || urlGender === 'W') return urlGender;
    if (isAdminContext) return 'W';
    try {
      const stored = localStorage.getItem('coachDirectoryGenderFilter');
      if (stored === 'M' || stored === 'W') return stored;
    } catch (_e) {
      // localStorage unavailable — fall through to default
    }
    return 'W';
  });

  // Persist parent/player gender choice (admins don't need persistence — they
  // typically work in short focused sessions).
  useEffect(() => {
    if (isAdminContext) return;
    try {
      localStorage.setItem('coachDirectoryGenderFilter', genderFilter);
    } catch (_e) {
      // ignore
    }
  }, [genderFilter, isAdminContext]);
  
  // Debounce timer ref
  const searchTimerRef = useRef(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const pageSize = 50;

  // Edit/Add Coach state
  const [editingCoach, setEditingCoach] = useState(null);
  const [showAddCoach, setShowAddCoach] = useState(null); // schoolId when adding
  const [coachForm, setCoachForm] = useState({
    first_name: '',
    last_name: '',
    title: '',
    email: '',
    phone: ''
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(null); // coach id being deleted
  const [toast, setToast] = useState({ show: false, message: '', type: 'success' });

  // Debounce search input - prevents excessive filtering on each keystroke
  useEffect(() => {
    if (searchTimerRef.current) {
      clearTimeout(searchTimerRef.current);
    }
    
    searchTimerRef.current = setTimeout(() => {
      setSearchQuery(searchInput);
    }, 300);
    
    return () => {
      if (searchTimerRef.current) {
        clearTimeout(searchTimerRef.current);
      }
    };
  }, [searchInput]);

  // Load all data on mount
  useEffect(() => {
    async function loadData() {
      setLoading(true);
      
      try {
        // Load email setting
        const { data: settingData } = await supabase
          .from('app_settings')
          .select('value')
          .eq('key', 'directory_email_enabled')
          .single();
        
        if (settingData) {
          setEmailLinksEnabled(settingData.value === 'true');
        }

        // Fetch all coaches with school info (incl. program_gender on the school)
        let allCoaches = [];
        let from = 0;
        const batchSize = 1000;
        
        while (true) {
          const { data, error } = await supabase
            .from('coaches')
            .select(`
              id, first_name, last_name, email, phone, title, is_active,
              schools (id, school, city, state, division, conference, program_gender)
            `)
            .order('last_name')
            .range(from, from + batchSize - 1);
          
          if (error) {
            console.error('Error fetching coaches:', error);
            break;
          }
          
          if (!data || data.length === 0) break;
          allCoaches = [...allCoaches, ...data];
          
          if (data.length < batchSize) break;
          from += batchSize;
        }
        
        setCoaches(allCoaches);
        
        // Fetch all schools for reference (incl. program_gender)
        let allSchools = [];
        from = 0;
        
        while (true) {
          const { data, error } = await supabase
            .from('schools')
            .select('id, school, city, state, division, conference, program_gender')
            .order('school')
            .range(from, from + batchSize - 1);
          
          if (error) break;
          if (!data || data.length === 0) break;
          allSchools = [...allSchools, ...data];
          if (data.length < batchSize) break;
          from += batchSize;
        }
        
        setSchools(allSchools);
        
        // Extract unique conferences
        const uniqueConferences = [...new Set(allSchools.map(s => s.conference).filter(Boolean))].sort();
        setConferences(uniqueConferences);
        
      } catch (err) {
        console.error('Error loading data:', err);
      } finally {
        setLoading(false);
      }
    }
    
    loadData();
  }, []);

  // Space-tolerant matching for school names
  // Handles "LaSalle" or "lasalle" matching "La Salle"
  const matchesSearch = useCallback((text, searchTerm) => {
    if (!searchTerm) return true;
    const term = searchTerm.toLowerCase().trim();
    const str = text.toLowerCase();
    
    // Direct substring match
    if (str.includes(term)) return true;
    
    // Space-collapsed match
    const strNoSpaces = str.replace(/\s+/g, '');
    const termNoSpaces = term.replace(/\s+/g, '');
    if (strNoSpaces.includes(termNoSpaces)) return true;
    
    return false;
  }, []);

  // Filter coaches based on search and filters
  const filteredCoaches = useMemo(() => {
    return coaches.filter(coach => {
      const school = coach.schools;
      if (!school) return false;

      // School-id filter (URL deep-link). Most restrictive — applied first.
      if (schoolIdFilter && String(school.id) !== String(schoolIdFilter)) {
        return false;
      }

      // Gender filter — coach's school must match selected program_gender.
      // Treat null/undefined as 'W' (back-compat with pre-migration data).
      if ((school.program_gender || 'W') !== genderFilter) {
        return false;
      }
      
      // Search query (coach name or school name)
      if (searchQuery) {
        const coachName = `${coach.first_name} ${coach.last_name}`;
        const schoolName = school.school;
        
        if (!matchesSearch(coachName, searchQuery) && !matchesSearch(schoolName, searchQuery)) {
          return false;
        }
      }
      
      // State filter
      if (stateFilter && school.state !== stateFilter) {
        return false;
      }
      
      // Division filter
      if (divisionFilter && school.division !== divisionFilter) {
        return false;
      }
      
      // Conference filter
      if (conferenceFilter && school.conference !== conferenceFilter) {
        return false;
      }
      
      // Email filter
      if (showOnlyWithEmail && !coach.email) {
        return false;
      }

      // Active filter - hide inactive by default
      // Treat undefined/null is_active as active for back-compat (pre-migration coaches)
      const isActive = coach.is_active !== false;
      if (!showInactive && !isActive) {
        return false;
      }
      
      return true;
    });
  }, [coaches, searchQuery, stateFilter, divisionFilter, conferenceFilter, showOnlyWithEmail, showInactive, genderFilter, schoolIdFilter, matchesSearch]);

  // Group by school for display
  const groupedBySchool = useMemo(() => {
    const grouped = {};
    
    filteredCoaches.forEach(coach => {
      const schoolId = coach.schools?.id;
      if (!schoolId) return;
      
      if (!grouped[schoolId]) {
        grouped[schoolId] = {
          school: coach.schools,
          coaches: []
        };
      }
      grouped[schoolId].coaches.push(coach);
    });
    
    // Sort schools alphabetically
    return Object.values(grouped).sort((a, b) => 
      a.school.school.localeCompare(b.school.school)
    );
  }, [filteredCoaches]);

  // Paginated results
  const paginatedSchools = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return groupedBySchool.slice(start, start + pageSize);
  }, [groupedBySchool, currentPage, pageSize]);

  const totalPages = Math.ceil(groupedBySchool.length / pageSize);

  // Reset to page 1 when filters change
  useEffect(() => {
    setCurrentPage(1);
  }, [searchQuery, stateFilter, divisionFilter, conferenceFilter, showOnlyWithEmail, showInactive, genderFilter, schoolIdFilter]);

  // Stats
  const stats = useMemo(() => ({
    totalCoaches: filteredCoaches.length,
    totalSchools: groupedBySchool.length,
    withEmail: filteredCoaches.filter(c => c.email).length
  }), [filteredCoaches, groupedBySchool]);

  const clearFilters = () => {
    setSearchInput('');
    setSearchQuery('');
    setStateFilter('');
    setDivisionFilter('');
    setConferenceFilter('');
    setShowOnlyWithEmail(false);
    setShowInactive(false);
    setSchoolIdFilter('');
    // Strip the school URL param so reloads / back navigation don't bring
    // the lock back. Preserve other params (context, gender) since those
    // are session-state, not filters the user is clearing.
    if (searchParams.has('school')) {
      const next = new URLSearchParams(searchParams);
      next.delete('school');
      setSearchParams(next, { replace: true });
    }
  };

  // Clear just the school-id filter (× on the "Showing only" banner).
  // Other filters and search remain so the user can keep exploring within
  // the broader directory without losing context they set themselves.
  const clearSchoolFilter = () => {
    setSchoolIdFilter('');
    if (searchParams.has('school')) {
      const next = new URLSearchParams(searchParams);
      next.delete('school');
      setSearchParams(next, { replace: true });
    }
  };

  // Look up the school object pointed at by schoolIdFilter so the banner
  // can show its name. Schools may not have loaded yet on first render —
  // banner falls back to the raw id in that brief window.
  const lockedSchool = useMemo(() => {
    if (!schoolIdFilter) return null;
    return schools.find((s) => String(s.id) === String(schoolIdFilter)) || null;
  }, [schoolIdFilter, schools]);

  // Export filtered coaches to CSV
  const exportToCSV = () => {
    // Build CSV header
    const headers = ['School', 'City', 'State', 'Division', 'Conference', 'First Name', 'Last Name', 'Title', 'Email', 'Phone', 'Active'];
    
    // Build CSV rows from filtered coaches
    const rows = filteredCoaches.map(coach => {
      const school = coach.schools;
      return [
        school?.school || '',
        school?.city || '',
        school?.state || '',
        school?.division || '',
        school?.conference || '',
        coach.first_name || '',
        coach.last_name || '',
        coach.title || '',
        coach.email || '',
        coach.phone || '',
        coach.is_active === false ? 'No' : 'Yes'
      ];
    });
    
    // Sort by school name, then last name
    rows.sort((a, b) => {
      const schoolCompare = a[0].localeCompare(b[0]);
      if (schoolCompare !== 0) return schoolCompare;
      return a[6].localeCompare(b[6]); // Last name
    });
    
    // Convert to CSV string
    const escapeCSV = (value) => {
      if (value === null || value === undefined) return '';
      const str = String(value);
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    };
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(escapeCSV).join(','))
    ].join('\n');
    
    // Create and trigger download
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    
    // Generate filename with filter info
    let filename = 'coach-directory';
    if (divisionFilter) filename += `-${divisionFilter.replace(/\s+/g, '')}`;
    if (stateFilter) filename += `-${stateFilter.replace(/\s+/g, '')}`;
    if (conferenceFilter) filename += `-${conferenceFilter.replace(/\s+/g, '-').substring(0, 20)}`;
    filename += '.csv';
    
    link.setAttribute('download', filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    setToast({ show: true, message: `Exported ${filteredCoaches.length} coaches`, type: 'success' });
  };

  // Open edit modal for a coach
  const openEditCoach = (coach) => {
    setEditingCoach(coach);
    setCoachForm({
      first_name: coach.first_name || '',
      last_name: coach.last_name || '',
      title: coach.title || '',
      email: coach.email || '',
      phone: coach.phone || ''
    });
  };

  // Open add coach modal for a school
  const openAddCoach = (schoolId) => {
    setShowAddCoach(schoolId);
    setCoachForm({
      first_name: '',
      last_name: '',
      title: '',
      email: '',
      phone: ''
    });
  };

  // Close modals
  const closeModal = () => {
    setEditingCoach(null);
    setShowAddCoach(null);
    setCoachForm({
      first_name: '',
      last_name: '',
      title: '',
      email: '',
      phone: ''
    });
  };

  // Save coach (edit or add)
  const saveCoach = async () => {
    // Validation
    if (!coachForm.first_name.trim() || !coachForm.last_name.trim()) {
      setToast({ show: true, message: 'First and last name are required', type: 'error' });
      return;
    }

    // Validate email if provided
    if (coachForm.email.trim() && !isValidEmail(coachForm.email)) {
      setToast({ show: true, message: 'Please enter a valid email address', type: 'error' });
      return;
    }

    setSaving(true);

    try {
      if (editingCoach) {
        // Update existing coach
        const { error } = await supabase
          .from('coaches')
          .update({
            first_name: coachForm.first_name.trim(),
            last_name: coachForm.last_name.trim(),
            title: coachForm.title.trim() || null,
            email: coachForm.email.trim() || null,
            phone: coachForm.phone.trim() || null
          })
          .eq('id', editingCoach.id);

        if (error) throw error;

        // Update local state
        setCoaches(prev => prev.map(c => 
          c.id === editingCoach.id 
            ? { 
                ...c, 
                first_name: coachForm.first_name.trim(),
                last_name: coachForm.last_name.trim(),
                title: coachForm.title.trim() || null,
                email: coachForm.email.trim() || null,
                phone: coachForm.phone.trim() || null
              }
            : c
        ));

        setToast({ show: true, message: 'Coach updated!', type: 'success' });
      } else if (showAddCoach) {
        // Add new coach
        const { data, error } = await supabase
          .from('coaches')
          .insert({
            school_id: showAddCoach,
            first_name: coachForm.first_name.trim(),
            last_name: coachForm.last_name.trim(),
            title: coachForm.title.trim() || null,
            email: coachForm.email.trim() || null,
            phone: coachForm.phone.trim() || null
          })
          .select('*, schools(*)')
          .single();

        if (error) throw error;

        // Add to local state
        setCoaches(prev => [...prev, data]);

        setToast({ show: true, message: 'Coach added!', type: 'success' });
      }

      closeModal();
    } catch (err) {
      console.error('Error saving coach:', err);
      setToast({ show: true, message: 'Error saving: ' + err.message, type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const deleteCoach = async (coach) => {
    const confirmMessage = `Delete ${coach.first_name} ${coach.last_name}?\n\nThis will also remove any attendance records for this coach.\n\nTip: If this coach moved schools, click "Mark Inactive" instead — that preserves their attendance history.`;
    if (!confirm(confirmMessage)) return;

    setDeleting(coach.id);

    try {
      // Delete attendance records first (foreign key constraint)
      await supabase
        .from('attendance')
        .delete()
        .eq('coach_id', coach.id);

      // Delete the coach
      const { error } = await supabase
        .from('coaches')
        .delete()
        .eq('id', coach.id);

      if (error) throw error;

      // Update local state
      setCoaches(prev => prev.filter(c => c.id !== coach.id));
      setToast({ show: true, message: 'Coach deleted', type: 'success' });
    } catch (err) {
      console.error('Error deleting coach:', err);
      setToast({ show: true, message: 'Error deleting: ' + err.message, type: 'error' });
    } finally {
      setDeleting(null);
    }
  };

  // Toggle a coach's active status (anyone can do this in the directory)
  const toggleCoachActive = async (coach) => {
    const isCurrentlyActive = coach.is_active !== false;
    const nextActive = !isCurrentlyActive;

    if (isCurrentlyActive) {
      // Marking inactive - confirm so it's not an accident
      const ok = confirm(
        `Mark ${coach.first_name} ${coach.last_name} as no longer at ${coach.schools?.school || 'this school'}?\n\nTheir attendance history will be preserved. You can undo this later by viewing inactive coaches.`
      );
      if (!ok) return;
    }

    setTogglingActive(coach.id);

    try {
      const { error } = await supabase
        .from('coaches')
        .update({ is_active: nextActive })
        .eq('id', coach.id);

      if (error) throw error;

      // Update local state
      setCoaches(prev => prev.map(c =>
        c.id === coach.id ? { ...c, is_active: nextActive } : c
      ));

      setToast({
        show: true,
        message: nextActive
          ? `${coach.first_name} ${coach.last_name} marked active`
          : `${coach.first_name} ${coach.last_name} marked inactive (history preserved)`,
        type: 'success'
      });
    } catch (err) {
      console.error('Error toggling coach status:', err);
      setToast({ show: true, message: 'Error updating: ' + err.message, type: 'error' });
    } finally {
      setTogglingActive(null);
    }
  };

  // Auto-hide toast
  useEffect(() => {
    if (toast.show) {
      const timer = setTimeout(() => {
        setToast(t => ({ ...t, show: false }));
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toast.show]);

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50">
        {/* Header */}
        <header className="bg-[#0a1628] text-white">
          <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
            <Link to="/home" className="flex items-center gap-3">
              <OPLogo className="h-10 w-10" />
              <span className="text-xl font-bold">Coach Directory</span>
            </Link>
          </div>
          <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
        </header>
        
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#0a1628] text-white">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-center justify-between">
          <Link to={isAdminContext ? "/admin" : "/home"} className="flex items-center gap-3">
            <OPLogo className="h-10 w-10" />
            <span className="text-xl font-bold hidden sm:inline">Coach Directory</span>
            <span className="text-xl font-bold sm:hidden">Directory</span>
          </Link>
          <nav className="flex items-center gap-4">
            {isAdminContext ? (
              <>
                <Link to="/admin" className="text-sm text-gray-300 hover:text-white">
                  Dashboard
                </Link>
                <Link to="/help?context=admin" className="text-sm text-gray-300 hover:text-white">
                  Help
                </Link>
              </>
            ) : (
              <HamburgerMenu />
            )}
          </nav>
        </div>
        <div className="h-1 bg-gradient-to-r from-blue-500 via-cyan-400 to-blue-500"></div>
      </header>

      <div className="max-w-7xl mx-auto px-4 py-6">
        {/* School lock banner — shown when arrived via a deep link like
            /directory?school=123. Makes it obvious that results are
            scoped to one school, with a clear way out. */}
        {schoolIdFilter && (
          <div className="bg-cyan-50 border border-cyan-200 rounded-lg px-4 py-3 mb-4 flex items-center justify-between gap-3">
            <div className="min-w-0 flex-1 text-sm text-cyan-900">
              <span className="text-cyan-700">Showing only:</span>{' '}
              <span className="font-semibold">
                {lockedSchool?.school || `school #${schoolIdFilter}`}
              </span>
              {lockedSchool?.city && lockedSchool?.state && (
                <span className="text-cyan-700 ml-2">
                  · {lockedSchool.city}, {lockedSchool.state}
                </span>
              )}
            </div>
            <button
              type="button"
              onClick={clearSchoolFilter}
              aria-label="Clear school filter — show all coaches"
              className="flex-shrink-0 inline-flex items-center gap-1 text-sm text-cyan-700 hover:text-cyan-900 font-medium px-2 py-1 rounded hover:bg-cyan-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
                <path d="M18 6 6 18M6 6l12 12" />
              </svg>
              Show all
            </button>
          </div>
        )}

        {/* Search and Filters */}
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          {/* Gender pills */}
          <div className="flex items-center gap-2 text-sm mb-3 flex-wrap">
            <span className="text-gray-600 mr-1">Program:</span>
            {[
              { key: 'W', label: "Women's" },
              { key: 'M', label: "Men's" },
            ].map(opt => {
              const active = genderFilter === opt.key;
              return (
                <button
                  key={opt.key}
                  onClick={() => setGenderFilter(opt.key)}
                  className={`px-3 py-1.5 rounded-full border transition ${
                    active
                      ? 'bg-blue-600 text-white border-blue-600'
                      : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>

          {/* Search - always visible */}
          <div className="flex gap-2">
            <div className="flex-1">
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                placeholder="Search coach name or school..."
                className="w-full px-4 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-base"
              />
            </div>
            {/* Filter toggle button - mobile only */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className="md:hidden flex items-center gap-2 px-4 py-3 border rounded-lg bg-gray-50 hover:bg-gray-100"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
              </svg>
              {(stateFilter || divisionFilter || conferenceFilter || showOnlyWithEmail || showInactive) && (
                <span className="bg-blue-600 text-white text-xs w-5 h-5 rounded-full flex items-center justify-center">
                  {[stateFilter, divisionFilter, conferenceFilter, showOnlyWithEmail, showInactive].filter(Boolean).length}
                </span>
              )}
            </button>
          </div>
          
          {/* Filters - collapsible on mobile, always visible on desktop */}
          <div className={`${showFilters ? 'block' : 'hidden'} md:block mt-4`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
              {/* State Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  State
                </label>
                <select
                  value={stateFilter}
                  onChange={e => setStateFilter(e.target.value)}
                  className="w-full px-3 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                >
                  <option value="">All States</option>
                  {US_STATES.map(state => (
                    <option key={state} value={state}>{state}</option>
                  ))}
                </select>
              </div>
              
              {/* Division Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Division
                </label>
                <select
                  value={divisionFilter}
                  onChange={e => setDivisionFilter(e.target.value)}
                  className="w-full px-3 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                >
                  <option value="">All Divisions</option>
                  {DIVISIONS.map(div => (
                    <option key={div} value={div}>{div}</option>
                  ))}
                </select>
              </div>
              
              {/* Conference Filter */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Conference
                </label>
                <select
                  value={conferenceFilter}
                  onChange={e => setConferenceFilter(e.target.value)}
                  className="w-full px-3 py-3 border rounded-lg focus:ring-2 focus:ring-blue-500 text-base"
                >
                  <option value="">All Conferences</option>
                  {conferences.map(conf => (
                    <option key={conf} value={conf}>{conf}</option>
                  ))}
                </select>
              </div>
              
              {/* Email filter + Show Inactive + Clear */}
              <div className="flex flex-col justify-end gap-1">
                <label className="flex items-center gap-2 cursor-pointer py-2 min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={showOnlyWithEmail}
                    onChange={e => setShowOnlyWithEmail(e.target.checked)}
                    className="w-5 h-5 rounded text-blue-600"
                  />
                  <span className="text-sm text-gray-600">Only with email</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer py-2 min-h-[44px]">
                  <input
                    type="checkbox"
                    checked={showInactive}
                    onChange={e => setShowInactive(e.target.checked)}
                    className="w-5 h-5 rounded text-blue-600"
                  />
                  <span className="text-sm text-gray-600">Show inactive coaches</span>
                </label>
              </div>
            </div>
            
            {/* Clear filters */}
            {(searchInput || searchQuery || stateFilter || divisionFilter || conferenceFilter || showOnlyWithEmail || showInactive || schoolIdFilter) && (
              <div className="mt-4 pt-4 border-t">
                <button
                  onClick={clearFilters}
                  className="text-sm text-blue-600 hover:text-blue-800 py-2"
                >
                  Clear all filters
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Stats Bar */}
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex flex-wrap items-center gap-4 text-sm text-gray-600">
            <span>{stats.totalSchools} schools</span>
            <span>•</span>
            <span>{stats.totalCoaches} coaches</span>
            <span>•</span>
            <span>{stats.withEmail} with email</span>
          </div>
          
          {filteredCoaches.length > 0 && (
            <button
              onClick={exportToCSV}
              className="inline-flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 text-sm font-medium"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
              </svg>
              Export CSV
            </button>
          )}
        </div>

        {/* Results */}
        {paginatedSchools.length === 0 ? (
          <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
            {coaches.length === 0 ? (
              <>
                <p className="text-lg mb-2">No coaches in database yet</p>
                <p className="text-sm">Coaches will appear here once they're added to the system.</p>
              </>
            ) : (
              <>
                <p className="text-lg mb-2">No coaches match your filters</p>
                <button
                  onClick={clearFilters}
                  className="text-blue-600 hover:text-blue-800"
                >
                  Clear filters
                </button>
              </>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {paginatedSchools.map(({ school, coaches: schoolCoaches }) => (
              <div key={school.id} className="bg-white rounded-lg shadow overflow-hidden">
                {/* School Header */}
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 px-4 py-3 text-white">
                  <div className="flex justify-between items-start gap-2">
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-lg truncate flex items-center gap-2">
                        <span className="truncate">{school.school}</span>
                        <GenderBadge gender={school.program_gender} size="xs" />
                      </h3>
                      <p className="text-blue-100 text-sm truncate">
                        {school.city}, {school.state} • {school.division}
                      </p>
                      <p className="text-blue-200 text-xs truncate">{school.conference}</p>
                    </div>
                    <button
                      onClick={() => openAddCoach(school.id)}
                      className="text-sm bg-white/20 hover:bg-white/30 px-3 py-2 rounded-lg flex items-center gap-1 flex-shrink-0"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                      </svg>
                      <span className="hidden sm:inline">Add Coach</span>
                      <span className="sm:hidden">Add</span>
                    </button>
                  </div>
                </div>
                
                {/* Coaches List */}
                <div className="divide-y divide-gray-100">
                  {schoolCoaches.map(coach => {
                    const isActive = coach.is_active !== false;
                    return (
                    <div
                      key={coach.id}
                      className={`px-4 py-3 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 ${!isActive ? 'bg-gray-50' : ''}`}
                    >
                      <div className="flex-grow">
                        <span className={`font-medium ${!isActive ? 'text-gray-500 line-through decoration-gray-400' : ''}`}>
                          {coach.first_name} {coach.last_name}
                        </span>
                        {coach.title && (
                          <span className={`text-sm ml-2 ${!isActive ? 'text-gray-400' : 'text-gray-500'}`}>
                            ({coach.title})
                          </span>
                        )}
                        {!isActive && (
                          <span className="ml-2 inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-700">
                            Inactive
                          </span>
                        )}
                      </div>
                      
                      <div className="flex flex-wrap items-center gap-3 text-sm">
                        {coach.email && (
                          emailLinksEnabled ? (
                            <a
                              href={`mailto:${coach.email}`}
                              className={`inline-flex items-center gap-1 ${isActive ? 'text-blue-600 hover:text-blue-800' : 'text-gray-400 hover:text-gray-600'}`}
                            >
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <span className="hidden sm:inline">{coach.email}</span>
                              <span className="sm:hidden">Email</span>
                            </a>
                          ) : (
                            <span className={`inline-flex items-center gap-1 ${isActive ? 'text-gray-600' : 'text-gray-400'}`}>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                              </svg>
                              <span className="hidden sm:inline">{coach.email}</span>
                              <span className="sm:hidden">Email</span>
                            </span>
                          )
                        )}
                        {coach.phone && (
                          <a
                            href={`tel:${coach.phone}`}
                            className={`inline-flex items-center gap-1 ${isActive ? 'text-gray-600 hover:text-gray-800' : 'text-gray-400 hover:text-gray-500'}`}
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 5a2 2 0 012-2h3.28a1 1 0 01.948.684l1.498 4.493a1 1 0 01-.502 1.21l-2.257 1.13a11.042 11.042 0 005.516 5.516l1.13-2.257a1 1 0 011.21-.502l4.493 1.498a1 1 0 01.684.949V19a2 2 0 01-2 2h-1C9.716 21 3 14.284 3 6V5z" />
                            </svg>
                            <span className="hidden sm:inline">{coach.phone}</span>
                            <span className="sm:hidden">Call</span>
                          </a>
                        )}
                        {!coach.email && !coach.phone && (
                          <span className="text-gray-400 text-sm">No contact info</span>
                        )}
                        <button
                          onClick={() => openEditCoach(coach)}
                          className="inline-flex items-center gap-1 text-gray-400 hover:text-blue-600 p-2 -m-1 rounded-lg hover:bg-blue-50"
                          title="Update contact info"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                          <span className="text-xs">Edit</span>
                        </button>
                        <button
                          onClick={() => toggleCoachActive(coach)}
                          disabled={togglingActive === coach.id}
                          className={`inline-flex items-center gap-1 p-2 -m-1 rounded-lg ${
                            isActive
                              ? 'text-gray-400 hover:text-amber-600 hover:bg-amber-50'
                              : 'text-gray-400 hover:text-green-600 hover:bg-green-50'
                          }`}
                          title={isActive ? 'Mark coach as no longer at this school (preserves history)' : 'Mark coach as active again'}
                        >
                          {togglingActive === coach.id ? (
                            <span className="text-xs">...</span>
                          ) : isActive ? (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 8h14M5 8a2 2 0 110-4h14a2 2 0 110 4M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8m-9 4h4" />
                              </svg>
                              <span className="text-xs">Mark Inactive</span>
                            </>
                          ) : (
                            <>
                              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                              </svg>
                              <span className="text-xs">Mark Active</span>
                            </>
                          )}
                        </button>
                        {isAdminContext && (
                          <button
                            onClick={() => deleteCoach(coach)}
                            disabled={deleting === coach.id}
                            className="inline-flex items-center gap-1 text-gray-400 hover:text-red-600 p-2 -m-1 rounded-lg hover:bg-red-50"
                            title="Delete coach (use Mark Inactive if they moved schools)"
                          >
                            {deleting === coach.id ? (
                              <span className="text-xs">...</span>
                            ) : (
                              <>
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                </svg>
                                <span className="text-xs">Delete</span>
                              </>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="mt-6 flex justify-center items-center gap-2">
            <button
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="px-3 py-2 bg-white border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Previous
            </button>
            
            <span className="px-4 py-2 text-sm text-gray-600">
              Page {currentPage} of {totalPages}
            </span>
            
            <button
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
              className="px-3 py-2 bg-white border rounded-lg disabled:opacity-50 disabled:cursor-not-allowed hover:bg-gray-50"
            >
              Next
            </button>
          </div>
        )}
      </div>

      {/* Edit/Add Coach Modal */}
      {(editingCoach || showAddCoach) && (
        <div 
          className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coach-modal-title"
        >
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full max-h-[90vh] overflow-y-auto">
            <div className="p-4 border-b">
              <h2 id="coach-modal-title" className="text-lg font-semibold">
                {editingCoach ? 'Update Coach Info' : 'Add New Coach'}
              </h2>
              <p className="text-sm text-gray-500">
                {editingCoach 
                  ? editingCoach.schools?.school
                  : schools.find(s => s.id === showAddCoach)?.school
                }
              </p>
            </div>
            
            <form className="p-4 space-y-4" onSubmit={e => { e.preventDefault(); saveCoach(); }}>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="coach-first-name" className="block text-sm font-medium text-gray-700 mb-1">
                    First Name *
                  </label>
                  <input
                    id="coach-first-name"
                    type="text"
                    value={coachForm.first_name}
                    onChange={e => setCoachForm({ ...coachForm, first_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="John"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="coach-last-name" className="block text-sm font-medium text-gray-700 mb-1">
                    Last Name *
                  </label>
                  <input
                    id="coach-last-name"
                    type="text"
                    value={coachForm.last_name}
                    onChange={e => setCoachForm({ ...coachForm, last_name: e.target.value })}
                    className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                    placeholder="Smith"
                    required
                  />
                </div>
              </div>
              
              <div>
                <label htmlFor="coach-title" className="block text-sm font-medium text-gray-700 mb-1">
                  Title
                </label>
                <input
                  id="coach-title"
                  type="text"
                  value={coachForm.title}
                  onChange={e => setCoachForm({ ...coachForm, title: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="Head Coach, Assistant Coach, etc."
                />
              </div>
              
              <div>
                <label htmlFor="coach-email" className="block text-sm font-medium text-gray-700 mb-1">
                  Email
                </label>
                <input
                  id="coach-email"
                  type="email"
                  value={coachForm.email}
                  onChange={e => setCoachForm({ ...coachForm, email: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="coach@university.edu"
                />
              </div>
              
              <div>
                <label htmlFor="coach-phone" className="block text-sm font-medium text-gray-700 mb-1">
                  Phone
                </label>
                <input
                  id="coach-phone"
                  type="tel"
                  value={coachForm.phone}
                  onChange={e => setCoachForm({ ...coachForm, phone: e.target.value })}
                  className="w-full px-3 py-2 border rounded-lg focus:ring-2 focus:ring-blue-500"
                  placeholder="(555) 123-4567"
                />
              </div>

              <p className="text-xs text-gray-500">
                Help build our coach directory! Add or update contact info to help families connect with coaches.
              </p>
            </form>
            
            <div className="p-4 border-t flex gap-3">
              <button
                onClick={closeModal}
                type="button"
                className="flex-1 px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={saveCoach}
                disabled={saving}
                type="button"
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-blue-400"
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast.show && (
        <div className={`fixed bottom-4 right-4 px-4 py-3 rounded-lg shadow-lg z-50 ${
          toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-green-600 text-white'
        }`}>
          {toast.message}
        </div>
      )}

      {/* Feedback Button */}
      <FeedbackButton />
    </div>
  );
}
