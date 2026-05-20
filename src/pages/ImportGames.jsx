import { useState, useEffect, useMemo, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { read, utils } from 'xlsx'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClubId } from '../lib/club'
import { getActiveSeasonId } from '../lib/season'
import { getGameTypes } from '../lib/lookups'

/**
 * Bulk game importer.
 *
 * Flow:
 *  1. Upload an Excel/CSV file.
 *  2. Map columns → game fields (auto-detected when possible).
 *  3. If team column not present, pick a default team for all rows.
 *  4. Preview: each row shows matched team / event / game_type, parsed date,
 *     and issues flagged. Per-row include/exclude. Per-row overrides for
 *     ambiguous matches.
 *  5. Import: batch insert valid rows.
 *
 * Fuzzy matching is space-tolerant substring matching (same pattern used
 * for school search elsewhere in the app).
 */

const GAME_FIELDS = [
  { key: 'team', label: 'Team', required: false, autoMatch: ['team', 'team name', 'our team'] },
  { key: 'date', label: 'Date', required: true, autoMatch: ['date', 'game date', 'match date'] },
  { key: 'time', label: 'Time', required: false, autoMatch: ['time', 'game time', 'kickoff', 'start time'] },
  { key: 'opponent', label: 'Opponent', required: false, autoMatch: ['opponent', 'vs', 'opp', 'opposition', 'against'] },
  { key: 'is_home', label: 'Home/Away', required: false, autoMatch: ['home/away', 'h/a', 'venue', 'home', 'location type'] },
  { key: 'location', label: 'Location', required: false, autoMatch: ['location', 'venue', 'field', 'where'] },
  { key: 'event', label: 'Event', required: false, autoMatch: ['event', 'tournament', 'showcase'] },
  { key: 'game_type', label: 'Game Type', required: false, autoMatch: ['game type', 'type'] },
  { key: 'our_score', label: 'Our Score', required: false, autoMatch: ['our score', 'score for', 'gf'] },
  { key: 'opponent_score', label: 'Opp. Score', required: false, autoMatch: ['opponent score', 'opp score', 'score against', 'ga'] },
]

export default function ImportGames({ session }) {
  const [step, setStep] = useState('upload') // upload | map | preview | done
  const [columns, setColumns] = useState([])
  const [rows, setRows] = useState([])
  const [mapping, setMapping] = useState({}) // { field_key: column_name }
  const [defaultTeamId, setDefaultTeamId] = useState('')
  const [defaultEventId, setDefaultEventId] = useState('')

  const [teams, setTeams] = useState([])
  const [events, setEvents] = useState([])
  const [gameTypes, setGameTypes] = useState([])

  const [previewData, setPreviewData] = useState([]) // [{ row, team, event, gameType, parsedDate, ... include }]
  const [importing, setImporting] = useState(false)
  const [results, setResults] = useState(null) // { inserted, skipped, errors }

  useEffect(() => {
    loadLookups()
  }, [])

  const loadLookups = async () => {
    const [seasonId, clubId, types] = await Promise.all([
      getActiveSeasonId(),
      getCurrentClubId(),
      getGameTypes(),
    ])
    if (clubId && seasonId) {
      const [teamsRes, eventsRes] = await Promise.all([
        supabase
          .from('teams')
          .select('id, name, slug')
          .eq('club_id', clubId)
          .eq('season_id', seasonId)
          .order('name'),
        supabase
          .from('events')
          .select('id, event_name, slug')
          .eq('club_id', clubId)
          .eq('season_id', seasonId)
          .order('start_date', { ascending: false }),
      ])
      setTeams(teamsRes.data || [])
      setEvents(eventsRes.data || [])
    }
    setGameTypes(types || [])
  }

  // --- Step 1: Upload ---

  const handleFile = async (e) => {
    const file = e.target.files[0]
    if (!file) return
    const buf = await file.arrayBuffer()
    const wb = read(buf)
    const ws = wb.Sheets[wb.SheetNames[0]]
    const data = utils.sheet_to_json(ws, { defval: '', raw: false })
    if (data.length === 0) {
      alert('No rows found in the file.')
      return
    }
    const cols = Object.keys(data[0])
    setColumns(cols)
    setRows(data)

    // Auto-detect column mapping
    const m = {}
    for (const f of GAME_FIELDS) {
      const found = cols.find((c) =>
        f.autoMatch.some(
          (a) => c.toLowerCase().replace(/[_-]/g, ' ').trim() === a
        )
      )
      if (found) m[f.key] = found
    }
    setMapping(m)
    setStep('map')
  }

  // --- Step 2: Mapping helpers ---

  const updateMapping = (fieldKey, columnName) => {
    setMapping((prev) => ({ ...prev, [fieldKey]: columnName }))
  }

  // --- Parsers ---

  const parseDate = useCallback((v) => {
    if (v == null || v === '') return null
    // Excel can give us a Date object
    if (v instanceof Date) {
      return formatDateISO(v)
    }
    const s = String(v).trim()
    // YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
    if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}`
    // M/D/YYYY or MM/DD/YYYY
    m = s.match(/^(\d{1,2})[/](\d{1,2})[/](\d{2,4})$/)
    if (m) {
      let y = m[3]
      if (y.length === 2) y = '20' + y
      return `${y}-${pad(m[1])}-${pad(m[2])}`
    }
    // "Dec 6 2025" / "December 6, 2025"
    const d = new Date(s)
    if (!isNaN(d.getTime())) return formatDateISO(d)
    return null
  }, [])

  const parseTime = useCallback((v) => {
    if (v == null || v === '') return null
    if (v instanceof Date) {
      return `${pad(v.getHours())}:${pad(v.getMinutes())}`
    }
    const s = String(v).trim()
    // 24-hour HH:MM
    let m = s.match(/^(\d{1,2}):(\d{2})$/)
    if (m) return `${pad(m[1])}:${m[2]}`
    // H:MM AM/PM
    m = s.match(/^(\d{1,2}):(\d{2})\s*(AM|PM|am|pm)$/)
    if (m) {
      let h = parseInt(m[1], 10)
      const min = m[2]
      const isPm = m[3].toUpperCase() === 'PM'
      if (h === 12) h = isPm ? 12 : 0
      else if (isPm) h += 12
      return `${pad(h)}:${min}`
    }
    // H AM/PM
    m = s.match(/^(\d{1,2})\s*(AM|PM|am|pm)$/)
    if (m) {
      let h = parseInt(m[1], 10)
      const isPm = m[2].toUpperCase() === 'PM'
      if (h === 12) h = isPm ? 12 : 0
      else if (isPm) h += 12
      return `${pad(h)}:00`
    }
    return null
  }, [])

  const parseHomeAway = useCallback((v) => {
    if (v == null) return false
    const s = String(v).trim().toLowerCase()
    if (s === '' || s === 'a' || s === 'away' || s === 'false' || s === '0') return false
    return true
  }, [])

  const parseScore = useCallback((v) => {
    if (v == null || v === '') return null
    const n = parseInt(String(v).trim(), 10)
    if (isNaN(n) || n < 0) return null
    return n
  }, [])

  // Fuzzy match: returns the best match, or null
  const fuzzyMatch = useCallback((query, items, getText) => {
    if (!query) return null
    const q = String(query).trim().toLowerCase().replace(/\s+/g, '')
    if (!q) return null
    let best = null
    let bestScore = 0
    for (const item of items) {
      const text = getText(item).toLowerCase().replace(/\s+/g, '')
      if (!text) continue
      let score = 0
      if (text === q) score = 100
      else if (text.startsWith(q)) score = 90
      else if (q.startsWith(text)) score = 80
      else if (text.includes(q)) score = 70
      else if (q.includes(text)) score = 60
      if (score > bestScore) {
        bestScore = score
        best = item
      }
    }
    return bestScore >= 60 ? best : null
  }, [])

  // --- Step 3: Build preview ---

  const buildPreview = () => {
    const out = rows.map((row, idx) => {
      const teamVal = mapping.team ? row[mapping.team] : null
      const eventVal = mapping.event ? row[mapping.event] : null
      const typeVal = mapping.game_type ? row[mapping.game_type] : null

      const team = teamVal
        ? fuzzyMatch(teamVal, teams, (t) => t.name)
        : defaultTeamId
        ? teams.find((t) => String(t.id) === defaultTeamId) || null
        : null
      const event = eventVal
        ? fuzzyMatch(eventVal, events, (e) => e.event_name)
        : defaultEventId
        ? events.find((e) => e.id === defaultEventId) || null
        : null
      const gameType = typeVal
        ? fuzzyMatch(typeVal, gameTypes, (g) => g.name)
        : null

      const dateRaw = mapping.date ? row[mapping.date] : ''
      const parsedDate = parseDate(dateRaw)
      const parsedTime = mapping.time ? parseTime(row[mapping.time]) : null
      const opponent = mapping.opponent ? String(row[mapping.opponent] || '').trim() : ''
      const isHome = mapping.is_home ? parseHomeAway(row[mapping.is_home]) : false
      const location = mapping.location ? String(row[mapping.location] || '').trim() : ''
      const ourScore = mapping.our_score ? parseScore(row[mapping.our_score]) : null
      const oppScore = mapping.opponent_score ? parseScore(row[mapping.opponent_score]) : null

      // Validate
      const errors = []
      if (!team) errors.push('No team')
      if (!parsedDate) errors.push('Bad date')

      return {
        idx,
        rawRow: row,
        teamId: team?.id || null,
        teamName: team?.name || (teamVal ? `(${teamVal})` : ''),
        eventId: event?.id || null,
        eventName: event?.event_name || (eventVal ? `(${eventVal})` : ''),
        gameTypeId: gameType?.id || null,
        gameTypeName: gameType?.name || '',
        date: parsedDate,
        dateRaw: String(dateRaw || ''),
        time: parsedTime,
        opponent,
        isHome,
        location,
        ourScore,
        oppScore,
        include: errors.length === 0,
        errors,
      }
    })
    setPreviewData(out)
    setStep('preview')
  }

  // Per-row update from override dropdown
  const updateRowField = (idx, field, value) => {
    setPreviewData((prev) =>
      prev.map((r) => {
        if (r.idx !== idx) return r
        const next = { ...r, [field]: value }
        if (field === 'teamId') {
          const t = teams.find((x) => x.id === value) || null
          next.teamName = t?.name || ''
        }
        if (field === 'eventId') {
          const e = events.find((x) => x.id === value) || null
          next.eventName = e?.event_name || ''
        }
        // Refresh errors
        const errors = []
        if (!next.teamId) errors.push('No team')
        if (!next.date) errors.push('Bad date')
        next.errors = errors
        return next
      })
    )
  }

  const toggleRow = (idx) => {
    setPreviewData((prev) =>
      prev.map((r) => (r.idx === idx ? { ...r, include: !r.include } : r))
    )
  }

  const selectAllValid = () => {
    setPreviewData((prev) =>
      prev.map((r) => ({ ...r, include: r.errors.length === 0 }))
    )
  }

  // --- Step 4: Import ---

  const runImport = async () => {
    const valid = previewData.filter(
      (r) => r.include && r.teamId && r.date
    )
    if (valid.length === 0) {
      alert('Nothing to import.')
      return
    }
    setImporting(true)

    const payload = valid.map((r) => ({
      team_id: r.teamId,
      event_id: r.eventId || null,
      game_date: r.date,
      game_time: r.time || null,
      timezone: r.time ? 'America/New_York' : null,
      opponent: r.opponent || '',
      is_home: r.isHome,
      location: r.location || null,
      game_type_id: r.gameTypeId || null,
      our_score: r.ourScore,
      opponent_score: r.oppScore,
      last_modified_by: session?.user?.id || null,
    }))

    // Insert in batches of 50
    let inserted = 0
    const errors = []
    for (let i = 0; i < payload.length; i += 50) {
      const batch = payload.slice(i, i + 50)
      const { error } = await supabase.from('games').insert(batch)
      if (error) {
        errors.push(error.message)
      } else {
        inserted += batch.length
      }
    }

    setResults({
      inserted,
      skipped: previewData.length - inserted,
      errors,
    })
    setImporting(false)
    setStep('done')
  }

  const counts = useMemo(() => {
    const total = previewData.length
    const valid = previewData.filter((r) => r.errors.length === 0).length
    const selected = previewData.filter((r) => r.include).length
    return { total, valid, selected }
  }, [previewData])

  // --- Render ---

  return (
    <AdminLayout session={session} title="Import Games">
      <Link
        to="/admin"
        className="text-sm text-blue-600 hover:underline mb-3 inline-block"
      >
        ← Back to Admin
      </Link>

      {/* Step indicator */}
      <div className="flex gap-2 text-xs mb-4">
        {['upload', 'map', 'preview', 'done'].map((s, i) => (
          <div
            key={s}
            className={`px-3 py-1 rounded-full ${
              step === s
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500'
            }`}
          >
            {i + 1}. {s.charAt(0).toUpperCase() + s.slice(1)}
          </div>
        ))}
      </div>

      {/* Step 1: Upload */}
      {step === 'upload' && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold mb-2">Upload schedule file</h2>
          <p className="text-sm text-gray-600 mb-4">
            Accepts .xlsx, .xls, or .csv. Your file can include any of these
            columns: <strong>Team</strong>, <strong>Date</strong> (required),
            Opponent, Time, Home/Away, Location, Event, Game Type, Our Score,
            Opp Score. Column names are auto-detected; you can re-map in the
            next step.
          </p>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleFile}
            className="block"
          />
          <p className="text-xs text-gray-500 mt-3">
            If your file is for a single team and doesn't have a Team column,
            you'll pick a default team in the next step.
          </p>
        </div>
      )}

      {/* Step 2: Map columns */}
      {step === 'map' && (
        <div className="space-y-4">
          <div className="bg-white rounded-lg shadow-md p-5">
            <h2 className="text-lg font-semibold mb-3">Map columns</h2>
            <p className="text-sm text-gray-600 mb-3">
              Auto-detected columns shown below. Change any mapping if needed.
              File has <strong>{rows.length}</strong> rows.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {GAME_FIELDS.map((f) => (
                <div key={f.key}>
                  <label className="block text-xs text-gray-600 mb-1">
                    {f.label}
                    {f.required && ' *'}
                  </label>
                  <select
                    value={mapping[f.key] || ''}
                    onChange={(e) => updateMapping(f.key, e.target.value)}
                    className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                  >
                    <option value="">— Not in file —</option>
                    {columns.map((c) => (
                      <option key={c} value={c}>
                        {c}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md p-5">
            <h2 className="text-lg font-semibold mb-3">Defaults</h2>
            <p className="text-sm text-gray-600 mb-3">
              Used for rows where the column is missing or unmatched.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Default Team
                </label>
                <select
                  value={defaultTeamId}
                  onChange={(e) => setDefaultTeamId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="">— None —</option>
                  {teams.map((t) => (
                    <option key={t.id} value={t.id}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs text-gray-600 mb-1">
                  Default Event (optional)
                </label>
                <select
                  value={defaultEventId}
                  onChange={(e) => setDefaultEventId(e.target.value)}
                  className="w-full px-2 py-1.5 border border-gray-300 rounded text-sm"
                >
                  <option value="">— None (standalone games) —</option>
                  {events.map((e) => (
                    <option key={e.id} value={e.id}>
                      {e.event_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep('upload')}
              className="text-gray-600 px-4 py-2 hover:bg-gray-100 rounded-lg text-sm"
            >
              ← Back
            </button>
            <button
              onClick={buildPreview}
              disabled={!mapping.date}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 text-sm font-medium"
            >
              Preview →
            </button>
          </div>
          {!mapping.date && (
            <p className="text-xs text-orange-600">
              A Date column is required. Pick one above.
            </p>
          )}
        </div>
      )}

      {/* Step 3: Preview */}
      {step === 'preview' && (
        <div className="space-y-3">
          <div className="bg-white rounded-lg shadow-md p-4 flex flex-wrap gap-4 items-center text-sm">
            <span>
              Total: <strong>{counts.total}</strong>
            </span>
            <span>
              Valid: <strong className="text-emerald-600">{counts.valid}</strong>
            </span>
            <span>
              Errors:{' '}
              <strong className="text-rose-600">
                {counts.total - counts.valid}
              </strong>
            </span>
            <span>
              Selected for import: <strong>{counts.selected}</strong>
            </span>
            <button
              onClick={selectAllValid}
              className="ml-auto text-xs text-blue-600 hover:underline"
            >
              Select all valid
            </button>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-2 py-2 text-left">Inc</th>
                  <th className="px-2 py-2 text-left">Date</th>
                  <th className="px-2 py-2 text-left">Team</th>
                  <th className="px-2 py-2 text-left">vs/at Opponent</th>
                  <th className="px-2 py-2 text-left">Event</th>
                  <th className="px-2 py-2 text-left">Type</th>
                  <th className="px-2 py-2 text-left">Issues</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {previewData.map((r) => (
                  <tr
                    key={r.idx}
                    className={r.errors.length > 0 ? 'bg-rose-50' : ''}
                  >
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={() => toggleRow(r.idx)}
                      />
                    </td>
                    <td className="px-2 py-1.5 whitespace-nowrap">
                      {r.date || (
                        <span className="text-rose-600">
                          {r.dateRaw || '(blank)'}
                        </span>
                      )}
                      {r.time && (
                        <span className="text-gray-500 ml-1">{r.time}</span>
                      )}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={r.teamId || ''}
                        onChange={(e) =>
                          updateRowField(
                            r.idx,
                            'teamId',
                            parseInt(e.target.value, 10) || null
                          )
                        }
                        className="text-xs px-1 py-0.5 border border-gray-300 rounded max-w-[140px]"
                      >
                        <option value="">— pick —</option>
                        {teams.map((t) => (
                          <option key={t.id} value={t.id}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <span className="text-xs text-gray-500">
                        {r.isHome ? 'vs' : '@'}
                      </span>{' '}
                      {r.opponent || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={r.eventId || ''}
                        onChange={(e) =>
                          updateRowField(r.idx, 'eventId', e.target.value || null)
                        }
                        className="text-xs px-1 py-0.5 border border-gray-300 rounded max-w-[140px]"
                      >
                        <option value="">— none —</option>
                        {events.map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.event_name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5">
                      <select
                        value={r.gameTypeId || ''}
                        onChange={(e) =>
                          updateRowField(
                            r.idx,
                            'gameTypeId',
                            parseInt(e.target.value, 10) || null
                          )
                        }
                        className="text-xs px-1 py-0.5 border border-gray-300 rounded max-w-[120px]"
                      >
                        <option value="">— auto —</option>
                        {gameTypes.map((g) => (
                          <option key={g.id} value={g.id}>
                            {g.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-2 py-1.5 text-xs text-rose-600">
                      {r.errors.join(', ')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex gap-2">
            <button
              onClick={() => setStep('map')}
              className="text-gray-600 px-4 py-2 hover:bg-gray-100 rounded-lg text-sm"
            >
              ← Back to mapping
            </button>
            <button
              onClick={runImport}
              disabled={counts.selected === 0 || importing}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 text-sm font-medium"
            >
              {importing
                ? 'Importing...'
                : `Import ${counts.selected} Game${counts.selected === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      )}

      {/* Step 4: Done */}
      {step === 'done' && results && (
        <div className="bg-white rounded-lg shadow-md p-6">
          <h2 className="text-lg font-semibold mb-3">Import complete</h2>
          <p className="text-sm">
            ✅ Inserted: <strong>{results.inserted}</strong>
            <br />
            ⏭ Skipped: <strong>{results.skipped}</strong>
          </p>
          {results.errors.length > 0 && (
            <div className="mt-3 bg-rose-50 p-3 rounded text-xs text-rose-700">
              <strong>Errors:</strong>
              <ul className="list-disc ml-5 mt-1">
                {results.errors.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </div>
          )}
          <div className="mt-4 flex gap-2">
            <button
              onClick={() => {
                setStep('upload')
                setRows([])
                setColumns([])
                setMapping({})
                setPreviewData([])
                setResults(null)
              }}
              className="bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 text-sm font-medium"
            >
              Import another file
            </button>
            <Link
              to="/admin"
              className="text-blue-600 px-4 py-2 hover:bg-blue-50 rounded-lg text-sm"
            >
              Back to admin
            </Link>
          </div>
        </div>
      )}
    </AdminLayout>
  )
}

// Helpers
function pad(n) {
  return String(n).padStart(2, '0')
}
function formatDateISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
