import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import AdminLayout from '../components/AdminLayout';
import * as XLSX from 'xlsx';

/**
 * Bulk Coach Import Page
 * 
 * Supports Excel (.xlsx, .xls) and CSV files
 * Auto-detects columns and fuzzy-matches school names
 */
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
  
  // Preview state
  const [preview, setPreview] = useState(null);
  const [importing, setImporting] = useState(false);
  const [importResult, setImportResult] = useState(null);

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
      
      // Skip duplicates in file
      const key = `${schoolName}|${firstName}|${lastName}`.toLowerCase();
      if (seenCoaches.has(key)) continue;
      seenCoaches.add(key);
      
      const match = findSchoolMatch(schoolName);
      
      previewData.push({
        originalSchool: schoolName,
        firstName: String(firstName).trim(),
        lastName: String(lastName).trim(),
        matchedSchool: match?.school || null,
        confidence: match?.confidence || 'none',
        include: match !== null
      });
    }
    
    setPreview(previewData);
  };

  // Toggle include for a row
  const toggleInclude = (index) => {
    setPreview(prev => prev.map((row, i) => 
      i === index ? { ...row, include: !row.include } : row
    ));
  };

  // Manually select school for a row
  const setManualSchool = (index, schoolId) => {
    if (!schoolId) {
      setPreview(prev => prev.map((row, i) => 
        i === index ? { 
          ...row, 
          matchedSchool: null, 
          confidence: 'none',
          include: false 
        } : row
      ));
      return;
    }
    
    // Find school - compare as strings to avoid type issues
    const school = schools.find(s => String(s.id) === String(schoolId));
    
    if (school) {
      setPreview(prev => prev.map((row, i) => 
        i === index ? { 
          ...row, 
          matchedSchool: school, 
          confidence: 'manual',
          include: true 
        } : row
      ));
    }
  };

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
      
      // Insert new coaches
      const { data, error } = await supabase
        .from('coaches')
        .insert(newCoaches.map(row => ({
          first_name: row.firstName,
          last_name: row.lastName,
          school_id: row.matchedSchool.id
        })))
        .select();
      
      if (error) throw error;
      
      setImportResult({
        success: true,
        imported: data.length,
        duplicates,
        message: `Successfully imported ${data.length} coach${data.length !== 1 ? 'es' : ''}`
      });
      
    } catch (err) {
      console.error('Import error:', err);
      setImportResult({
        success: false,
        message: 'Import failed: ' + err.message
      });
    } finally {
      setImporting(false);
    }
  };

  // Stats for preview
  const previewStats = preview ? {
    total: preview.length,
    matched: preview.filter(r => r.matchedSchool).length,
    unmatched: preview.filter(r => !r.matchedSchool).length,
    selected: preview.filter(r => r.include).length
  } : null;

  if (schoolsLoading) {
    return (
      <AdminLayout session={session} title="Import Coaches">
        <div className="flex justify-center py-12">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
        </div>
      </AdminLayout>
    );
  }

  return (
    <AdminLayout session={session} title="Import Coaches">
      <div className="max-w-4xl">
        {/* Step 1: Upload File */}
        <div className="bg-white rounded-lg shadow p-6 mb-6">
          <h2 className="text-lg font-semibold mb-4">Step 1: Upload File</h2>
          <p className="text-gray-600 mb-4">
            Upload an Excel (.xlsx) or CSV file containing coach data. 
            The file should have columns for school name and coach name(s).
          </p>
          
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFileUpload}
            className="block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-lg file:border-0 file:text-sm file:font-semibold file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100"
          />
          
          {file && (
            <p className="mt-2 text-sm text-green-600">
              ✓ Loaded: {file.name} ({parsedData?.length || 0} rows)
            </p>
          )}
        </div>

        {/* Step 2: Map Columns */}
        {parsedData && (
          <div className="bg-white rounded-lg shadow p-6 mb-6">
            <h2 className="text-lg font-semibold mb-4">Step 2: Map Columns</h2>
            
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  School/College Column *
                </label>
                <select
                  value={schoolColumn}
                  onChange={e => setSchoolColumn(e.target.value)}
                  className="w-full px-3 py-2 border rounded-lg"
                >
                  <option value="">Select column...</option>
                  {columns.map(col => (
                    <option key={col} value={col}>{col}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="mb-4">
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={useFullName}
                  onChange={e => setUseFullName(e.target.checked)}
                  className="rounded"
                />
                <span className="text-sm">Use single "Full Name" column instead of separate First/Last</span>
              </label>
            </div>

            {useFullName ? (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Coach Name Column *
                  </label>
                  <select
                    value={fullNameColumn}
                    onChange={e => setFullNameColumn(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select column...</option>
                    {columns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    First Name Column *
                  </label>
                  <select
                    value={firstNameColumn}
                    onChange={e => setFirstNameColumn(e.target.value)}
                    className="w-full px-3 py-2 border rounded-lg"
                  >
                    <option value="">Select column...</option>
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
                    <option value="">Select column...</option>
                    {columns.map(col => (
                      <option key={col} value={col}>{col}</option>
                    ))}
                  </select>
                </div>
              </div>
            )}

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

            {/* Preview table */}
            <div className="overflow-x-auto max-h-96 overflow-y-auto border rounded-lg">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Include</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Coach Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Original School</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Matched To</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-500">Confidence</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {preview.map((row, idx) => (
                    <tr key={idx} className={!row.include ? 'bg-gray-50 opacity-60' : ''}>
                      <td className="px-3 py-2">
                        <input
                          type="checkbox"
                          checked={row.include}
                          onChange={() => toggleInclude(idx)}
                          className="rounded"
                        />
                      </td>
                      <td className="px-3 py-2 text-sm">
                        {row.firstName} {row.lastName}
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
                          onChange={e => setManualSchool(idx, e.target.value)}
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
                onClick={() => {
                  setFile(null);
                  setParsedData(null);
                  setPreview(null);
                  setImportResult(null);
                }}
                className="px-4 py-2 bg-gray-200 text-gray-700 rounded-lg hover:bg-gray-300"
              >
                Import More
              </button>
            </div>
          </div>
        )}
      </div>
    </AdminLayout>
  );
}
