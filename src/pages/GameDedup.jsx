import { useEffect, useMemo, useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import AdminLayout from '../components/AdminLayout'

/**
 * Game Dedup Tool — /admin/teams/:teamId/game-dedup
 *
 * Lets the admin reconcile manually-entered games (no athleteone_game_id) with
 * the games AthleteOne has on file for the team. The goal is to LINK rather
 * than recreate, so attendance records on existing manual games are preserved.
 *
 * Workflow:
 *   1. Same-date matches are auto-suggested (opponent similarity tiebreaks).
 *   2. Admin clicks "Link" → confirmation dialog shows attendance counts →
 *      execute: (a) if an AthleteOne row with same GM# already exists, move
 *      its attendance to the manual game's row, then delete the empty AO row;
 *      (b) set the manual game's athleteone_game_id and source='athleteone'.
 *   3. Admin clicks "Keep separate" → set manual_override=TRUE on the manual
 *      game so future syncs ignore it (and it stays as its own record).
 *
 * NEVER deletes a row that has attendance — moves attendance first.
 */
export default function GameDedup() {
  const { teamId } = useParams()

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [team, setTeam] = useState(null)
  const [manualGames, setManualGames] = useState([])
  const [aoGames, setAoGames] = useState([])
  const [attendanceCounts, setAttendanceCounts] = useState({})
  const [existingAoRowByGmId, setExistingAoRowByGmId] = useState({})
  const [aoAttendanceCounts, setAoAttendanceCounts] = useState({})
  const [confirmDialog, setConfirmDialog] = useState(null)
  const [actionInProgress, setActionInProgress] = useState(false)
  const [toast, setToast] = useState(null)

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [teamId])

  async function loadData() {
    setLoading(true)
    setError(null)
    try {
      // 1. Team
      const { data: teamData, error: teamErr } = await supabase
        .from('teams')
        .select(
          'id, name, athleteone_team_id, athleteone_event_id, athleteone_club_id, athleteone_sync_games'
        )
        .eq('id', teamId)
        .maybeSingle()
      if (teamErr) throw new Error(teamErr.message)
      if (!teamData) throw new Error('Team not found')
      if (!teamData.athleteone_team_id) {
        throw new Error(
          'This team has no AthleteOne ID configured. Set one in Team Detail before using dedup.'
        )
      }
      setTeam(teamData)

      // 2. Manual games (no athleteone_game_id) for this team
      const { data: manualData, error: manualErr } = await supabase
        .from('games')
        .select(
          'id, game_date, game_time, opponent, is_home, location, source, manual_override, athleteone_game_id'
        )
        .eq('team_id', teamId)
        .is('athleteone_game_id', null)
        .order('game_date', { ascending: true })
      if (manualErr) throw new Error(manualErr.message)
      setManualGames(manualData || [])

      // 3. Already-linked games for this team (rows with athleteone_game_id set)
      //    — needed to detect duplicates that may exist if sync_games was on.
      const { data: linkedData } = await supabase
        .from('games')
        .select('id, athleteone_game_id')
        .eq('team_id', teamId)
        .not('athleteone_game_id', 'is', null)
      const linkedByGmId = {}
      for (const r of linkedData || []) {
        linkedByGmId[r.athleteone_game_id] = r
      }
      setExistingAoRowByGmId(linkedByGmId)

      // 4. Attendance counts for all relevant games (manual + linked)
      const allGameIds = [
        ...(manualData || []).map((g) => g.id),
        ...(linkedData || []).map((g) => g.id),
      ]
      let manualCounts = {}
      let aoCounts = {}
      if (allGameIds.length > 0) {
        const { data: attData } = await supabase
          .from('attendance')
          .select('game_id')
          .in('game_id', allGameIds)
        const all = {}
        for (const a of attData || []) {
          all[a.game_id] = (all[a.game_id] || 0) + 1
        }
        for (const g of manualData || []) {
          manualCounts[g.id] = all[g.id] || 0
        }
        for (const g of linkedData || []) {
          aoCounts[g.athleteone_game_id] = all[g.id] || 0
        }
      }
      setAttendanceCounts(manualCounts)
      setAoAttendanceCounts(aoCounts)

      // 5. AthleteOne-side games via the API
      const { data: sessData } = await supabase.auth.getSession()
      const token = sessData?.session?.access_token
      const r = await fetch(`/api/get-athleteone-games?teamId=${teamId}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      })
      const aoJson = await r.json().catch(() => ({}))
      if (!r.ok) {
        throw new Error(aoJson.error || `Failed to fetch AthleteOne games (HTTP ${r.status})`)
      }
      setAoGames(aoJson.games || [])
    } catch (err) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }

  // Compute auto-matches: same-date manual + AO game pairs, with opponent
  // similarity as a tiebreaker when multiple AO candidates exist on a date.
  const { suggested, unmatchedManual, unmatchedAo } = useMemo(() => {
    return computeMatches(manualGames, aoGames, existingAoRowByGmId)
  }, [manualGames, aoGames, existingAoRowByGmId])

  function openLinkDialog(manualGame, aoGame) {
    const manualAttendance = attendanceCounts[manualGame.id] || 0
    const existingAoRow = existingAoRowByGmId[aoGame.athleteone_game_id]
    const aoAttendance = existingAoRow
      ? aoAttendanceCounts[aoGame.athleteone_game_id] || 0
      : 0
    setConfirmDialog({
      kind: 'link',
      manualGame,
      aoGame,
      manualAttendance,
      existingAoRowId: existingAoRow?.id || null,
      aoAttendance,
    })
  }

  function openKeepSeparateDialog(manualGame) {
    setConfirmDialog({ kind: 'keep_separate', manualGame })
  }

  async function executeLink() {
    if (!confirmDialog || confirmDialog.kind !== 'link') return
    setActionInProgress(true)
    try {
      const { manualGame, aoGame, existingAoRowId } = confirmDialog

      // Step 1: if an AthleteOne row with this GM# already exists separately,
      // move its attendance to the manual game, then delete the empty AO row.
      if (existingAoRowId && existingAoRowId !== manualGame.id) {
        const { error: moveErr } = await supabase
          .from('attendance')
          .update({ game_id: manualGame.id })
          .eq('game_id', existingAoRowId)
        if (moveErr) throw new Error('Move attendance failed: ' + moveErr.message)

        const { error: delErr } = await supabase
          .from('games')
          .delete()
          .eq('id', existingAoRowId)
        if (delErr) throw new Error('Delete AO row failed: ' + delErr.message)
      }

      // Step 2: set the manual game's athleteone_game_id (and source).
      const { error: updErr } = await supabase
        .from('games')
        .update({
          athleteone_game_id: aoGame.athleteone_game_id,
          source: 'athleteone',
        })
        .eq('id', manualGame.id)
      if (updErr) throw new Error('Link failed: ' + updErr.message)

      setToast({
        kind: 'success',
        text: `Linked "${manualGame.opponent}" (${manualGame.game_date}) → AthleteOne #${aoGame.athleteone_game_id}`,
      })
      setConfirmDialog(null)
      await loadData()
    } catch (err) {
      setToast({ kind: 'error', text: err.message })
    } finally {
      setActionInProgress(false)
    }
  }

  async function executeKeepSeparate() {
    if (!confirmDialog || confirmDialog.kind !== 'keep_separate') return
    setActionInProgress(true)
    try {
      const { manualGame } = confirmDialog
      const { error: updErr } = await supabase
        .from('games')
        .update({ manual_override: true })
        .eq('id', manualGame.id)
      if (updErr) throw new Error(updErr.message)
      setToast({
        kind: 'success',
        text: `Marked "${manualGame.opponent}" as manual-only. Future syncs will leave it alone.`,
      })
      setConfirmDialog(null)
      await loadData()
    } catch (err) {
      setToast({ kind: 'error', text: err.message })
    } finally {
      setActionInProgress(false)
    }
  }

  if (loading) {
    return (
      <AdminLayout>
        <div className="text-gray-500">Loading dedup data…</div>
      </AdminLayout>
    )
  }

  if (error) {
    return (
      <AdminLayout>
        <div className="bg-red-50 border border-red-200 text-red-800 rounded p-4">
          <div className="font-medium">Couldn't load dedup data</div>
          <div className="text-sm mt-1">{error}</div>
          <div className="mt-3">
            <Link
              to={`/admin/teams/${teamId}`}
              className="text-blue-600 hover:underline text-sm"
            >
              ← Back to team
            </Link>
          </div>
        </div>
      </AdminLayout>
    )
  }

  return (
    <AdminLayout>
      <div className="mb-6">
        <Link
          to={`/admin/teams/${teamId}`}
          className="text-sm text-blue-600 hover:underline"
        >
          ← {team?.name || 'Team'}
        </Link>
        <h1 className="text-2xl font-semibold mt-2">Game Dedup</h1>
        <p className="text-sm text-gray-600 mt-1">
          Link your manually-entered games to their AthleteOne counterparts so
          future syncs update them in place. Attendance records on linked games
          are preserved.
        </p>
      </div>

      {toast && (
        <div
          className={`mb-4 rounded p-3 text-sm flex items-start justify-between gap-3 ${
            toast.kind === 'success'
              ? 'bg-emerald-50 border border-emerald-200 text-emerald-800'
              : 'bg-red-50 border border-red-200 text-red-800'
          }`}
        >
          <div>{toast.text}</div>
          <button
            onClick={() => setToast(null)}
            className="text-current opacity-60 hover:opacity-100"
          >
            ×
          </button>
        </div>
      )}

      {/* Summary card */}
      <div className="bg-white shadow-md rounded-lg p-4 mb-6">
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
          <StatBox label="Manual games" value={manualGames.length} />
          <StatBox label="AthleteOne games" value={aoGames.length} />
          <StatBox label="Suggested matches" value={suggested.length} />
          <StatBox
            label="Unmatched"
            value={unmatchedManual.length + unmatchedAo.length}
          />
        </div>
        {team && team.athleteone_sync_games && (
          <div className="mt-3 text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2">
            ⚠ Games sync is currently ENABLED for this team. Any unlinked manual
            games may be duplicated on the next sync. Consider toggling sync off
            in Team Detail until dedup is complete.
          </div>
        )}
      </div>

      {/* Suggested matches */}
      <Section
        title="Suggested matches"
        subtitle="Same-date pairs. Review each one and Link or Keep separate."
      >
        {suggested.length === 0 ? (
          <EmptyHint text="No same-date matches found. Manual and AthleteOne games may not overlap, or they've already been linked." />
        ) : (
          <div className="overflow-x-auto bg-white shadow-md rounded-lg">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                <tr>
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Manual game</th>
                  <th className="px-3 py-2">AthleteOne game</th>
                  <th className="px-3 py-2">Attendance</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {suggested.map(({ manual, ao, sameOpponent }) => (
                  <tr key={manual.id} className="border-t">
                    <td className="px-3 py-2 align-top whitespace-nowrap">
                      <div className="font-medium">{manual.game_date}</div>
                      <div className="text-xs text-gray-500">
                        {formatTime(manual.game_time)}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">
                        {manual.is_home ? 'vs' : '@'} {manual.opponent || '—'}
                      </div>
                      <div className="text-xs text-gray-500">
                        {manual.location || '(no location)'}
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top">
                      <div className="font-medium">
                        {ao.is_home ? 'vs' : '@'} {ao.opponent || '—'}
                        {!sameOpponent && (
                          <span
                            className="ml-2 text-xs text-amber-700 align-middle"
                            title="Opponent names differ — verify before linking"
                          >
                            ⚠
                          </span>
                        )}
                      </div>
                      <div className="text-xs text-gray-500">
                        {ao.location || '(no location)'}
                        {' · '}
                        <span className="text-gray-400">
                          GM#{ao.athleteone_game_id}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 align-top text-xs">
                      <span className="inline-block bg-blue-50 text-blue-700 rounded px-2 py-0.5">
                        {attendanceCounts[manual.id] || 0} on manual
                      </span>
                      {existingAoRowByGmId[ao.athleteone_game_id] && (
                        <span className="ml-1 inline-block bg-amber-50 text-amber-700 rounded px-2 py-0.5">
                          {aoAttendanceCounts[ao.athleteone_game_id] || 0} on AO
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 align-top text-right whitespace-nowrap">
                      <button
                        onClick={() => openLinkDialog(manual, ao)}
                        className="text-xs bg-emerald-600 text-white rounded px-2 py-1 hover:bg-emerald-700"
                      >
                        Link
                      </button>
                      <button
                        onClick={() => openKeepSeparateDialog(manual)}
                        className="ml-1 text-xs bg-white border border-gray-300 text-gray-700 rounded px-2 py-1 hover:bg-gray-50"
                      >
                        Keep separate
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>

      {/* Unmatched manual games */}
      <Section
        title={`Unmatched manual games (${unmatchedManual.length})`}
        subtitle="No same-date AthleteOne game found. These will stay as standalone records unless you find a match below."
      >
        {unmatchedManual.length === 0 ? (
          <EmptyHint text="All manual games have a same-date AthleteOne match." />
        ) : (
          <GameList
            games={unmatchedManual.map((g) => ({
              ...g,
              attendance: attendanceCounts[g.id] || 0,
            }))}
            kind="manual"
            onKeepSeparate={openKeepSeparateDialog}
          />
        )}
      </Section>

      {/* Unmatched AthleteOne games */}
      <Section
        title={`Unmatched AthleteOne games (${unmatchedAo.length})`}
        subtitle="No same-date manual game found. These will be created automatically on the next sync."
      >
        {unmatchedAo.length === 0 ? (
          <EmptyHint text="All AthleteOne games have a same-date manual match." />
        ) : (
          <GameList games={unmatchedAo} kind="ao" />
        )}
      </Section>

      {/* Confirmation dialog */}
      {confirmDialog && (
        <Dialog
          dialog={confirmDialog}
          actionInProgress={actionInProgress}
          onCancel={() => setConfirmDialog(null)}
          onConfirmLink={executeLink}
          onConfirmKeepSeparate={executeKeepSeparate}
        />
      )}
    </AdminLayout>
  )
}

// ---- subcomponents ------------------------------------------------

function StatBox({ label, value }) {
  return (
    <div className="bg-gray-50 rounded p-3">
      <div className="text-xs text-gray-500 uppercase tracking-wider">
        {label}
      </div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </div>
  )
}

function Section({ title, subtitle, children }) {
  return (
    <div className="mb-6">
      <div className="mb-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
      </div>
      {children}
    </div>
  )
}

function EmptyHint({ text }) {
  return (
    <div className="bg-white shadow-sm rounded-lg p-4 text-sm text-gray-500">
      {text}
    </div>
  )
}

function GameList({ games, kind, onKeepSeparate }) {
  return (
    <div className="overflow-x-auto bg-white shadow-md rounded-lg">
      <table className="min-w-full text-sm">
        <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
          <tr>
            <th className="px-3 py-2">Date</th>
            <th className="px-3 py-2">Opponent</th>
            <th className="px-3 py-2">Location</th>
            {kind === 'manual' && <th className="px-3 py-2">Attendance</th>}
            {kind === 'ao' && <th className="px-3 py-2">GM#</th>}
            {kind === 'manual' && (
              <th className="px-3 py-2 text-right">Action</th>
            )}
          </tr>
        </thead>
        <tbody>
          {games.map((g) => (
            <tr key={kind === 'ao' ? `ao-${g.athleteone_game_id}` : g.id} className="border-t">
              <td className="px-3 py-2 whitespace-nowrap">
                <div>{g.game_date}</div>
                <div className="text-xs text-gray-500">
                  {formatTime(g.game_time)}
                </div>
              </td>
              <td className="px-3 py-2">
                {g.is_home ? 'vs' : '@'} {g.opponent || '—'}
              </td>
              <td className="px-3 py-2 text-gray-600">
                {g.location || '(no location)'}
              </td>
              {kind === 'manual' && (
                <td className="px-3 py-2 text-xs">
                  <span className="inline-block bg-blue-50 text-blue-700 rounded px-2 py-0.5">
                    {g.attendance}
                  </span>
                </td>
              )}
              {kind === 'ao' && (
                <td className="px-3 py-2 text-xs text-gray-500">
                  {g.athleteone_game_id}
                </td>
              )}
              {kind === 'manual' && (
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {g.manual_override ? (
                    <span className="text-xs text-gray-500">
                      Marked manual-only
                    </span>
                  ) : (
                    <button
                      onClick={() => onKeepSeparate(g)}
                      className="text-xs bg-white border border-gray-300 text-gray-700 rounded px-2 py-1 hover:bg-gray-50"
                    >
                      Mark manual-only
                    </button>
                  )}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Dialog({
  dialog,
  actionInProgress,
  onCancel,
  onConfirmLink,
  onConfirmKeepSeparate,
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-5">
        {dialog.kind === 'link' && (
          <>
            <h3 className="text-lg font-semibold">Link this game?</h3>
            <p className="text-sm text-gray-600 mt-1">
              The manual game will be marked as AthleteOne-sourced and future
              syncs will update it in place.
            </p>
            <div className="mt-4 space-y-2 text-sm bg-gray-50 rounded p-3">
              <Row label="Date" value={dialog.manualGame.game_date} />
              <Row
                label="Manual"
                value={`${dialog.manualGame.is_home ? 'vs' : '@'} ${
                  dialog.manualGame.opponent || '—'
                }`}
              />
              <Row
                label="AthleteOne"
                value={`${dialog.aoGame.is_home ? 'vs' : '@'} ${
                  dialog.aoGame.opponent || '—'
                } (GM#${dialog.aoGame.athleteone_game_id})`}
              />
            </div>
            <div className="mt-3 text-sm bg-blue-50 border border-blue-200 rounded p-3 space-y-1">
              <div>
                <strong>{dialog.manualAttendance}</strong> attendance record
                {dialog.manualAttendance === 1 ? '' : 's'} on the manual game{' '}
                <span className="text-blue-700">will be preserved</span>.
              </div>
              {dialog.existingAoRowId && (
                <div>
                  <strong>{dialog.aoAttendance}</strong> attendance record
                  {dialog.aoAttendance === 1 ? '' : 's'} on the existing
                  AthleteOne row{' '}
                  <span className="text-blue-700">
                    will be moved to the manual game
                  </span>{' '}
                  before the duplicate row is removed.
                </div>
              )}
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={actionInProgress}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmLink}
                disabled={actionInProgress}
                className="px-3 py-1.5 text-sm bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50"
              >
                {actionInProgress ? 'Linking…' : 'Confirm Link'}
              </button>
            </div>
          </>
        )}
        {dialog.kind === 'keep_separate' && (
          <>
            <h3 className="text-lg font-semibold">Mark manual-only?</h3>
            <p className="text-sm text-gray-600 mt-1">
              This game will be flagged so future AthleteOne syncs will not
              touch it. Its attendance and details stay exactly as they are.
            </p>
            <div className="mt-4 text-sm bg-gray-50 rounded p-3">
              <Row label="Date" value={dialog.manualGame.game_date} />
              <Row
                label="Opponent"
                value={`${dialog.manualGame.is_home ? 'vs' : '@'} ${
                  dialog.manualGame.opponent || '—'
                }`}
              />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <button
                onClick={onCancel}
                disabled={actionInProgress}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded hover:bg-gray-50 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={onConfirmKeepSeparate}
                disabled={actionInProgress}
                className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              >
                {actionInProgress ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <span className="text-gray-500">{label}</span>
      <span className="text-gray-900 text-right">{value}</span>
    </div>
  )
}

// ---- helpers ------------------------------------------------------

function formatTime(t) {
  if (!t) return ''
  const [h, m] = String(t).split(':').map(Number)
  if (isNaN(h) || isNaN(m)) return t
  const ampm = h >= 12 ? 'PM' : 'AM'
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')} ${ampm}`
}

/**
 * For each manual game, find the best same-date AthleteOne match. When multiple
 * candidates exist on a date, opponent name similarity (Jaccard on words >2)
 * tie-breaks. Returns suggested pairs plus unmatched lists on each side.
 */
function computeMatches(manualGames, aoGames, existingAoRowByGmId) {
  const usedAo = new Set()
  const suggested = []
  const unmatchedManual = []

  // Skip AO games already linked to a row for this team (avoid suggesting a
  // game that's already linked somewhere — the linked row may still be in
  // manualGames if it was just linked, but defensive)
  const linkableAo = aoGames.filter(
    (a) =>
      a.athleteone_game_id != null &&
      !manualGames.some((m) => m.athleteone_game_id === a.athleteone_game_id)
  )

  for (const m of manualGames) {
    const candidates = linkableAo.filter(
      (a) =>
        !usedAo.has(a.athleteone_game_id) && a.game_date === m.game_date
    )
    if (candidates.length === 0) {
      unmatchedManual.push(m)
      continue
    }
    let best = candidates[0]
    let bestSim = nameSimilarity(m.opponent || '', best.opponent || '')
    for (let i = 1; i < candidates.length; i++) {
      const sim = nameSimilarity(m.opponent || '', candidates[i].opponent || '')
      if (sim > bestSim) {
        bestSim = sim
        best = candidates[i]
      }
    }
    usedAo.add(best.athleteone_game_id)
    suggested.push({
      manual: m,
      ao: best,
      sameOpponent: bestSim >= 0.5,
    })
  }

  const unmatchedAo = linkableAo.filter((a) => !usedAo.has(a.athleteone_game_id))
  return { suggested, unmatchedManual, unmatchedAo }
}

function nameSimilarity(a, b) {
  const aL = a.toLowerCase().trim()
  const bL = b.toLowerCase().trim()
  if (!aL || !bL) return 0
  if (aL === bL) return 1.0
  if (aL.includes(bL) || bL.includes(aL)) return 0.85
  const aWords = new Set(aL.split(/\s+/).filter((w) => w.length > 2))
  const bWords = new Set(bL.split(/\s+/).filter((w) => w.length > 2))
  if (aWords.size === 0 || bWords.size === 0) return 0
  let common = 0
  for (const w of aWords) if (bWords.has(w)) common++
  return common / Math.max(aWords.size, bWords.size)
}
