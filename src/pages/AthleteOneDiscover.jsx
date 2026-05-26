import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'
import { getCurrentClubId } from '../lib/club'
import { getActiveSeasonId } from '../lib/season'

/**
 * AthleteOneDiscover — bulk team discovery and creation from AthleteOne.
 *
 * Route: /admin/athleteone-discover
 *
 * Flow:
 *   1. Admin picks: AthleteOne competition (org_id), event_id, club_id,
 *      PitchSide program, PitchSide season.
 *   2. Click "Discover" — backend hits AthleteOne, parses the club schedule,
 *      returns every team for that club along with parsed age/gender and
 *      whether it already exists in PitchSide.
 *   3. Each team row is editable (name + age + gender) with a checkbox.
 *      Existing teams are flagged and their checkbox is disabled.
 *   4. Click "Create Selected Teams" — bulk-insert into the teams table
 *      with all AthleteOne IDs prefilled. New teams default to
 *      athleteone_sync_games = TRUE (so the schedule auto-populates), but
 *      that can be flipped on the team's detail page later.
 *
 * Known AthleteOne competition IDs (we hardcode these since they don't change
 * and there's no obvious endpoint to enumerate them):
 *   9  = ECNL Girls
 *   12 = ECNL Boys
 *   13 = ECNL RL Girls
 *   16 = ECNL RL Boys
 */
const COMPETITIONS = [
  { org_id: 9, label: 'ECNL Girls', gender: 'Girls', default_event_id: '3931' },
  { org_id: 12, label: 'ECNL Boys', gender: 'Boys', default_event_id: '3887' },
  { org_id: 13, label: 'ECNL RL Girls', gender: 'Girls', default_event_id: '3951' },
  { org_id: 16, label: 'ECNL RL Boys', gender: 'Boys', default_event_id: '3899' },
]

export default function AthleteOneDiscover({ session }) {
  // Form / config state
  const [orgId, setOrgId] = useState(9) // ECNL Girls default
  const [eventId, setEventId] = useState('3931') // 2025-26 ECNL Girls default
  const [clubIdInput, setClubIdInput] = useState('437') // Ohio Premier default
  const [seasonId, setSeasonId] = useState(null)
  const [programId, setProgramId] = useState('')
  const [syncGamesDefault, setSyncGamesDefault] = useState(true)

  // Lookups loaded from DB
  const [seasons, setSeasons] = useState([])
  const [programs, setPrograms] = useState([])
  const [ageGroups, setAgeGroups] = useState([])
  const [lookupsLoaded, setLookupsLoaded] = useState(false)

  // Discovery results / UI state
  const [teams, setTeams] = useState([]) // {athleteone_team_id, athleteone_name, parsed, already_exists, ui:{...}}
  const [discovering, setDiscovering] = useState(false)
  const [error, setError] = useState(null)
  const [didDiscover, setDidDiscover] = useState(false)

  // Bulk create state
  const [creating, setCreating] = useState(false)
  const [createResult, setCreateResult] = useState(null)

  // Auto-sync state — tracks progress through the per-team ingest loop that
  // runs immediately after bulk-create. We sync sequentially (not in parallel)
  // so AthleteOne isn't hammered and the user sees clear progress.
  const [syncProgress, setSyncProgress] = useState(null)

  useEffect(() => {
    loadLookups()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadLookups = async () => {
    const [activeSeasonId, seasonsRes, programsRes, ageGroupsRes] =
      await Promise.all([
        getActiveSeasonId(),
        supabase
          .from('seasons')
          .select('id, name, start_date')
          .order('start_date', { ascending: false, nullsFirst: false }),
        supabase
          .from('programs')
          .select('id, name')
          .order('sort_order', { ascending: true, nullsFirst: false }),
        supabase
          .from('age_groups')
          .select('id, name')
          .order('sort_order', { ascending: true, nullsFirst: false }),
      ])

    setSeasons(seasonsRes.data || [])
    setPrograms(programsRes.data || [])
    setAgeGroups(ageGroupsRes.data || [])
    setSeasonId(activeSeasonId)

    // Default program guess based on initial competition
    const initialProgram = guessProgramForOrg(orgId, programsRes.data || [])
    if (initialProgram) setProgramId(String(initialProgram.id))

    setLookupsLoaded(true)
  }

  // When the AthleteOne competition changes, also (a) update the eventId to
  // the known default for that competition (or clear it if unknown — admin
  // must look it up on theecnl.com), and (b) re-guess the matching PitchSide
  // program so the admin doesn't have to repick.
  const handleCompetitionChange = (newOrgId) => {
    const num = parseInt(newOrgId, 10)
    setOrgId(num)
    const comp = COMPETITIONS.find((c) => c.org_id === num)
    setEventId(comp?.default_event_id || '')
    // Also clear any prior discovery results — they were for the old comp.
    setTeams([])
    setError(null)
    setDidDiscover(false)
    const guess = guessProgramForOrg(num, programs)
    if (guess) setProgramId(String(guess.id))
  }

  const ageGroupByName = useMemo(() => {
    const map = new Map()
    for (const ag of ageGroups) {
      map.set(ag.name.toUpperCase(), ag)
    }
    return map
  }, [ageGroups])

  const competition = COMPETITIONS.find((c) => c.org_id === orgId)

  const handleDiscover = async (e) => {
    if (e) e.preventDefault()
    setError(null)
    setTeams([])
    setCreateResult(null)
    setDidDiscover(false)

    if (!eventId || !clubIdInput) {
      setError('Event ID and Club ID are required.')
      return
    }

    setDiscovering(true)
    try {
      const { data: sessData } = await supabase.auth.getSession()
      const token = sessData?.session?.access_token
      if (!token) {
        setError('Not authenticated — please sign in again.')
        setDiscovering(false)
        return
      }
      const params = new URLSearchParams({
        eventId: String(eventId),
        clubId: String(clubIdInput),
        orgId: String(orgId),
      })
      const r = await fetch(
        `/api/discover-athleteone-club-teams?${params.toString()}`,
        { headers: { Authorization: `Bearer ${token}` } }
      )
      const data = await r.json().catch(() => ({}))
      if (!r.ok) {
        setError(data?.error || `Discovery failed (HTTP ${r.status}).`)
        setDiscovering(false)
        return
      }

      // Initialize per-team UI state with auto-suggested edits.
      const initialized = (data.teams || []).map((t) => {
        const suggestedAge = t.parsed?.suggested_age_label
        const matchedAge = suggestedAge
          ? ageGroupByName.get(suggestedAge.toUpperCase())
          : null
        return {
          ...t,
          ui: {
            selected: !t.already_exists, // existing teams skipped by default
            name: t.parsed?.suggested_pitchside_name || t.athleteone_name,
            age_group_id: matchedAge ? matchedAge.id : null,
            gender: t.parsed?.gender || competition?.gender || 'Girls',
          },
        }
      })
      setTeams(initialized)
      setDidDiscover(true)
    } catch (err) {
      setError(err.message || 'Discovery failed.')
    } finally {
      setDiscovering(false)
    }
  }

  const updateTeam = (teamId, patch) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.athleteone_team_id === teamId
          ? { ...t, ui: { ...t.ui, ...patch } }
          : t
      )
    )
  }

  const toggleAllNew = (selected) => {
    setTeams((prev) =>
      prev.map((t) =>
        t.already_exists
          ? t
          : { ...t, ui: { ...t.ui, selected: selected } }
      )
    )
  }

  const handleCreate = async () => {
    setCreateResult(null)
    const toCreate = teams.filter((t) => t.ui.selected && !t.already_exists)
    if (toCreate.length === 0) {
      setCreateResult({ kind: 'warn', text: 'Nothing selected to create.' })
      return
    }
    if (!seasonId) {
      setCreateResult({ kind: 'error', text: 'Pick a season first.' })
      return
    }
    if (!programId) {
      setCreateResult({ kind: 'error', text: 'Pick a program first.' })
      return
    }
    // Validate each team has an age group set
    const missingAge = toCreate.filter((t) => !t.ui.age_group_id)
    if (missingAge.length > 0) {
      setCreateResult({
        kind: 'error',
        text: `${missingAge.length} team(s) missing an age group. Pick one in each row before creating.`,
      })
      return
    }

    setCreating(true)
    try {
      const clubIdLocal = await getCurrentClubId()

      // Defense-in-depth: even though the discover endpoint marks teams
      // already_exists=true, that check can fail-soft (returning null) if the
      // teams-table lookup errors. Re-check immediately before insert so we
      // never hit the (club_id, season_id, slug) unique constraint.
      //
      // Two collisions to guard against:
      //   1. SAME athleteone_team_id already in DB for this org/event/club
      //   2. SAME (club_id, season_id, slug) — e.g. another competition's
      //      U13 Girls team produced the same generated name
      const aoTeamIds = toCreate
        .map((t) => parseInt(t.athleteone_team_id, 10))
        .filter(Number.isFinite)
      const proposedSlugs = toCreate.map((t) => slugify(t.ui.name))

      const [byAo, bySlug] = await Promise.all([
        supabase
          .from('teams')
          .select('athleteone_team_id')
          .eq('athleteone_org_id', orgId)
          .eq('athleteone_event_id', parseInt(eventId, 10))
          .eq('athleteone_club_id', parseInt(clubIdInput, 10))
          .in('athleteone_team_id', aoTeamIds),
        supabase
          .from('teams')
          .select('slug')
          .eq('club_id', clubIdLocal)
          .eq('season_id', seasonId)
          .in('slug', proposedSlugs),
      ])

      const aoIdsInDb = new Set(
        (byAo.data || []).map((r) => r.athleteone_team_id)
      )
      const slugsInDb = new Set((bySlug.data || []).map((r) => r.slug))

      const reallyToCreate = toCreate.filter((t) => {
        const aid = parseInt(t.athleteone_team_id, 10)
        if (aoIdsInDb.has(aid)) return false
        if (slugsInDb.has(slugify(t.ui.name))) return false
        return true
      })

      const skippedCount = toCreate.length - reallyToCreate.length

      if (reallyToCreate.length === 0) {
        setCreateResult({
          kind: 'warn',
          text:
            'All selected teams already exist in the database. ' +
            'Click Discover Teams again to refresh the view.',
        })
        setCreating(false)
        await handleDiscover()
        return
      }

      const rows = reallyToCreate.map((t) => ({
        club_id: clubIdLocal,
        season_id: seasonId,
        program_id: parseInt(programId, 10),
        age_group_id: t.ui.age_group_id,
        gender: t.ui.gender,
        name: t.ui.name,
        slug: slugify(t.ui.name),
        athleteone_org_id: orgId,
        athleteone_event_id: parseInt(eventId, 10),
        athleteone_club_id: parseInt(clubIdInput, 10),
        athleteone_team_id: parseInt(t.athleteone_team_id, 10),
        athleteone_sync_games: syncGamesDefault,
      }))

      const { data: created, error: insertErr } = await supabase
        .from('teams')
        .insert(rows)
        .select('id, name, slug, athleteone_team_id')

      if (insertErr) {
        setCreateResult({
          kind: 'error',
          text: insertErr.message,
        })
        setCreating(false)
        return
      }

      // === Auto-sync each newly created team ===
      // Sequential (not parallel) to avoid hammering AthleteOne and to give
      // the user clear "syncing X of N" progress. Each call may take 2-5 sec.
      const newTeams = created || []
      setSyncProgress({
        current: 0,
        total: newTeams.length,
        teamName: '',
        results: [],
        done: false,
      })

      const { data: sessData } = await supabase.auth.getSession()
      const token = sessData?.session?.access_token

      const syncResults = []
      for (let i = 0; i < newTeams.length; i++) {
        const t = newTeams[i]
        setSyncProgress({
          current: i + 1,
          total: newTeams.length,
          teamName: t.name,
          results: syncResults.slice(),
          done: false,
        })

        try {
          const r = await fetch(
            `/api/ingest-athleteone?teamId=${t.id}&commit=true`,
            {
              headers: token ? { Authorization: `Bearer ${token}` } : {},
            }
          )
          const data = await r.json().catch(() => ({}))
          const result = (data.results || [])[0]
          if (r.ok && result && !result.error) {
            const c = result.committed || {}
            syncResults.push({
              team_id: t.id,
              name: t.name,
              success: true,
              players: c.players_upserted ?? 0,
              staff: c.staff_upserted ?? 0,
              games:
                typeof c.games === 'object'
                  ? c.games.upserted ?? c.games.processed ?? '—'
                  : c.games || '—',
            })
          } else {
            syncResults.push({
              team_id: t.id,
              name: t.name,
              success: false,
              error:
                result?.error ||
                data?.error ||
                `HTTP ${r.status}`,
            })
          }
        } catch (err) {
          syncResults.push({
            team_id: t.id,
            name: t.name,
            success: false,
            error: err.message || 'Network error',
          })
        }
      }

      setSyncProgress({
        current: newTeams.length,
        total: newTeams.length,
        teamName: '',
        results: syncResults,
        done: true,
      })

      const successCount = syncResults.filter((r) => r.success).length
      const skippedSuffix =
        skippedCount > 0
          ? ` Skipped ${skippedCount} already in DB.`
          : ''
      setCreateResult({
        kind: 'success',
        text: `Created ${created.length} team${created.length === 1 ? '' : 's'}. Synced ${successCount} of ${newTeams.length}.${skippedSuffix}`,
        created: created,
        syncResults: syncResults,
      })

      // Refresh discovery so the just-created teams flip to "Already exists"
      await handleDiscover()
    } catch (err) {
      setCreateResult({
        kind: 'error',
        text: err.message || 'Bulk create failed.',
      })
    } finally {
      setCreating(false)
    }
  }

  // Counts for the summary card above the table
  const counts = useMemo(() => {
    const total = teams.length
    const existing = teams.filter((t) => t.already_exists).length
    const selectedNew = teams.filter(
      (t) => t.ui?.selected && !t.already_exists
    ).length
    return { total, existing, selectedNew, newCount: total - existing }
  }, [teams])

  return (
    <AdminLayout session={session} title="Discover Teams from AthleteOne">
      <Link
        to="/admin/teams"
        className="text-blue-600 hover:text-blue-800 mb-4 inline-block"
      >
        ← Back to Teams
      </Link>

      <div className="bg-white rounded-lg shadow-md p-5 mb-6">
        <h2 className="text-lg font-semibold mb-1">Find teams to import</h2>
        <p className="text-sm text-gray-500 mb-4">
          Pulls every team for your club from AthleteOne. You pick which ones
          to create in PitchSide — IDs are prefilled so sync works on day one.
        </p>

        <form
          onSubmit={handleDiscover}
          className="grid grid-cols-1 sm:grid-cols-2 gap-4"
        >
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              AthleteOne Competition
            </label>
            <select
              value={orgId}
              onChange={(e) => handleCompetitionChange(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {COMPETITIONS.map((c) => (
                <option key={c.org_id} value={c.org_id}>
                  {c.label} (org_id={c.org_id})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              AthleteOne Event ID
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={eventId}
              onChange={(e) => setEventId(e.target.value.replace(/[^\d]/g, ''))}
              className={`w-full px-3 py-2 border rounded-lg text-sm ${
                !eventId
                  ? 'border-amber-300 bg-amber-50'
                  : 'border-gray-300'
              }`}
            />
            {!eventId ? (
              <p className="text-xs text-amber-700 mt-0.5">
                Event ID required. Find it on theecnl.com → Standings →{' '}
                {competition?.label} → 2025-26 (the number in the URL).
              </p>
            ) : (
              <p className="text-xs text-gray-400 mt-0.5">
                Season-specific. 2025-26 known: ECNL Girls={' '}
                <code>3931</code>, ECNL Boys=<code>3887</code>, ECNL RL Girls={' '}
                <code>3951</code> (or <code>3939</code> for GLA conference),
                ECNL RL Boys=<code>3899</code>.
              </p>
            )}
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              AthleteOne Club ID
            </label>
            <input
              type="text"
              inputMode="numeric"
              value={clubIdInput}
              onChange={(e) =>
                setClubIdInput(e.target.value.replace(/[^\d]/g, ''))
              }
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            />
            <p className="text-xs text-gray-400 mt-0.5">
              <code>437</code> = Ohio Premier.
            </p>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              PitchSide Season
            </label>
            <select
              value={seasonId || ''}
              onChange={(e) => setSeasonId(parseInt(e.target.value, 10))}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              {seasons.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm text-gray-600 mb-1">
              PitchSide Program
            </label>
            <select
              value={programId}
              onChange={(e) => setProgramId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
            >
              <option value="">-- Pick a program --</option>
              {programs.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={syncGamesDefault}
                onChange={(e) => setSyncGamesDefault(e.target.checked)}
                className="mt-1 h-4 w-4 text-blue-600 rounded"
              />
              <span>
                <span className="font-medium">
                  Enable game sync for new teams
                </span>
                <span className="block text-xs text-gray-500">
                  Default ON for brand-new teams (no manual games to preserve).
                  Flip per-team later if needed.
                </span>
              </span>
            </label>
          </div>
          <div className="sm:col-span-2">
            <button
              type="submit"
              disabled={discovering || !lookupsLoaded}
              className={`w-full sm:w-auto px-5 py-2 rounded-lg text-sm font-medium ${
                discovering || !lookupsLoaded
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              {discovering ? 'Discovering…' : 'Discover Teams'}
            </button>
          </div>
        </form>

        {error && (
          <div className="mt-4 bg-red-50 border border-red-200 text-red-700 rounded p-3 text-sm">
            {error}
          </div>
        )}
      </div>

      {didDiscover && teams.length === 0 && !discovering && (
        <div className="bg-white rounded-lg shadow-md p-8 text-center text-gray-500">
          No teams found for this club at this event.
          <div className="text-xs text-gray-400 mt-2">
            Double-check the Event ID and Club ID. The Event ID changes
            per season per competition.
          </div>
        </div>
      )}

      {teams.length > 0 && (
        <>
          <div className="bg-white rounded-lg shadow-md p-4 mb-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-700">
              Found <span className="font-semibold">{counts.total}</span>{' '}
              {counts.total === 1 ? 'team' : 'teams'} •{' '}
              <span className="text-emerald-700 font-medium">
                {counts.newCount} new
              </span>{' '}
              •{' '}
              <span className="text-gray-500">
                {counts.existing} already in PitchSide
              </span>
              {' • '}
              <span className="font-medium">
                {counts.selectedNew} selected
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => toggleAllNew(true)}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                Select all new
              </button>
              <button
                type="button"
                onClick={() => toggleAllNew(false)}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 bg-white hover:bg-gray-50"
              >
                Deselect all
              </button>
            </div>
          </div>

          <div className="bg-white rounded-lg shadow-md overflow-x-auto mb-4">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b border-gray-200">
                <tr>
                  <th className="px-3 py-2 text-left w-8"></th>
                  <th className="px-3 py-2 text-left">AthleteOne</th>
                  <th className="px-3 py-2 text-left">PitchSide Name</th>
                  <th className="px-3 py-2 text-left">Age</th>
                  <th className="px-3 py-2 text-left">Gender</th>
                  <th className="px-3 py-2 text-left">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {teams.map((t) => (
                  <TeamRow
                    key={t.athleteone_team_id}
                    team={t}
                    ageGroups={ageGroups}
                    onChange={(patch) =>
                      updateTeam(t.athleteone_team_id, patch)
                    }
                  />
                ))}
              </tbody>
            </table>
          </div>

          <div className="bg-white rounded-lg shadow-md p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="text-sm text-gray-600">
              Ready to create <span className="font-semibold">{counts.selectedNew}</span>{' '}
              team{counts.selectedNew === 1 ? '' : 's'} in PitchSide.
            </div>
            <button
              type="button"
              onClick={handleCreate}
              disabled={creating || counts.selectedNew === 0}
              className={`px-5 py-2 rounded-lg text-sm font-medium ${
                creating || counts.selectedNew === 0
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-emerald-600 text-white hover:bg-emerald-700'
              }`}
            >
              {creating ? 'Creating…' : 'Create Selected Teams'}
            </button>
          </div>

          {/* In-flight sync progress bar — shown while the per-team ingest
              loop runs after bulk-create. */}
          {syncProgress && !syncProgress.done && (
            <div className="mt-3 rounded p-3 text-sm bg-blue-50 border border-blue-200 text-blue-800">
              <div className="font-medium">
                Syncing {syncProgress.current} of {syncProgress.total}
                {syncProgress.teamName ? `: ${syncProgress.teamName}` : '…'}
              </div>
              <div className="mt-2 h-2 w-full bg-blue-100 rounded overflow-hidden">
                <div
                  className="h-full bg-blue-500 transition-all"
                  style={{
                    width:
                      syncProgress.total > 0
                        ? `${(syncProgress.current / syncProgress.total) * 100}%`
                        : '0%',
                  }}
                />
              </div>
            </div>
          )}

          {createResult && (
            <div
              className={`mt-3 rounded p-3 text-sm ${
                createResult.kind === 'success'
                  ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
                  : createResult.kind === 'warn'
                  ? 'bg-amber-50 border border-amber-200 text-amber-800'
                  : 'bg-red-50 border border-red-200 text-red-800'
              }`}
            >
              {createResult.text}
              {createResult.created && createResult.created.length > 0 && (
                <ul className="mt-2 text-xs space-y-1">
                  {createResult.created.map((c) => {
                    const sr = (createResult.syncResults || []).find(
                      (r) => r.team_id === c.id
                    )
                    return (
                      <li key={c.id} className="flex items-start gap-2">
                        <span className="mt-0.5">
                          {sr
                            ? sr.success
                              ? '✓'
                              : '✗'
                            : '•'}
                        </span>
                        <div className="flex-1">
                          <Link
                            to={`/admin/teams/${c.id}`}
                            className="text-blue-600 hover:underline"
                          >
                            {c.name}
                          </Link>{' '}
                          <span className="text-gray-500">
                            (AthleteOne #{c.athleteone_team_id})
                          </span>
                          {sr && sr.success && (
                            <span className="ml-2 text-gray-600">
                              {sr.players} players · {sr.staff} staff
                              {typeof sr.games === 'number'
                                ? ` · ${sr.games} games`
                                : sr.games && sr.games !== '—'
                                ? ` · ${sr.games}`
                                : ''}
                            </span>
                          )}
                          {sr && !sr.success && (
                            <span className="ml-2 text-red-700">
                              sync failed: {sr.error}
                            </span>
                          )}
                        </div>
                      </li>
                    )
                  })}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </AdminLayout>
  )
}

/**
 * One row in the discovery results table. Inputs are tightly bound: parent
 * owns the state, this component only renders + signals changes via onChange.
 */
function TeamRow({ team, ageGroups, onChange }) {
  const ui = team.ui || {}
  const existing = !!team.already_exists
  const checkboxDisabled = existing

  return (
    <tr className={existing ? 'bg-gray-50/50' : ''}>
      <td className="px-3 py-2 align-middle">
        <input
          type="checkbox"
          checked={!!ui.selected}
          disabled={checkboxDisabled}
          onChange={(e) => onChange({ selected: e.target.checked })}
          className="h-4 w-4 text-blue-600 rounded"
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <div className="text-sm text-gray-900">{team.athleteone_name}</div>
        <div className="text-[10px] text-gray-400 mt-0.5 font-mono">
          team_id #{team.athleteone_team_id}
          {team.parsed?.mixed_roster && (
            <span className="ml-2 inline-block px-1.5 py-0 rounded bg-amber-100 text-amber-700 text-[10px]">
              mixed roster
            </span>
          )}
        </div>
      </td>
      <td className="px-3 py-2 align-middle">
        <input
          type="text"
          value={ui.name || ''}
          disabled={existing}
          onChange={(e) => onChange({ name: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-500"
        />
      </td>
      <td className="px-3 py-2 align-middle">
        <select
          value={ui.age_group_id || ''}
          disabled={existing}
          onChange={(e) =>
            onChange({
              age_group_id: e.target.value ? parseInt(e.target.value, 10) : null,
            })
          }
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-500"
        >
          <option value="">—</option>
          {ageGroups.map((ag) => (
            <option key={ag.id} value={ag.id}>
              {ag.name}
            </option>
          ))}
        </select>
      </td>
      <td className="px-3 py-2 align-middle">
        <select
          value={ui.gender || ''}
          disabled={existing}
          onChange={(e) => onChange({ gender: e.target.value })}
          className="w-full px-2 py-1 border border-gray-300 rounded text-sm disabled:bg-gray-100 disabled:text-gray-500"
        >
          <option value="Girls">Girls</option>
          <option value="Boys">Boys</option>
        </select>
      </td>
      <td className="px-3 py-2 align-middle">
        {existing ? (
          <Link
            to={`/admin/teams/${team.pitchside_team?.id}`}
            className="inline-flex items-center gap-1 text-xs bg-gray-100 text-gray-700 rounded px-2 py-1 hover:bg-gray-200"
          >
            ✓ Already in PitchSide
            <span className="text-gray-400">→</span>
          </Link>
        ) : (
          <span className="inline-block text-xs bg-emerald-100 text-emerald-700 rounded px-2 py-1">
            New
          </span>
        )}
      </td>
    </tr>
  )
}

/**
 * guessProgramForOrg — best-effort mapping from AthleteOne competition to a
 * PitchSide program. Looks for "RL" in the program name when the competition
 * is an RL one; otherwise prefers the program whose name doesn't contain RL.
 */
function guessProgramForOrg(orgId, programs) {
  if (!programs || programs.length === 0) return null
  const wantRL = orgId === 13 || orgId === 16
  const candidates = programs.filter((p) => {
    const n = (p.name || '').toLowerCase()
    return wantRL ? n.includes('rl') : !n.includes('rl')
  })
  // Prefer "ECNL" in the name
  const ecnlMatch = candidates.find((p) =>
    (p.name || '').toUpperCase().includes('ECNL')
  )
  return ecnlMatch || candidates[0] || programs[0]
}

/**
 * slugify — turn a team name like "U16 Girls ECNL" into "u16-girls-ecnl".
 * Used for the public team page URL: /t/<slug>. Uniqueness is enforced by
 * the DB (unique on (slug, season_id)); on collision the insert fails and
 * the admin can rename + retry.
 */
function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
}
