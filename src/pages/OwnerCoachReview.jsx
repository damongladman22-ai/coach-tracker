import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import OwnerLayout from '../components/OwnerLayout'

/**
 * OwnerCoachReview — the platform-owner review queue for coach-data changes
 * produced by the refresh pipeline (coach_review_queue).
 *
 * Lives in the /owner section; OwnerLayout enforces the super_admin gate, so
 * this component renders only for owners (RLS backs it server-side). Supports
 * approve / reject / apply, per-row and bulk, mirroring the pipeline's apply.py.
 */

const TYPE_ORDER = ['new_coach', 'contact_update', 'deactivation']
const TYPE_LABEL = {
  new_coach: 'New coaches',
  contact_update: 'Contact updates',
  deactivation: 'Deactivations',
}
const TYPE_BADGE = {
  new_coach: 'bg-green-100 text-green-800',
  contact_update: 'bg-blue-100 text-blue-800',
  deactivation: 'bg-red-100 text-red-800',
}
const TYPE_BADGE_LABEL = {
  new_coach: 'New',
  contact_update: 'Update',
  deactivation: 'Deactivate',
}
const CONF_BADGE = {
  high: 'bg-emerald-100 text-emerald-700',
  medium: 'bg-amber-100 text-amber-700',
  low: 'bg-gray-100 text-gray-600',
}

const SELECT_COLS =
  'id, change_type, school_id, existing_coach_id, ' +
  'first_name, last_name, title, email, phone, ' +
  'current_first_name, current_last_name, current_title, current_email, current_phone, ' +
  'source_url, confidence, created_at, schools(school, division, state)'

function fullName(first, last) {
  return [first, last].filter(Boolean).join(' ').trim()
}

function coachLabel(row) {
  return (
    fullName(row.current_first_name, row.current_last_name) ||
    fullName(row.first_name, row.last_name) ||
    'this coach'
  )
}

const APPROVE_LABEL = {
  new_coach: 'Add',
  contact_update: 'Apply',
  deactivation: 'Deactivate',
}

export default function OwnerCoachReview({ session }) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [rows, setRows] = useState([])
  const [groupMode, setGroupMode] = useState('type') // 'type' | 'school'
  const [busyIds, setBusyIds] = useState({})
  const [bulkKey, setBulkKey] = useState(null)
  const [actionError, setActionError] = useState(null)

  // ── Load the pending queue (paginated; the queue can exceed 1000 rows) ──
  async function loadQueue() {
    setLoading(true)
    setError(null)
    let all = []
    let from = 0
    const size = 1000
    try {
      while (true) {
        const { data, error } = await supabase
          .from('coach_review_queue')
          .select(SELECT_COLS)
          .eq('status', 'pending')
          .order('created_at', { ascending: false })
          .range(from, from + size - 1)
        if (error) throw error
        all = all.concat(data || [])
        if (!data || data.length < size) break
        from += size
      }
      setRows(all)
    } catch (e) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadQueue()
  }, [])

  // ── Actions ─────────────────────────────────────────────────────────
  function setBusy(id, on) {
    setBusyIds((m) => {
      const next = { ...m }
      if (on) next[id] = true
      else delete next[id]
      return next
    })
  }

  function removeRow(id) {
    setRows((rs) => rs.filter((r) => r.id !== id))
  }

  // Write the proposed change into `coaches`, mirroring the pipeline's apply.py
  // token-for-token via raw_change_type. Legacy rows (no raw_change_type) fall
  // back to safe field patches only — never a name.
  async function applyChangeToCoaches(row) {
    const raw = (row.raw_change_type || '').toLowerCase()

    if (row.change_type === 'new_coach' || raw.includes('new_coach')) {
      const { error } = await supabase.from('coaches').insert({
        school_id: row.school_id,
        first_name: row.first_name || '',
        last_name: row.last_name || '',
        title: row.title || null,
        email: row.email || null,
        phone: row.phone || null,
        is_active: true,
        source: 'scraped',
      })
      if (error) throw error
      return
    }

    if (row.change_type === 'deactivation' || raw.includes('no_longer_listed')) {
      if (!row.existing_coach_id) return
      const { error } = await supabase
        .from('coaches')
        .update({ is_active: false })
        .eq('id', row.existing_coach_id)
      if (error) throw error
      return
    }

    // contact_update — patch only the field(s) the pipeline flagged.
    if (!row.existing_coach_id) return
    const patch = {}
    if (raw) {
      if (raw.includes('email_changed')) patch.email = row.email
      if (raw.includes('title_changed')) patch.title = row.title
      if (raw.includes('phone_changed')) patch.phone = row.phone
      if (raw.includes('name_corrected')) {
        if (row.first_name) patch.first_name = row.first_name
        if (row.last_name) patch.last_name = row.last_name
      }
    } else {
      if (row.email && row.email !== row.current_email) patch.email = row.email
      if (row.title && row.title !== row.current_title) patch.title = row.title
      if (row.phone && row.phone !== row.current_phone) patch.phone = row.phone
    }
    if (Object.keys(patch).length === 0) return
    const { error } = await supabase.from('coaches').update(patch).eq('id', row.existing_coach_id)
    if (error) throw error
  }

  async function markResolved(row, status) {
    const { error } = await supabase
      .from('coach_review_queue')
      .update({
        status,
        reviewed_at: new Date().toISOString(),
        reviewed_by: session?.user?.email || null,
      })
      .eq('id', row.id)
    if (error) throw error
  }

  async function approveRow(row) {
    if (row.change_type === 'deactivation') {
      if (!window.confirm(`Mark ${coachLabel(row)} inactive? Attendance history is preserved.`)) return
    }
    setActionError(null)
    setBusy(row.id, true)
    try {
      await applyChangeToCoaches(row)
      await markResolved(row, 'applied')
      removeRow(row.id)
    } catch (e) {
      setActionError(`Couldn’t apply ${coachLabel(row)}: ${e.message || e}`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function rejectRow(row) {
    setActionError(null)
    setBusy(row.id, true)
    try {
      await markResolved(row, 'rejected')
      removeRow(row.id)
    } catch (e) {
      setActionError(`Couldn’t reject ${coachLabel(row)}: ${e.message || e}`)
    } finally {
      setBusy(row.id, false)
    }
  }

  async function bulkApprove(group) {
    const n = group.rows.length
    if (
      !window.confirm(
        `Approve all ${n} change${n === 1 ? '' : 's'} in “${group.label}”? This writes them to the coach database.`
      )
    )
      return
    setActionError(null)
    setBulkKey(group.key)
    const failures = []
    for (const row of group.rows) {
      try {
        await applyChangeToCoaches(row)
        await markResolved(row, 'applied')
      } catch (e) {
        failures.push(`${coachLabel(row)}: ${e.message || e}`)
      }
    }
    setBulkKey(null)
    if (failures.length) {
      setActionError(`${failures.length} of ${n} couldn’t be applied — first: ${failures[0]}`)
    }
    await loadQueue()
  }

  // ── Build groups ────────────────────────────────────────────────────
  let groups = []
  if (groupMode === 'type') {
    groups = TYPE_ORDER
      .map((t) => ({
        key: t,
        label: TYPE_LABEL[t],
        rows: rows.filter((r) => r.change_type === t),
      }))
      .filter((g) => g.rows.length > 0)
  } else {
    const bySchool = {}
    for (const r of rows) {
      const name = r.schools?.school || '(unknown school)'
      ;(bySchool[name] = bySchool[name] || []).push(r)
    }
    groups = Object.keys(bySchool)
      .sort((a, b) => a.localeCompare(b))
      .map((name) => ({ key: name, label: name, rows: bySchool[name] }))
  }

  const counts = TYPE_ORDER.reduce((acc, t) => {
    acc[t] = rows.filter((r) => r.change_type === t).length
    return acc
  }, {})

  return (
    <OwnerLayout session={session} title="Coach Review">
      {/* Controls */}
      <div className="bg-white rounded-lg shadow p-4 mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm text-gray-600">
          <span className="font-semibold text-gray-800">{rows.length}</span> pending change
          {rows.length === 1 ? '' : 's'}
          {rows.length > 0 && (
            <span className="text-gray-400">
              {'  ·  '}
              {counts.new_coach} new · {counts.contact_update} updates · {counts.deactivation} deactivations
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          {/* Group toggle */}
          <div className="inline-flex rounded-md border border-gray-300 overflow-hidden text-sm">
            <button
              onClick={() => setGroupMode('type')}
              className={`px-3 py-1.5 ${
                groupMode === 'type' ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              By type
            </button>
            <button
              onClick={() => setGroupMode('school')}
              className={`px-3 py-1.5 border-l border-gray-300 ${
                groupMode === 'school' ? 'bg-gray-800 text-white' : 'bg-white text-gray-700 hover:bg-gray-50'
              }`}
            >
              By school
            </button>
          </div>
          <button
            onClick={loadQueue}
            className="text-sm text-blue-600 hover:text-blue-700"
            disabled={loading}
          >
            {loading ? 'Refreshing…' : 'Refresh'}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          Couldn’t load the queue: {error}
        </div>
      )}

      {actionError && (
        <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg p-4 mb-6 text-sm">
          {actionError}
        </div>
      )}

      {loading ? (
        <div className="text-gray-500">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No pending coach changes to review.
        </div>
      ) : (
        <div className="space-y-8">
          {groups.map((group) => (
            <section key={group.key}>
              <div className="flex items-center justify-between gap-2 mb-3">
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold text-gray-800">{group.label}</h2>
                  <span className="text-sm text-gray-400">({group.rows.length})</span>
                </div>
                <button
                  onClick={() => bulkApprove(group)}
                  disabled={bulkKey === group.key}
                  className="text-sm px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                >
                  {bulkKey === group.key ? 'Approving…' : `Approve all (${group.rows.length})`}
                </button>
              </div>
              <div className="space-y-3">
                {group.rows.map((r) => (
                  <ReviewRow
                    key={r.id}
                    row={r}
                    showType={groupMode === 'school'}
                    showSchool={groupMode === 'type'}
                    busy={!!busyIds[r.id] || bulkKey === group.key}
                    onApprove={() => approveRow(r)}
                    onReject={() => rejectRow(r)}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </OwnerLayout>
  )
}

// ── Single change card ──────────────────────────────────────────────────
function ReviewRow({ row, showType, showSchool, busy, onApprove, onReject }) {
  const school = row.schools?.school || '(unknown school)'
  const schoolMeta = [row.schools?.division, row.schools?.state].filter(Boolean).join(' · ')

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {showType && (
              <span className={`text-xs font-medium px-2 py-0.5 rounded ${TYPE_BADGE[row.change_type]}`}>
                {TYPE_BADGE_LABEL[row.change_type] || row.change_type}
              </span>
            )}
            <CoachHeading row={row} />
            {row.confidence && (
              <span
                className={`text-xs px-2 py-0.5 rounded ${CONF_BADGE[row.confidence] || CONF_BADGE.low}`}
              >
                {row.confidence}
              </span>
            )}
          </div>
          {showSchool && (
            <div className="text-sm text-gray-500 mt-0.5">
              {school}
              {schoolMeta && <span className="text-gray-400"> · {schoolMeta}</span>}
            </div>
          )}
        </div>
        {row.source_url && (
          <a
            href={row.source_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 hover:text-blue-700 whitespace-nowrap shrink-0"
          >
            Source ↗
          </a>
        )}
      </div>

      <div className="mt-3">
        <ChangeBody row={row} />
      </div>

      <div className="mt-3 flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded-md bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
        >
          {busy ? '…' : APPROVE_LABEL[row.change_type] || 'Approve'}
        </button>
        <button
          onClick={onReject}
          disabled={busy}
          className="text-sm px-3 py-1.5 rounded-md border border-gray-300 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
        >
          Reject
        </button>
      </div>
    </div>
  )
}

function CoachHeading({ row }) {
  if (row.change_type === 'new_coach') {
    return <span className="font-semibold text-gray-900">{fullName(row.first_name, row.last_name) || '(unnamed)'}</span>
  }
  const current = fullName(row.current_first_name, row.current_last_name)
  const proposed = fullName(row.first_name, row.last_name)
  // Name change (proposed differs from current) — show old → new
  if (row.change_type === 'contact_update' && proposed && current && proposed !== current) {
    return (
      <span className="font-semibold text-gray-900">
        <span className="line-through text-gray-400 font-normal">{current}</span> {proposed}
      </span>
    )
  }
  return <span className="font-semibold text-gray-900">{current || proposed || '(unnamed)'}</span>
}

function ChangeBody({ row }) {
  if (row.change_type === 'new_coach') {
    return (
      <dl className="text-sm grid grid-cols-1 sm:grid-cols-3 gap-x-6 gap-y-1">
        <Field label="Title" value={row.title} />
        <Field label="Email" value={row.email} />
        <Field label="Phone" value={row.phone} />
      </dl>
    )
  }

  if (row.change_type === 'deactivation') {
    return (
      <div className="text-sm">
        <span className="text-red-700 font-medium">Proposed: mark inactive.</span>{' '}
        <span className="text-gray-500">
          {[row.current_title, row.current_email].filter(Boolean).join(' · ') || 'No contact info on file.'}
        </span>
        <div className="text-xs text-gray-400 mt-1">
          Attendance history is preserved — deactivation only hides the coach from active surfaces.
        </div>
      </div>
    )
  }

  // contact_update — show only fields that actually changed
  const diffs = []
  if ((row.title || '') && row.title !== row.current_title) diffs.push(['Title', row.current_title, row.title])
  if ((row.email || '') && row.email !== row.current_email) diffs.push(['Email', row.current_email, row.email])
  if ((row.phone || '') && row.phone !== row.current_phone) diffs.push(['Phone', row.current_phone, row.phone])

  if (diffs.length === 0) {
    return <div className="text-sm text-gray-500">Name correction (see above).</div>
  }
  return (
    <div className="space-y-1 text-sm">
      {diffs.map(([label, before, after]) => (
        <div key={label} className="flex flex-wrap items-baseline gap-2">
          <span className="text-gray-400 w-14 shrink-0">{label}</span>
          <span className="line-through text-gray-400">{before || '—'}</span>
          <span className="text-gray-300">→</span>
          <span className="text-gray-900 font-medium">{after}</span>
        </div>
      ))}
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div>
      <dt className="text-gray-400">{label}</dt>
      <dd className="text-gray-900">{value || '—'}</dd>
    </div>
  )
}
