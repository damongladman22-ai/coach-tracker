import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

export default function DedupCoaches({ session }) {
  const [coaches, setCoaches] = useState([])
  const [duplicates, setDuplicates] = useState([])
  const [loading, setLoading] = useState(true)
  const [merging, setMerging] = useState(null)
  const [toast, setToast] = useState(null)
  const [filter, setFilter] = useState('all') // 'all', 'exact', 'fuzzy'
  const [selectedPair, setSelectedPair] = useState(null)
  const [attendanceCounts, setAttendanceCounts] = useState({})
  const [dismissedPairs, setDismissedPairs] = useState(() => {
    // Load dismissed pairs from localStorage on init
    const saved = localStorage.getItem('dismissedCoachPairs')
    return saved ? JSON.parse(saved) : []
  })

  useEffect(() => {
    fetchData()
  }, [])

  // Save dismissed pairs to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem('dismissedCoachPairs', JSON.stringify(dismissedPairs))
  }, [dismissedPairs])

  const showToast = (message, type = 'success') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 3000)
  }

  const fetchData = async () => {
    setLoading(true)
    try {
      // Fetch ALL coaches with school info using pagination
      let allCoaches = []
      let page = 0
      const pageSize = 1000
      let hasMore = true

      while (hasMore) {
        const { data: coachesData, error } = await supabase
          .from('coaches')
          .select('*, schools(*)')
          .order('last_name')
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

      setCoaches(allCoaches)

      // Get attendance counts for each coach (also paginate)
      let allAttendance = []
      page = 0
      hasMore = true

      while (hasMore) {
        const { data: attendanceData, error } = await supabase
          .from('attendance')
          .select('coach_id')
          .range(page * pageSize, (page + 1) * pageSize - 1)

        if (error) throw error

        if (attendanceData && attendanceData.length > 0) {
          allAttendance = [...allAttendance, ...attendanceData]
          hasMore = attendanceData.length === pageSize
          page++
        } else {
          hasMore = false
        }
      }

      const counts = {}
      allAttendance.forEach(record => {
        counts[record.coach_id] = (counts[record.coach_id] || 0) + 1
      })
      setAttendanceCounts(counts)

      // Find potential duplicates
      findDuplicates(allCoaches)
    } catch (err) {
      console.error('Error fetching data:', err)
      showToast('Error loading coaches', 'error')
    } finally {
      setLoading(false)
    }
  }

  const findDuplicates = (coachesData) => {
    const potentialDupes = []
    const checked = new Set()

    for (let i = 0; i < coachesData.length; i++) {
      for (let j = i + 1; j < coachesData.length; j++) {
        const a = coachesData[i]
        const b = coachesData[j]

        // Only compare coaches from the same school
        if (a.school_id !== b.school_id) continue

        const pairKey = [a.id, b.id].sort().join('-')
        if (checked.has(pairKey)) continue
        checked.add(pairKey)

        // Skip if this pair was permanently dismissed
        if (dismissedPairs.includes(pairKey)) continue

        const matchType = getMatchType(a, b)
        if (matchType) {
          potentialDupes.push({
            coach1: a,
            coach2: b,
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

  const getMatchType = (a, b) => {
    const firstName1 = a.first_name.toLowerCase().trim()
    const firstName2 = b.first_name.toLowerCase().trim()
    const lastName1 = a.last_name.toLowerCase().trim()
    const lastName2 = b.last_name.toLowerCase().trim()

    // Exact match
    if (firstName1 === firstName2 && lastName1 === lastName2) {
      return 'exact'
    }

    // Last name must match or be very similar for fuzzy
    const lastNameMatch = lastName1 === lastName2 || 
      levenshtein(lastName1, lastName2) <= 1

    if (!lastNameMatch) return null

    // Check first name variations
    if (
      // One is initial of other: "J" vs "John"
      firstName1[0] === firstName2[0] && (firstName1.length === 1 || firstName2.length === 1) ||
      // One contains a period: "J." vs "John"
      (firstName1.replace('.', '') === firstName2[0]) ||
      (firstName2.replace('.', '') === firstName1[0]) ||
      // Similar first names (1-2 char difference): "John" vs "Jon"
      levenshtein(firstName1, firstName2) <= 2 ||
      // One is nickname: check common nicknames
      areNicknames(firstName1, firstName2)
    ) {
      return 'fuzzy'
    }

    return null
  }

  const getMatchScore = (a, b) => {
    let score = 0
    const firstName1 = a.first_name.toLowerCase().trim()
    const firstName2 = b.first_name.toLowerCase().trim()
    const lastName1 = a.last_name.toLowerCase().trim()
    const lastName2 = b.last_name.toLowerCase().trim()

    // Exact matches get highest score
    if (firstName1 === firstName2) score += 50
    if (lastName1 === lastName2) score += 50

    // Close matches
    if (levenshtein(firstName1, firstName2) === 1) score += 30
    if (levenshtein(lastName1, lastName2) === 1) score += 30

    // Initial matches
    if (firstName1[0] === firstName2[0]) score += 10

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

  // Check common nicknames
  const areNicknames = (name1, name2) => {
    const nicknames = {
      'william': ['will', 'bill', 'billy', 'willy'],
      'robert': ['rob', 'bob', 'bobby', 'robbie'],
      'richard': ['rich', 'rick', 'dick', 'ricky'],
      'james': ['jim', 'jimmy', 'jamie'],
      'john': ['jack', 'johnny', 'jon'],
      'michael': ['mike', 'mikey', 'mick'],
      'david': ['dave', 'davey'],
      'joseph': ['joe', 'joey'],
      'thomas': ['tom', 'tommy'],
      'christopher': ['chris', 'topher'],
      'daniel': ['dan', 'danny'],
      'matthew': ['matt', 'matty'],
      'anthony': ['tony', 'ant'],
      'steven': ['steve', 'stevie'],
      'stephen': ['steve', 'stevie'],
      'edward': ['ed', 'eddie', 'ted', 'teddy'],
      'charles': ['charlie', 'chuck'],
      'jennifer': ['jen', 'jenny'],
      'elizabeth': ['liz', 'beth', 'lizzy', 'betty'],
      'katherine': ['kate', 'katie', 'kathy', 'kat'],
      'catherine': ['kate', 'katie', 'cathy', 'cat'],
      'margaret': ['maggie', 'meg', 'peggy'],
      'patricia': ['pat', 'patty', 'trish'],
      'jessica': ['jess', 'jessie'],
      'ashley': ['ash'],
      'samantha': ['sam', 'sammy'],
      'amanda': ['mandy', 'amy'],
      'rebecca': ['becca', 'becky'],
      'christina': ['chris', 'tina', 'christy'],
      'christine': ['chris', 'tina', 'christy'],
    }

    for (const [full, nicks] of Object.entries(nicknames)) {
      const allNames = [full, ...nicks]
      if (allNames.includes(name1) && allNames.includes(name2)) {
        return true
      }
    }
    return false
  }

  const mergeCoaches = async (keepCoach, deleteCoach) => {
    setMerging(`${keepCoach.id}-${deleteCoach.id}`)
    
    try {
      // Step 1: Auto-merge non-conflicting fields from deleteCoach to keepCoach
      const fieldsToMerge = {}
      const mergedFields = []
      
      // Check each field - if keeper is empty and duplicate has value, use duplicate's value
      if (!keepCoach.email && deleteCoach.email) {
        fieldsToMerge.email = deleteCoach.email
        mergedFields.push('email')
      }
      if (!keepCoach.phone && deleteCoach.phone) {
        fieldsToMerge.phone = deleteCoach.phone
        mergedFields.push('phone')
      }
      if (!keepCoach.title && deleteCoach.title) {
        fieldsToMerge.title = deleteCoach.title
        mergedFields.push('title')
      }
      // Also merge name if keeper has initial and duplicate has full name
      if (keepCoach.first_name.length <= 2 && deleteCoach.first_name.length > 2) {
        fieldsToMerge.first_name = deleteCoach.first_name
        mergedFields.push('first name')
      }
      
      // Update keeper with merged fields if any
      if (Object.keys(fieldsToMerge).length > 0) {
        const { error: mergeError } = await supabase
          .from('coaches')
          .update(fieldsToMerge)
          .eq('id', keepCoach.id)
        
        if (mergeError) throw mergeError
      }
      
      // Step 2: Move attendance records to the keeper
      const { error: updateError } = await supabase
        .from('attendance')
        .update({ coach_id: keepCoach.id })
        .eq('coach_id', deleteCoach.id)

      if (updateError) throw updateError

      // Step 3: Delete the duplicate coach
      const { error: deleteError } = await supabase
        .from('coaches')
        .delete()
        .eq('id', deleteCoach.id)

      if (deleteError) throw deleteError

      // Build success message
      let message = `Merged into ${keepCoach.first_name} ${keepCoach.last_name}`
      if (mergedFields.length > 0) {
        message += ` (added ${mergedFields.join(', ')} from duplicate)`
      }
      showToast(message)
      setSelectedPair(null)
      
      // Refresh data
      await fetchData()
    } catch (err) {
      console.error('Error merging coaches:', err)
      showToast('Error merging coaches', 'error')
    } finally {
      setMerging(null)
    }
  }

  const dismissPair = (coach1Id, coach2Id) => {
    const pairKey = [coach1Id, coach2Id].sort().join('-')
    // Add to persistent dismissed list
    setDismissedPairs(prev => [...prev, pairKey])
    // Remove from current duplicates list
    setDuplicates(prev => prev.filter(d => 
      !(d.coach1.id === coach1Id && d.coach2.id === coach2Id) &&
      !(d.coach1.id === coach2Id && d.coach2.id === coach1Id)
    ))
    showToast('Pair permanently ignored', 'success')
  }

  const clearDismissed = () => {
    setDismissedPairs([])
    localStorage.removeItem('dismissedCoachPairs')
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
      <AdminLayout session={session} title="Dedup Coaches">
        <div className="text-center py-8">Loading coaches...</div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout session={session} title="Dedup Coaches">
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
            <div className="text-2xl sm:text-3xl font-bold text-gray-800">{coaches.length}</div>
            <div className="text-xs sm:text-sm text-gray-500">Total Coaches</div>
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
            ? '🎉 No duplicates found! Your coach database is clean.'
            : 'No duplicates match the current filter.'}
        </div>
      ) : (
        <div className="space-y-4">
          {filteredDuplicates.map((dup, idx) => {
            const { coach1, coach2, matchType } = dup
            const count1 = attendanceCounts[coach1.id] || 0
            const count2 = attendanceCounts[coach2.id] || 0
            const isSelected = selectedPair === idx
            const isMerging = merging === `${coach1.id}-${coach2.id}` || merging === `${coach2.id}-${coach1.id}`

            return (
              <div 
                key={`${coach1.id}-${coach2.id}`} 
                className={`bg-white rounded-lg shadow-md p-4 ${
                  matchType === 'exact' ? 'border-l-4 border-red-500' : 'border-l-4 border-yellow-500'
                }`}
              >
                <div className="flex justify-between items-start mb-3">
                  <div>
                    <span className={`text-xs font-medium px-2 py-1 rounded ${
                      matchType === 'exact' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'
                    }`}>
                      {matchType === 'exact' ? 'EXACT MATCH' : 'POSSIBLE MATCH'}
                    </span>
                    <span className="text-sm text-gray-500 ml-2">
                      {coach1.schools?.school}
                    </span>
                  </div>
                  <button
                    onClick={() => dismissPair(coach1.id, coach2.id)}
                    className="text-gray-400 hover:text-gray-600"
                    title="Dismiss (not a duplicate)"
                  >
                    ✕
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 mb-4">
                  {/* Coach 1 */}
                  <div className={`p-3 rounded-lg border-2 ${
                    isSelected ? 'border-blue-300' : 'border-gray-200'
                  }`}>
                    <div className="font-medium text-lg">
                      {coach1.first_name} {coach1.last_name}
                    </div>
                    {coach1.title && (
                      <div className="text-sm text-gray-600">{coach1.title}</div>
                    )}
                    <div className="text-sm text-gray-500 mt-1">
                      {count1} attendance record{count1 !== 1 ? 's' : ''}
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className={coach1.email ? 'text-green-600' : 'text-gray-400'}>
                        📧 {coach1.email || '(no email)'}
                      </div>
                      <div className={coach1.phone ? 'text-green-600' : 'text-gray-400'}>
                        📞 {coach1.phone || '(no phone)'}
                      </div>
                    </div>
                  </div>

                  {/* Coach 2 */}
                  <div className={`p-3 rounded-lg border-2 ${
                    isSelected ? 'border-blue-300' : 'border-gray-200'
                  }`}>
                    <div className="font-medium text-lg">
                      {coach2.first_name} {coach2.last_name}
                    </div>
                    {coach2.title && (
                      <div className="text-sm text-gray-600">{coach2.title}</div>
                    )}
                    <div className="text-sm text-gray-500 mt-1">
                      {count2} attendance record{count2 !== 1 ? 's' : ''}
                    </div>
                    <div className="mt-2 space-y-1 text-xs">
                      <div className={coach2.email ? 'text-green-600' : 'text-gray-400'}>
                        📧 {coach2.email || '(no email)'}
                      </div>
                      <div className={coach2.phone ? 'text-green-600' : 'text-gray-400'}>
                        📞 {coach2.phone || '(no phone)'}
                      </div>
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
                      Choose which coach to keep. Missing contact info will be auto-filled from the other record:
                    </p>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => mergeCoaches(coach1, coach2)}
                        disabled={isMerging}
                        className="py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300"
                      >
                        {isMerging ? 'Merging...' : `Keep "${coach1.first_name}"`}
                      </button>
                      <button
                        onClick={() => mergeCoaches(coach2, coach1)}
                        disabled={isMerging}
                        className="py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:bg-gray-300"
                      >
                        {isMerging ? 'Merging...' : `Keep "${coach2.first_name}"`}
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
          <li><strong>Exact duplicates</strong> = same first name, last name, and school</li>
          <li><strong>Possible duplicates</strong> = similar names at same school (typos, nicknames, initials)</li>
          <li>When you merge, all attendance records move to the coach you keep</li>
          <li><strong>Smart merge:</strong> Contact info (email, phone, title) from the duplicate is automatically added if the keeper is missing it</li>
          <li>If one record has an initial (e.g., "J.") and the other has the full name, the full name is preserved</li>
          <li>Click ✕ to <strong>permanently ignore</strong> pairs that aren't duplicates (won't show again)</li>
          <li>Use "Clear all ignored pairs" to review previously ignored pairs again</li>
        </ul>
      </div>
    </AdminLayout>
  )
}
