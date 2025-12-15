import { useState, useEffect, useCallback, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/AdminLayout';
import * as XLSX from 'xlsx';

/**
 * Bulk Coach Import Page
 * 
 * Supports Excel (.xlsx, .xls) and CSV files
 * Auto-detects columns and fuzzy-matches school names
 * 
 * Performance optimized with pagination for large imports
 */

const ROWS_PER_PAGE = 50;

export default function ImportCoaches({ session }) {
  const navigate = useNavigate();
  
  // Schools from database
  const [schools, setSchools] = useState([]);
  const [schoolsLoading, setSchoolsLoading] = useState(true);
  
  // File parsing state
  const [file, setFile] = useState(null);
  const [parsedData, setParsedData] = useState(null);
  const [columns, setColumns] = useState([]);
  
  // Column mapping
  const [schoolColumn, setSchoolColumn] = useState('');
  const [firstNameColumn, setFirstNameColumn] = useState('');
  const [lastNameColumn, setLastNameColumn] = useState('');
  const [fullNameColumn, setFullNameColumn] = useState('');
  const [useFullName, setUseFullName] = useState(false);
  
  // New contact info columns
  const [emailColumn, setEmailColumn] = useState('');
  const [phoneColumn, setPhoneColumn] = useState('');
  const [titleColumn, setTitleColumn] = useState('');
  
  // Preview state
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);
  
  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  
  // Filter state for preview
  const [showOnlyUnmatched, setShowOnlyUnmatched] = useState(false);

  // Load schools on mount
  useEffect(() => {
    async function loadSchools() {
      // Fetch all schools in batches (Supabase default max is 1000)
      let allSchools = [];
      let from = 0;
      const batchSize = 1000;
      
      while (true) {
        const { data, error } = await supabase
          .from('schools')
          .select('id, school, city, state, division')
          .order('school')
          .range(from, from + batchSize - 1);
        
        if (error) {
          console.error('Error fetching schools:', error);
          break;
        }
        
        if (!data || data.length === 0) break;
        
        allSchools = [...allSchools, ...data];
        
        if (data.length < batchSize) break; // Last batch
        from += batchSize;
      }
      
      setSchools(allSchools);
      console.log('Loaded schools:', allSchools.length);
      setSchoolsLoading(false);
    }
    loadSchools();
  }, []);

  // Fuzzy match school name to database
  const findSchoolMatch = useCallback((searchName) => {
    if (!searchName || typeof searchName !== 'string') return null;
    
    const searchLower = searchName.toLowerCase().trim();
    
    // Common aliases
    const aliases = {
      'mizzou': 'university of missouri',
      'pitt': 'university of pittsburgh',
      'penn state': 'pennsylvania state university',
      'osu': 'ohio state university',
      'usc': 'university of southern california',
      'ucla': 'university of california, los angeles',
      'unc': 'university of north carolina',
      'lsu': 'louisiana state university',
      'ole miss': 'university of mississippi',
      'umass': 'university of massachusetts',
    };
    
    const searchTerm = aliases[searchLower] || searchLower;
    
    // Try exact match first
    let match = schools.find(s => s.school.toLowerCase() === searchTerm);
    if (match) return { school: match, confidence: 'exact' };
    
    // Try contains match
    match = schools.find(s => 
      s.school.toLowerCase().includes(searchTerm) || 
      searchTerm.includes(s.school.toLowerCase())
    );
    if (match) return { school: match, confidence: 'high' };
    
    // Try word matching
    const searchWords = searchTerm
      .replace(/university|college|of|the|-|–/gi, ' ')
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    for (const school of schools) {
      const schoolLower = school.school.toLowerCase();
      const matchCount = searchWords.filter(word => schoolLower.includes(word)).length;
      if (matchCount >= Math.max(1, searchWords.length - 1)) {
        return { school, confidence: 'medium' };
      }
    }
    
    // Try fuzzy partial match
    for (const school of schools) {
      const schoolLower = school.school.toLowerCase();
      for (const word of searchWords) {
        if (word.length > 3 && schoolLower.includes(word)) {
          return { school, confidence: 'low' };
        }
      }
    }
    
    return null;
  }, [schools]);

  // Parse uploaded file
  const handleFileUpload = async (e) => {
    const uploadedFile = e.target.files[0];
    if (!uploadedFile) return;
    
    setFile(uploadedFile);
    setParsedData(null);
    setPreview(null);
    setImportResult(null);
    setCurrentPage(1);
    
    try {
      const data = await uploadedFile.arrayBuffer();
      const workbook = XLSX.read(data);
      const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
      const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });
      
      if (jsonData.length < 2) {
        alert('File appears to be empty or has no data rows');
        return;
      }
      
      // First row is headers
      const headers = jsonData[0].map(h => String(h || '').trim());
      const rows = jsonData.slice(1).filter(row => row.some(cell => cell));
      
      setColumns(headers);
      setParsedData(rows);
      
      // Auto-detect columns
      const lowerHeaders = headers.map(h => h.toLowerCase());
      
      // School column
      const schoolIdx = lowerHeaders.findIndex(h => 
        h.includes('school') || h.includes('college') || h.includes('university')
      );
      if (schoolIdx >= 0) setSchoolColumn(headers[schoolIdx]);
      
      // Name columns
      const firstIdx = lowerHeaders.findIndex(h => 
        h.includes('first') && h.includes('name')
      );
      const lastIdx = lowerHeaders.findIndex(h => 
        h.includes('last') && h.includes('name')
      );
      const fullIdx = lowerHeaders.findIndex(h => 
        (h.includes('coach') || h.includes('name')) && !h.includes('first') && !h.includes('last')
      );
      
      if (firstIdx >= 0) setFirstNameColumn(headers[firstIdx]);
      if (lastIdx >= 0) setLastNameColumn(headers[lastIdx]);
      if (fullIdx >= 0) setFullNameColumn(headers[fullIdx]);
      
      // Email column
      const emailIdx = lowerHeaders.findIndex(h => 
        h.includes('email') || h.includes('e-mail')
      );
      if (emailIdx >= 0) setEmailColumn(headers[emailIdx]);
      
      // Phone column
      const phoneIdx = lowerHeaders.findIndex(h => 
        h.includes('phone') || h.includes('tel') || h.includes('mobile')
      );
      if (phoneIdx >= 0) setPhoneColumn(headers[phoneIdx]);
      
      // Title column
      const titleIdx = lowerHeaders.findIndex(h => 
        h.includes('title') || h.includes('position') || h.includes('role')
      );
      if (titleIdx >= 0) setTitleColumn(headers[titleIdx]);
      
      // Decide which name mode to use
      if (firstIdx >= 0 && lastIdx >= 0) {
        setUseFullName(false);
      } else if (fullIdx >= 0) {
        setUseFullName(true);
      }
      
    } catch (err) {
      console.error('Error parsing file:', err);
      alert('Error parsing file. Please ensure it is a valid Excel or CSV file.');
    }
  };

  // Parse full name into first and last
  const parseFullName = (fullName) => {
    if (!fullName || typeof fullName !== 'string') return { first: '', last: '' };
    const parts = fullName.trim().split(/\s+/);
    if (parts.length === 0) return { first: '', last: '' };
    if (parts.length === 1) return { first: parts[0], last: '' };
    return { first: parts[0], last: parts.slice(1).join(' ') };
  };

  // Generate preview
  const handleGeneratePreview = () => {
    if (!parsedData || !schoolColumn) {
      alert('Please select at least a school column');
      return;
    }
    
    if (!useFullName && (!firstNameColumn || !lastNameColumn)) {
      alert('Please select first name and last name columns, or switch to full name mode');
      return;
    }
    
    if (useFullName && !fullNameColumn) {
      alert('Please select a full name column');
      return;
    }
    
    const colIndex = (colName) => columns.indexOf(colName);
    
    const previewData = [];
    const seenCoaches = new Set();
    
    for (const row of parsedData) {
      const schoolName = row[colIndex(schoolColumn)];
      if (!schoolName) continue;
      
      let firstName, lastName;
      
      if (useFullName) {
        const fullName = row[colIndex(fullNameColumn)];
        if (!fullName) continue;
        const parsed = parseFullName(fullName);
        firstName = parsed.first;
        lastName = parsed.last;
      } else {
        firstName = row[colIndex(firstNameColumn)] || '';
        lastName = row[colIndex(lastNameColumn)] || '';
      }
      
      if (!firstName && !lastName) continue;
      
      // Get optional contact info
      const email = emailColumn ? String(row[colIndex(emailColumn)] || '').trim() : '';
      const phone = phoneColumn ? String(row[colIndex(phoneColumn)] || '').trim() : '';
      const title = titleColumn ? String(row[colIndex(titleColumn)] || '').trim() : '';
      
      // Skip duplicates in file
      const key = `${schoolName}|${firstName}|${lastName}`.toLowerCase();
      if (seenCoaches.has(key)) continue;
      seenCoaches.add(key);
      
      const match = findSchoolMatch(schoolName);
      
      previewData.push({
        id: previewData.length, // Add stable ID for updates
        originalSchool: schoolName,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        email,
        phone,
        title,
        matchedSchool: match?.school || null,
        confidence: match?.confidence || 'none',
        include: match !== null
      });
    }
    
    setPreview(previewData);
    setCurrentPage(1);
  };

  // Toggle include for a row - optimized to only update the specific row
  const toggleInclude = useCallback((id) => {
    setPreview(prev => {
      const newPreview = [...prev];
      const idx = newPreview.findIndex(row => row.id === id);
      if (idx !== -1) {
        newPreview[idx] = { ...newPreview[idx], include: !newPreview[idx].include };
      }
      return newPreview;
    });
  }, []);

  // Manually select school for a row
  const setManualSchool = useCallback((id, schoolId) => {
    setPreview(prev => {
      const newPreview = [...prev];
      const idx = newPreview.findIndex(row => row.id === id);
      if (idx === -1) return prev;
      
      if (!schoolId) {
        newPreview[idx] = { 
          ...newPreview[idx], 
          matchedSchool: null, 
          confidence: 'none',
          include: false 
        };
      } else {
        const school = schools.find(s => String(s.id) === String(schoolId));
        if (school) {
          newPreview[idx] = { 
            ...newPreview[idx], 
            matchedSchool: school, 
            confidence: 'manual',
            include: true 
          };
        }
      }
      return newPreview;
    });
  }, [schools]);

  // Bulk actions
  const selectAll = useCallback(() => {
    setPreview(prev => prev.map(row => ({ ...row, include: row.matchedSchool !== null })));
  }, []);
  
  const deselectAll = useCallback(() => {
    setPreview(prev => prev.map(row => ({ ...row, include: false })));
  }, []);

  // Perform import
  const handleImport = async () => {
    const toImport = preview.filter(row => row.include && row.matchedSchool);
    
    if (toImport.length === 0) {
      alert('No coaches selected for import');
      return;
    }
    
    setImporting(true);
    
    try {
      // Get existing coaches to avoid duplicates
      const { data: existingCoaches } = await supabase
        .from('coaches')
        .select('first_name, last_name, school_id');
      
      const existingSet = new Set(
        (existingCoaches || []).map(c => 
          `${c.school_id}|${c.first_name}|${c.last_name}`.toLowerCase()
        )
      );
      
      // Filter out duplicates
      const newCoaches = toImport.filter(row => {
        const key = `${row.matchedSchool.id}|${row.firstName}|${row.lastName}`.toLowerCase();
        return !existingSet.has(key);
      });
      
      const duplicates = toImport.length - newCoaches.length;
      
      if (newCoaches.length === 0) {
        setImportResult({
          success: true,
          imported: 0,
          duplicates,
          message: 'All coaches already exist in the database'
        });
        setImporting(false);
        return;
      }
      
      // Insert new coaches in batches of 100
      const BATCH_SIZE = 100;
      let totalImported = 0;
      
      for (let i = 0; i < newCoaches.length; i += BATCH_SIZE) {
        const batch = newCoaches.slice(i, i + BATCH_SIZE);
        const { data, error } = await supabase
          .from('coaches')
          .insert(batch.map(row => ({
            first_name: row.firstName,
            last_name: row.lastName,
            school_id: row.matchedSchool.id,
            email: row.email || null,
            phone: row.phone || null,
            title: row.title || null
          })))
          .select();
        
        if (error) throw error;
        totalImported += data.length;
      }
      
      setImportResult({
        success: true,
        imported: totalImported,
        duplicates,
        message: `Successfully imported ${totalImported} coach${totalImported !== 1 ? 'es' : ''}`
      });
      
    } catch (err) {
      console.error('Import error:', err);
      setImportResult({
        success: false,
        message: `Import failed: ${err.message}`
      });
    } finally {
      setImporting(false);
    }
  };

  // Computed values for stats and pagination
  const previewStats = useMemo(() => {
    if (!preview) return { total: 0, matched: 0, unmatched: 0, selected: 0 };
    return {
      total: preview.length,
      matched: preview.filter(r => r.matchedSchool).length,
      unmatched: preview.filter(r => !r.matchedSchool).length,
      selected: preview.filter(r => r.include && r.matchedSchool).length
    };
  }, [preview]);
  
  // Filtered preview based on filter settings
  const filteredPreview = useMemo(() => {
    if (!preview) return [];
    if (showOnlyUnmatched) {
      return preview.filter(r => !r.matchedSchool);
    }
    return preview;
  }, [preview, showOnlyUnmatched]);
  
  // Paginated preview
  const totalPages = Math.ceil(filteredPreview.length / ROWS_PER_PAGE);
  const paginatedPreview = useMemo(() => {
    const startIdx = (currentPage - 1) * ROWS_PER_PAGE;
    return filteredPreview.slice(startIdx, startIdx + ROWS_PER_PAGE);
  }, [filteredPreview, currentPage]);
  
  // Reset to page 1 when filter changes
  useEffect(() => {
    setCurrentPage(1);
  }, [showOnlyUnmatched]);

  return (
    <AdminLayout session={session}>
      <div className="max-w-6xl mx-auto">
        <h1 className="text-2xl font-bold mb-6">Bulk Import Coaches</h1>
        
        {schoolsLoading ? (
          <div className="bg-white rounded-lg shadow p-6">
            <div className="animate-pulse flex items-center gap-2">
              <div className="h-4 w-4 bg-blue-200 rounded-full"></div>
              <span className="text-gray-600">Loading schools database...</span>
            </div>
          </div>
        ) : (
          <>
            {/* Mobile Notice */}
            <div className="sm:hidden bg-amber-50 border border-amber-200 rounded-lg p-4 mb-6">
              <p className="text-sm text-amber-800">
                <strong>Tip:</strong> This page works best on a larger screen. The preview table may require horizontal scrolling on mobile devices.
              </p>
            </div>

            {/* Step 1: Upload File */}
            <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
              <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-2 mb-4">
                <h2 className="text-lg font-semibold">Step 1: Upload File</h2>
                <a 
                  href="/help?context=admin" 
                  target="_blank"
                  className="text-sm text-blue-600 hover:text-blue-800"
                >
                  View help guide →
                </a>
              </div>
              <p className="text-gray-600 mb-4 text-sm sm:text-base">
                Upload an Excel (.xlsx) or CSV file with coach data. The file should have columns for 
                school name, coach first/last names (or full name), and optionally email, phone, and title.
              </p>
              <input
                type="file"
                accept=".xlsx,.xls,.csv"
                onChange={handleFileUpload}
                className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
              />
              {file && (
                <p className="mt-2 text-sm text-green-600">
                  ✓ Loaded: {file.name} ({parsedData?.length || 0} data rows)
                </p>
              )}
            </div>

            {/* Step 2: Column Mapping */}
            {parsedData && (
              <div className="bg-white rounded-lg shadow p-4 sm:p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Step 2: Map Columns</h2>
                <p className="text-gray-600 mb-4 text-sm sm:text-base">
                  Verify the auto-detected columns or adjust as needed.
                </p>
                
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      School Column *
                    </label>
                    <select
                      value={schoolColumn}
                      onChange={e => setSchoolColumn(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">Select...</option>
                      {columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  
                  <div className="col-span-2 md:col-span-3">
                    <label className="flex items-center gap-2 mb-2">
                      <input
                        type="checkbox"
                        checked={useFullName}
                        onChange={e => setUseFullName(e.target.checked)}
                        className="rounded"
                      />
                      <span className="text-sm text-gray-700">Use single "Full Name" column instead of First/Last</span>
                    </label>
                  </div>
                  
                  {!useFullName ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          First Name Column *
                        </label>
                        <select
                          value={firstNameColumn}
                          onChange={e => setFirstNameColumn(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg"
                        >
                          <option value="">Select...</option>
                          {columns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">
                          Last Name Column *
                        </label>
                        <select
                          value={lastNameColumn}
                          onChange={e => setLastNameColumn(e.target.value)}
                          className="w-full px-3 py-2 border rounded-lg"
                        >
                          <option value="">Select...</option>
                          {columns.map(col => (
                            <option key={col} value={col}>{col}</option>
                          ))}
                        </select>
                      </div>
                    </>
                  ) : (
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Full Name Column *
                      </label>
                      <select
                        value={fullNameColumn}
                        onChange={e => setFullNameColumn(e.target.value)}
                        className="w-full px-3 py-2 border rounded-lg"
                      >
                        <option value="">Select...</option>
                        {columns.map(col => (
                          <option key={col} value={col}>{col}</option>
                        ))}
                      </select>
                    </div>
                  )}
                  
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Email Column
                    </label>
                    <select
                      value={emailColumn}
                      onChange={e => setEmailColumn(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">None</option>
                      {columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone Column
                    </label>
                    <select
                      value={phoneColumn}
                      onChange={e => setPhoneColumn(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">None</option>
                      {columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Title Column
                    </label>
                    <select
                      value={titleColumn}
                      onChange={e => setTitleColumn(e.target.value)}
                      className="w-full px-3 py-2 border rounded-lg"
                    >
                      <option value="">None</option>
                      {columns.map(col => (
                        <option key={col} value={col}>{col}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <button
                  onClick={handleGeneratePreview}
                  className="mt-4 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                >
                  Generate Preview
                </button>
              </div>
            )}

            {/* Step 3: Preview & Import */}
            {preview && (
              <div className="bg-white rounded-lg shadow p-6 mb-6">
                <h2 className="text-lg font-semibold mb-4">Step 3: Review & Import</h2>
                
                {/* Stats */}
                <div className="grid grid-cols-4 gap-4 mb-4">
                  <div className="bg-gray-50 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold">{previewStats.total}</div>
                    <div className="text-sm text-gray-600">Total</div>
                  </div>
                  <div className="bg-green-50 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-green-700">{previewStats.matched}</div>
                    <div className="text-sm text-green-600">Matched</div>
                  </div>
                  <div className="bg-red-50 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-red-700">{previewStats.unmatched}</div>
                    <div className="text-sm text-red-600">Unmatched</div>
                  </div>
                  <div className="bg-blue-50 p-3 rounded-lg text-center">
                    <div className="text-2xl font-bold text-blue-700">{previewStats.selected}</div>
                    <div className="text-sm text-blue-600">To Import</div>
                  </div>
                </div>
                
                {/* Controls row */}
                <div className="flex flex-wrap items-center gap-4 mb-4">
                  <div className="flex items-center gap-2">
                    <button
                      onClick={selectAll}
                      className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      Select All Matched
                    </button>
                    <button
                      onClick={deselectAll}
                      className="px-3 py-1 text-sm bg-gray-100 hover:bg-gray-200 rounded"
                    >
                      Deselect All
                    </button>
                  </div>
                  
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={showOnlyUnmatched}
                      onChange={e => setShowOnlyUnmatched(e.target.checked)}
                      className="rounded"
                    />
                    <span className="text-sm text-gray-700">Show only unmatched ({previewStats.unmatched})</span>
                  </label>
                  
                  <div className="text-sm text-gray-500 ml-auto">
                    Showing {paginatedPreview.length} of {filteredPreview.length} rows
                  </div>
                </div>

                {/* Preview table */}
                <div className="overflow-x-auto border rounded-lg">
                  <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                      <tr>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Include</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Coach Name</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Title</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Email</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Original School</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Matched To</th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Confidence</th>
                      </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                      {paginatedPreview.map((row) => (
                        <tr key={row.id} className={!row.include ? 'bg-gray-50 opacity-60' : ''}>
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={row.include}
                              onChange={() => toggleInclude(row.id)}
                              className="rounded"
                            />
                          </td>
                          <td className="px-3 py-2 text-sm">
                            {row.firstName} {row.lastName}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {row.title || '-'}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {row.email ? (
                              <span className="text-blue-600">{row.email}</span>
                            ) : '-'}
                          </td>
                          <td className="px-3 py-2 text-sm text-gray-600">
                            {row.originalSchool}
                          </td>
                          <td className="px-3 py-2 text-sm">
                            <select
                              className={`text-sm border rounded px-2 py-1 max-w-xs ${
                                row.matchedSchool ? 'border-green-300' : 'border-red-300'
                              }`}
                              value={row.matchedSchool ? String(row.matchedSchool.id) : ''}
                              onChange={e => setManualSchool(row.id, e.target.value)}
                            >
                              <option value="">Select school...</option>
                              {schools.map(s => (
                                <option key={s.id} value={String(s.id)}>{s.school}</option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2">
                            <span className={`text-xs px-2 py-1 rounded-full ${
                              row.confidence === 'exact' ? 'bg-green-100 text-green-800' :
                              row.confidence === 'high' ? 'bg-green-100 text-green-700' :
                              row.confidence === 'medium' ? 'bg-yellow-100 text-yellow-800' :
                              row.confidence === 'low' ? 'bg-orange-100 text-orange-800' :
                              row.confidence === 'manual' ? 'bg-blue-100 text-blue-800' :
                              'bg-red-100 text-red-800'
                            }`}>
                              {row.confidence === 'none' ? 'No match' : row.confidence}
                            </span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                
                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <button
                      onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
                      disabled={currentPage === 1}
                      className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      ← Previous
                    </button>
                    
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-gray-600">Page</span>
                      <select
                        value={currentPage}
                        onChange={e => setCurrentPage(Number(e.target.value))}
                        className="px-2 py-1 border rounded text-sm"
                      >
                        {Array.from({ length: totalPages }, (_, i) => i + 1).map(page => (
                          <option key={page} value={page}>{page}</option>
                        ))}
                      </select>
                      <span className="text-sm text-gray-600">of {totalPages}</span>
                    </div>
                    
                    <button
                      onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
                      disabled={currentPage === totalPages}
                      className="px-4 py-2 text-sm bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      Next →
                    </button>
                  </div>
                )}

                {/* Import button */}
                <div className="mt-4 flex items-center gap-4">
                  <button
                    onClick={handleImport}
                    disabled={importing || previewStats.selected === 0}
                    className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-400 disabled:cursor-not-allowed"
                  >
                    {importing ? 'Importing...' : `Import ${previewStats.selected} Coach${previewStats.selected !== 1 ? 'es' : ''}`}
                  </button>
                  
                  {importing && (
                    <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-green-600"></div>
                  )}
                </div>
              </div>
            )}

            {/* Import Result */}
            {importResult && (
              <div className={`rounded-lg p-6 ${importResult.success ? 'bg-green-50 border border-green-200' : 'bg-red-50 border border-red-200'}`}>
                <h3 className={`font-semibold ${importResult.success ? 'text-green-800' : 'text-red-800'}`}>
                  {importResult.success ? '✓ Import Complete' : '✗ Import Failed'}
                </h3>
                <p className={importResult.success ? 'text-green-700' : 'text-red-700'}>
                  {importResult.message}
                </p>
                {importResult.duplicates > 0 && (
                  <p className="text-yellow-700 mt-1">
                    {importResult.duplicates} duplicate(s) skipped (already in database)
                  </p>
                )}
                
                <div className="mt-4 flex gap-4">
                  <button
                    onClick={() => navigate('/admin/schools')}
                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
                  >
                    View Schools & Coaches
                  </button>
                  <button
                    onClick={() => navigate('/admin/dedup')}
                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700"
                  >
                    Run Dedup Tool
                  </button>
                  <button
                    onClick={() => {
                      setFile(null);
                      setParsedData(null);
                      setPreview(null);
                      setImportResult(null);
                      setCurrentPage(1);
                    }}
                    className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
                  >
                    Import More
                  </button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </AdminLayout>
  );
}
