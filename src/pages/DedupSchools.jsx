import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import OwnerLayout from '../components/OwnerLayout'
import GenderBadge from '../components/GenderBadge'

export default function DedupSchools({ session }) {
  const [schools, setSchools] = useState([])
  const [duplicates, setDuplicates] = useState([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(null)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all') // 'all', 'exact', 'fuzzy'
  const [selectedPair, setSelectedPair] = useState(null)
  const [coachCounts, setCoachCounts] = useState({})
  const [bulkProgress, setBulkProgress] = useState(null) // { current, total, errors[] } while bulk-merging
  const [dismissedPairs, setDismissedPairs] = useState(() => {
    // Load dismissed pairs from localStorage on init
    const saved = localStorage.getItem('dismissedSchoolPairs')
    return saved ? JSON.parse(saved) : []
  })

  useEffect(() => {
    fetchData()
  }, [])

  // Save dismissed pairs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('dismissedSchoolPairs', JSON.stringify(dismissedPairs))
  }, [dismissedPairs])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch ALL schools using pagination
      let allSchools = []
      let page = 0
      const pageSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data: schoolsData, error } = await supabase
          .from('schools')
          .select('*')
          .order('school')
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) throw error

        if (schoolsData && schoolsData.length > 0) {
          allSchools = [...allSchools, ...schoolsData]
          hasMore = schoolsData.length === pageSize
          page++
        } else {
          hasMore = false
        }
      }

      setSchools(allSchools)

      // Get coach counts for each school (also paginate)
      let allCoaches = []
      page = 0
      hasMore = true

      while (hasMore) {
        const { data: coachesData, error } = await supabase
          .from('coaches')
          .select('school_id')
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) throw error

        if (coachesData && coachesData.length > 0) {
          allCoaches = [...allCoaches, ...coachesData]
          hasMore = coachesData.length === pageSize
          page++
        } else {
          hasMore = false
        }
      }

      const counts = {}
      allCoaches.forEach(record => {
        counts[record.school_id] = (counts[record.school_id] || 0) + 1
      })
      setCoachCounts(counts)

      // Find potential duplicates
      findDuplicates(allSchools)
    } catch (err) {
      console.error('Error fetching data:', err)
      showToast('Error loading schools', 'error')
    } finally {
      setLoading(false)
    }
  }

  const findDuplicates = (schoolsData) => {
    const potentialDupes = []
    const checked = new Set()

    for (let i = 0; i < schoolsData.length; i++) {
      for (let j = i + 1; j < schoolsData.length; j++) {
        const a = schoolsData[i]
        const b = schoolsData[j]

        // Never pair across program genders. A men's Ohio State row and a
        // women's Ohio State row are intentionally separate schools, not duplicates.
        // Treat null/missing program_gender as 'W' for back-compat.
        const aG = a.program_gender || 'W'
        const bG = b.program_gender || 'W'
        if (aG !== bG) continue

        const pairKey = [a.id, b.id].sort().join('-')
        if (checked.has(pairKey)) continue
        checked.add(pairKey)

        // Skip if this pair was permanently dismissed
        if (dismissedPairs.includes(pairKey)) continue

        const matchType = getMatchType(a, b)
        if (matchType) {
          potentialDupes.push({
            school1: a,
            school2: b,
            matchType,
            score: getMatchScore(a, b)
          })
        }
      }
    }

    // Sort by score (highest first)
    potentialDupes.sort((a, b) => b.score - a.score)
    setDuplicates(potentialDupes)
  }

  const normalizeSchoolName = (name) => {
    return name
      .toLowerCase()
      .trim()
      // Strip leading "The " — safe, doesn't conflate distinct schools.
      .replace(/^the\s+/, '')
      // DO NOT strip " University" / " College" / " of " suffixes — those
      // distinguish genuinely different schools that share a base name:
      //   Georgetown College (KY, NAIA) ≠ Georgetown University (DC, D1)
      //   Regis College (MA, D3)        ≠ Regis University (CO, D2)
      //   Simpson College (IA, D3)      ≠ Simpson University (CA, NAIA)
      //   Boston College                ≠ Boston University
      //   Wesleyan College (GA)         ≠ Wesleyan University (CT)
      // Stripping them collapses these distinct pairs into the same key
      // and causes the bulk-merge to delete one side. Same-school
      // formatting variants are still caught by the fuzzy-match path.
      // Normalize punctuation and spacing.
      .replace(/[.,\-–—]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const getMatchType = (a, b) => {
    const name1 = a.school.toLowerCase().trim()
    const name2 = b.school.toLowerCase().trim()
    const norm1 = normalizeSchoolName(a.school)
    const norm2 = normalizeSchoolName(b.school)

    // Check if same state (now required for exact matches as a safety
    // net — two schools can legitimately share a name across states)
    const sameState = a.state && b.state &&
      a.state.toLowerCase() === b.state.toLowerCase()

    // Exact match on full name — but only if same state, or one of the
    // records has no state (legacy / unknown). This prevents
    // "Concordia University" in MN being merged with "Concordia
    // University" in OR.
    if (name1 === name2 && (sameState || !a.state || !b.state)) {
      return 'exact'
    }

    // Exact match on normalized name — same constraint
    if (norm1 === norm2 && (sameState || !a.state || !b.state)) {
      return 'exact'
    }

    // Fuzzy matching - check Levenshtein distance on normalized names
    const distance = levenshtein(norm1, norm2)
    const maxLen = Math.max(norm1.length, norm2.length)
    const similarity = 1 - (distance / maxLen)

    // High similarity (90%+) = likely duplicate
    if (similarity >= 0.90) {
      return 'fuzzy'
    }

    // Check if one name contains the other (with same state)
    if (sameState) {
      if (norm1.includes(norm2) || norm2.includes(norm1)) {
        // Only if the contained part is substantial (at least 60% of the longer name)
        const shorterLen = Math.min(norm1.length, norm2.length)
        if (shorterLen / maxLen >= 0.6) {
          return 'fuzzy'
        }
      }
    }

    // Check for common abbreviation patterns
    if (sameState && areSimilarAbbreviations(a.school, b.school)) {
      return 'fuzzy'
    }

    return null
  }

  const areSimilarAbbreviations = (name1, name2) => {
    // Check for patterns like "U of X" vs "University of X"
    // "X State" vs "X State University"
    // "Saint X" vs "St. X"
    const patterns = [
      [/\bSaint\b/i, /\bSt\.?\b/i],
      [/\bMount\b/i, /\bMt\.?\b/i],
      [/\bUniversity\b/i, /\bU\.?\b/i],
      [/\bNorth\b/i, /\bN\.?\b/i],
      [/\bSouth\b/i, /\bS\.?\b/i],
      [/\bEast\b/i, /\bE\.?\b/i],
      [/\bWest\b/i, /\bW\.?\b/i],
    ]

    for (const [full, abbrev] of patterns) {
      const norm1 = name1.replace(full, 'X').replace(abbrev, 'X').toLowerCase()
      const norm2 = name2.replace(full, 'X').replace(abbrev, 'X').toLowerCase()
      if (norm1 === norm2) {
        return true
      }
    }

    return false
  }

  const getMatchScore = (a, b) => {
    let score = 0
    const name1 = a.school.toLowerCase().trim()
    const name2 = b.school.toLowerCase().trim()
    const norm1 = normalizeSchoolName(a.school)
    const norm2 = normalizeSchoolName(b.school)

    // Exact matches get highest score
    if (name1 === name2) score += 100
    else if (norm1 === norm2) score += 90

    // Same state adds points
    if (a.state && b.state && a.state.toLowerCase() === b.state.toLowerCase()) {
      score += 20
    }

    // Same division adds points
    if (a.division && b.division && a.division === b.division) {
      score += 10
    }

    // Same conference adds points
    if (a.conference && b.conference && a.conference === b.conference) {
      score += 15
    }

    // Similarity score
    const distance = levenshtein(norm1, norm2)
    const maxLen = Math.max(norm1.length, norm2.length)
    const similarity = 1 - (distance / maxLen)
    score += Math.round(similarity * 50)

    return score
  }

  // Levenshtein distance for fuzzy matching
  const levenshtein = (a, b) => {
    if (a.length === 0) return b.length
    if (b.length === 0) return a.length

    const matrix = []
    for (let i = 0; i <= b.length; i++) {
      matrix[i] = [i]
    }
    for (let j = 0; j <= a.length; j++) {
      matrix[0][j] = j
    }

    for (let i = 1; i <= b.length; i++) {
      for (let j = 1; j <= a.length; j++) {
        if (b[i - 1] === a[j - 1]) {
          matrix[i][j] = matrix[i - 1][j - 1]
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          )
        }
      }
    }
    return matrix[b.length][a.length]
  }

  const mergeSchools = async (keepSchool, deleteSchool) => {
    setMerging(`${keepSchool.id}-${deleteSchool.id}`)
    
    try {
      // Step 1: Auto-merge non-conflicting fields from deleteSchool to keepSchool
      const fieldsToMerge = {}
      const mergedFields = []
      
      // Check each field - if keeper is empty and duplicate has value, use duplicate's value
      if (!keepSchool.city && deleteSchool.city) {
        fieldsToMerge.city = deleteSchool.city
        mergedFields.push('city')
      }
      if (!keepSchool.state && deleteSchool.state) {
        fieldsToMerge.state = deleteSchool.state
        mergedFields.push('state')
      }
      if (!keepSchool.type && deleteSchool.type) {
        fieldsToMerge.type = deleteSchool.type
        mergedFields.push('type')
      }
      if (!keepSchool.conference && deleteSchool.conference) {
        fieldsToMerge.conference = deleteSchool.conference
        mergedFields.push('conference')
      }
      if (!keepSchool.division && deleteSchool.division) {
        fieldsToMerge.division = deleteSchool.division
        mergedFields.push('division')
      }
      
      // Update keeper with merged fields if any
      if (Object.keys(fieldsToMerge).length > 0) {
        const { error: mergeError } = await supabase
          .from('schools')
          .update(fieldsToMerge)
          .eq('id', keepSchool.id)
        
        if (mergeError) throw mergeError
      }
      
      // Step 2: Reassign all coaches from deleteSchool to keepSchool
      const { error: updateError } = await supabase
        .from('coaches')
        .update({ school_id: keepSchool.id })
        .eq('school_id', deleteSchool.id)

      if (updateError) throw updateError

      // Step 3: Delete the duplicate school
      const { error: deleteError } = await supabase
        .from('schools')
        .delete()
        .eq('id', deleteSchool.id)

      if (deleteError) throw deleteError

      // Build success message
      const coachCount = coachCounts[deleteSchool.id] || 0
      let message = `Merged "${deleteSchool.school}" into "${keepSchool.school}"`
      if (coachCount > 0) {
        message += ` (${coachCount} coach${coachCount !== 1 ? 'es' : ''} reassigned)`
      }
      if (mergedFields.length > 0) {
        message += ` — added ${mergedFields.join(', ')}`
      }
      showToast(message)
      setSelectedPair(null)
      
      // Refresh data
      await fetchData()
    } catch (err) {
      console.error('Error merging schools:', err)
      showToast('Error merging schools', 'error')
    } finally {
      setMerging(null)
    }
  }

  /**
   * Pick which of two records becomes the keeper when bulk-merging.
   * Strategy: more coaches wins (preserves more relational data).
   * Tiebreak: lower id wins (older record).
   *
   * Returns [keeper, toDelete].
   */
  const pickKeeper = (a, b, counts) => {
    const aC = counts[a.id] || 0
    const bC = counts[b.id] || 0
    if (aC > bC) return [a, b]
    if (bC > aC) return [b, a]
    return a.id < b.id ? [a, b] : [b, a]
  }

  /**
   * Bulk-merge every exact-match pair found in this run.
   * Uses the same smart-merge logic as the per-pair Keep button, but runs
   * inline (no per-pair state updates or per-pair data refresh) so 200+
   * merges complete in a single sweep. Errors are collected and reported
   * at the end; the loop does not stop on individual failures.
   */
  const bulkMergeExactMatches = async () => {
    const exactPairs = duplicates.filter(d => d.matchType === 'exact')
    if (exactPairs.length === 0) return

    const confirmed = window.confirm(
      `This will merge ${exactPairs.length} exact-match school pair${exactPairs.length === 1 ? '' : 's'}.\n\n` +
      `For each pair:\n` +
      ` • The record with more coaches attached becomes the keeper (older id wins on ties)\n` +
      ` • Non-null city / state / type / conference / division fields are copied to the keeper if missing\n` +
      ` • All coaches from the duplicate are reassigned to the keeper\n` +
      ` • The duplicate is deleted\n\n` +
      `This cannot be undone. Continue?`
    )
    if (!confirmed) return

    const errors = []
    setBulkProgress({ current: 0, total: exactPairs.length, errors: [] })

    for (let i = 0; i < exactPairs.length; i++) {
      const { school1, school2 } = exactPairs[i]
      const [keeper, toDelete] = pickKeeper(school1, school2, coachCounts)

      try {
        // Smart-merge non-null fields from dupe into keeper
        const fieldsToMerge = {}
        if (!keeper.city && toDelete.city) fieldsToMerge.city = toDelete.city
        if (!keeper.state && toDelete.state) fieldsToMerge.state = toDelete.state
        if (!keeper.type && toDelete.type) fieldsToMerge.type = toDelete.type
        if (!keeper.conference && toDelete.conference) fieldsToMerge.conference = toDelete.conference
        if (!keeper.division && toDelete.division) fieldsToMerge.division = toDelete.division

        if (Object.keys(fieldsToMerge).length > 0) {
          const { error: mErr } = await supabase
            .from('schools')
            .update(fieldsToMerge)
            .eq('id', keeper.id)
          if (mErr) throw mErr
        }

        // Reassign coaches
        const { error: cErr } = await supabase
          .from('coaches')
          .update({ school_id: keeper.id })
          .eq('school_id', toDelete.id)
        if (cErr) throw cErr

        // Delete duplicate
        const { error: dErr } = await supabase
          .from('schools')
          .delete()
          .eq('id', toDelete.id)
        if (dErr) throw dErr
      } catch (err) {
        console.error(`Bulk merge failed for pair "${school1.school}" / "${school2.school}":`, err)
        errors.push({
          pair: `${school1.school} / ${school2.school}`,
          message: err.message || String(err),
        })
      }

      setBulkProgress({ current: i + 1, total: exactPairs.length, errors: [...errors] })
    }

    // Refresh data once at the end (recomputes duplicates, coach counts, etc.)
    await fetchData()
    setBulkProgress(null)

    const successCount = exactPairs.length - errors.length
    if (errors.length === 0) {
      showToast(`Merged all ${successCount} exact-match pairs`)
    } else {
      showToast(
        `Merged ${successCount} pair${successCount === 1 ? '' : 's'}; ${errors.length} failed (see browser console)`,
        'error'
      )
    }
  }

  const dismissPair = (school1Id, school2Id) => {
    const pairKey = [school1Id, school2Id].sort().join('-')
    // Add to persistent dismissed list
    setDismissedPairs(prev => [...prev, pairKey])
    // Remove from current duplicates list
    setDuplicates(prev => prev.filter(d => 
      !(d.school1.id === school1Id && d.school2.id === school2Id) &&
      !(d.school1.id === school2Id && d.school2.id === school1Id)
    ))
    showToast('Pair permanently ignored', 'success')
  }

  const clearDismissed = () => {
    setDismissedPairs([])
    localStorage.removeItem('dismissedSchoolPairs')
    showToast('Cleared all ignored pairs - refreshing...', 'success')
    setTimeout(() => fetchData(), 500)
  }

  const filteredDuplicates = duplicates.filter(d => {
    if (filter === 'all') return true
    return d.matchType === filter
  })

  const exactCount = duplicates.filter(d => d.matchType === 'exact').length
  const fuzzyCount = duplicates.filter(d => d.matchType === 'fuzzy').length

  if (loading) {
    return (
      <OwnerLayout session={session} title="Dedup Schools">
        <div className="text-center py-8">Loading schools...</div>
      </OwnerLayout>
    )
  }

  return (
    <OwnerLayout session={session} title="Dedup Schools">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 px-4 py-2 rounded-lg shadow-lg ${
          toast.type === 'error' ? 'bg-red-500' : 'bg-green-500'
        } text-white`}>
          {toast.message}
        </div>
      )}

      {/* Stats */}
      <div className="bg-white rounded-lg shadow-md p-4 sm:p-6 mb-6">
        <h2 className="text-lg font-semibold mb-4">Duplicate Analysis</h2>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4 text-center">
          <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-gray-800">{schools.length}</div>
            <div className="text-xs sm:text-sm text-gray-500">Total Schools</div>
          </div>
          <div className="bg-red-50 rounded-lg p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-red-600">{exactCount}</div>
            <div className="text-xs sm:text-sm text-gray-500">Exact Duplicates</div>
          </div>
          <div className="bg-yellow-50 rounded-lg p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-yellow-600">{fuzzyCount}</div>
            <div className="text-xs sm:text-sm text-gray-500">Possible Duplicates</div>
          </div>
          <div className="bg-gray-50 rounded-lg p-3 sm:p-4">
            <div className="text-2xl sm:text-3xl font-bold text-gray-500">{dismissedPairs.length}</div>
            <div className="text-xs sm:text-sm text-gray-500">Ignored Pairs</div>
          </div>
        </div>
        {dismissedPairs.length > 0 && (
          <div className="mt-4 text-center">
            <button
              onClick={clearDismissed}
              className="text-sm text-blue-600 hover:text-blue-800 underline"
            >
              Clear all ignored pairs and re-check
            </button>
          </div>
        )}
      </div>

      {/* Bulk merge banner — appears when there are exact matches to clean up */}
      {exactCount > 0 && !bulkProgress && (
        <div className="bg-amber-50 border border-amber-200 rounded-lg p-4 mb-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex-1">
            <div className="font-semibold text-amber-900">
              {exactCount} exact-match pair{exactCount === 1 ? '' : 's'} ready for bulk merge
            </div>
            <div className="text-sm text-amber-700 mt-1">
              Same school, same state, same gender. The record with more coaches becomes the keeper; the other is merged in and deleted.
            </div>
          </div>
          <button
            onClick={bulkMergeExactMatches}
            className="px-4 py-2 bg-amber-600 text-white rounded-lg hover:bg-amber-700 font-semibold whitespace-nowrap"
          >
            Merge All {exactCount} Exact Matches
          </button>
        </div>
      )}

      {/* Bulk merge progress UI */}
      {bulkProgress && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-4 mb-4">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-blue-900">
              Merging exact matches… {bulkProgress.current} / {bulkProgress.total}
            </div>
            <div className="text-sm text-blue-700">
              {Math.round((bulkProgress.current / bulkProgress.total) * 100)}%
            </div>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2 mt-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all"
              style={{ width: `${(bulkProgress.current / bulkProgress.total) * 100}%` }}
            ></div>
          </div>
          {bulkProgress.errors.length > 0 && (
            <div className="text-sm text-red-700 mt-2">
              {bulkProgress.errors.length} pair{bulkProgress.errors.length === 1 ? '' : 's'} failed so far (continuing — see browser console)
            </div>
          )}
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-lg shadow-md p-4 mb-6">
        <div className="flex gap-2">
          <button
            onClick={() => setFilter('all')}
            className={`px-4 py-2 rounded-lg ${
              filter === 'all' ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            All ({duplicates.length})
          </button>
          <button
            onClick={() => setFilter('exact')}
            className={`px-4 py-2 rounded-lg ${
              filter === 'exact' ? 'bg-red-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Exact ({exactCount})
          </button>
          <button
            onClick={() => setFilter('fuzzy')}
            className={`px-4 py-2 rounded-lg ${
              filter === 'fuzzy' ? 'bg-yellow-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
            }`}
          >
            Fuzzy ({fuzzyCount})
          </button>
        </div>
      </div>

      {/* Duplicates List */}
      {filteredDuplicates.length === 0 ? (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          {duplicates.length === 0 
            ? '🎉 No duplicates found! Your school database is clean.'
            : 'No duplicates match the current filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDuplicates.map((dup, idx) => {
            const { school1, school2, matchType } = dup
            const count1 = coachCounts[school1.id] || 0
            const count2 = coachCounts[school2.id] || 0
            const isSelected = selectedPair === idx
            const isMerging = merging === `${school1.id}-${school2.id}` || merging === `${school2.id}-${school1.id}`

            return (
              <div 
                key={`${school1.id}-${school2.id}`} 
                className={`bg-white rounded-lg shadow-md p-4 ${
                  matchType === 'exact' ? 'border-l-4 border-red-500' : 'border-l-4 border-yellow-500'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <span className={`text-xs font-medium px-2 py-1 rounded ${
                    matchType === 'exact' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {matchType === 'exact' ? 'EXACT MATCH' : 'POSSIBLE MATCH'}
                  </span>
                  <button
                    onClick={() => dismissPair(school1.id, school2.id)}
                    className="text-gray-400 hover:text-gray-600"
                    title="Dismiss (not a duplicate)"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* School 1 */}
                  <div className={`p-3 rounded-lg border-2 ${
                    isSelected ? 'border-blue-300' : 'border-gray-200'
                  }`}>
                    <div className="font-medium text-lg flex items-center gap-2">
                      <span>{school1.school}</span>
                      <GenderBadge gender={school1.program_gender} size="xs" />
                    </div>
                    <div className={`text-sm ${school1.city && school1.state ? 'text-gray-600' : 'text-gray-400'}`}>
                      {school1.city || '(no city)'}, {school1.state || '(no state)'}
                    </div>
                    <div className={`text-sm ${school1.division ? 'text-gray-500' : 'text-gray-400'}`}>
                      {school1.division || '(no division)'} • {school1.conference || '(no conference)'}
                    </div>
                    <div className={`text-sm mt-1 ${school1.type ? 'text-gray-500' : 'text-gray-400'}`}>
                      {school1.type || '(no type)'}
                    </div>
                    <div className="mt-2 text-sm font-medium text-blue-600">
                      {count1} coach{count1 !== 1 ? 'es' : ''}
                    </div>
                  </div>

                  {/* School 2 */}
                  <div className={`p-3 rounded-lg border-2 ${
                    isSelected ? 'border-blue-300' : 'border-gray-200'
                  }`}>
                    <div className="font-medium text-lg flex items-center gap-2">
                      <span>{school2.school}</span>
                      <GenderBadge gender={school2.program_gender} size="xs" />
                    </div>
                    <div className={`text-sm ${school2.city && school2.state ? 'text-gray-600' : 'text-gray-400'}`}>
                      {school2.city || '(no city)'}, {school2.state || '(no state)'}
                    </div>
                    <div className={`text-sm ${school2.division ? 'text-gray-500' : 'text-gray-400'}`}>
                      {school2.division || '(no division)'} • {school2.conference || '(no conference)'}
                    </div>
                    <div className={`text-sm mt-1 ${school2.type ? 'text-gray-500' : 'text-gray-400'}`}>
                      {school2.type || '(no type)'}
                    </div>
                    <div className="mt-2 text-sm font-medium text-blue-600">
                      {count2} coach{count2 !== 1 ? 'es' : ''}
                    </div>
                  </div>
                </div>

                {/* Merge Buttons */}
                {!isSelected ? (
                  <button
                    onClick={() => setSelectedPair(idx)}
                    className="w-full py-2 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200"
                  >
                    Select to Merge
                  </button>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-gray-600 text-center mb-2">
                      Choose which school to keep. Missing info will be auto-filled from the other record:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => mergeSchools(school1, school2)}
                        disabled={isMerging}
                        className="py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 text-sm"
                      >
                        {isMerging ? 'Merging...' : `Keep "${school1.school.length > 20 ? school1.school.slice(0, 20) + '...' : school1.school}"`}
                      </button>
                      <button
                        onClick={() => mergeSchools(school2, school1)}
                        disabled={isMerging}
                        className="py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300 text-sm"
                      >
                        {isMerging ? 'Merging...' : `Keep "${school2.school.length > 20 ? school2.school.slice(0, 20) + '...' : school2.school}"`}
                      </button>
                    </div>
                    <button
                      onClick={() => setSelectedPair(null)}
                      className="w-full py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Help text */}
      <div className="mt-6 bg-blue-50 rounded-lg p-4 text-sm text-blue-800">
        <strong>How this works:</strong>
        <ul className="mt-2 space-y-1 list-disc list-inside">
          <li><strong>Exact duplicates</strong> = same school name (after normalization)</li>
          <li><strong>Possible duplicates</strong> = similar names, abbreviations (St. vs Saint, etc.)</li>
          <li>When you merge, <strong>all coaches</strong> from the deleted school move to the kept school</li>
          <li><strong>Smart merge:</strong> Missing info (city, state, division, conference, type) is automatically filled from the duplicate</li>
          <li>Click ✕ to <strong>permanently ignore</strong> pairs that aren't duplicates (won't show again)</li>
          <li>Use "Clear all ignored pairs" to review previously ignored pairs again</li>
        </ul>
      </div>
    </OwnerLayout>
  )
}
