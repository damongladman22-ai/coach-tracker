import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import OPLogo from '../components/OPLogo'
import HamburgerMenu from '../components/HamburgerMenu'
import GenderBadge from '../components/GenderBadge'
import { PageLoader } from '../components/LoadingStates'
import { useCollegeProfilesAccess } from '../college-profiles/access/useCollegeProfilesAccess'
import { useCollegeProfileLogos } from '../college-profiles/access/useCollegeProfileLogos'
import ProfileLocked from '../college-profiles/access/ProfileLocked'
import { brandingFor } from '../college-profiles/data/schoolBranding'

/**
 * CollegeExplore — the public "Explore Colleges" index (CSIP front door).
 *
 * One row per program (schools.id is program-specific). Reads the slim
 * v_college_index view (non-empty programs only), fetched in chunks to clear the
 * 1000-row PostgREST cap, then filters/searches/sorts entirely client-side.
 *
 * Filter-first: gender / division / conference narrow the list; search spans the
 * FULL non-empty set (ignores the filters), so a name always finds its program.
 * Sorted richest-first (season depth) by default. Rows deep-link to /school/:id.
 *
 * Sits under CsipGate (passcode) in the router; this component still runs the
 * College Profiles kill-switch gate, mirroring SchoolProfile.
 */
const PAGE = 1000
const RENDER_CAP = 60
const DIV_ORDER = ['NCAA D1', 'NCAA D2', 'NCAA D3', 'NAIA', 'JC']
const divRank = (d) => { const i = DIV_ORDER.indexOf(d); return i === -1 ? 99 : i }

function deriveMonogram(name) {
  if (!name) return '—'
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

async function fetchAllIndex() {
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await supabase
      .from('v_college_index')
      .select('id,school,program_gender,division,conference,city,state,seasons,current_active')
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

function Crest({ row, logosEnabled }) {
  const brand = brandingFor(row.id)
  const accent = brand?.theme?.accent || '#334155'
  const logoUrl = logosEnabled && brand?.logoUrl ? brand.logoUrl : null
  const [ok, setOk] = useState(true)
  const show = logoUrl && ok
  return (
    <div
      className="flex-shrink-0 grid place-items-center rounded-full overflow-hidden"
      style={{ width: 44, height: 44, background: show ? '#fff' : accent,
        boxShadow: show ? 'inset 0 0 0 1px #E5E8EB' : 'inset 0 0 0 2px rgba(255,255,255,.25)' }}
    >
      {show
        ? <img src={logoUrl} alt="" onError={() => setOk(false)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
        : <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '.5px' }}>
            {deriveMonogram(row.school)}
          </span>}
    </div>
  )
}

export default function CollegeExplore() {
  const status = useCollegeProfilesAccess(supabase)
  const logosEnabled = useCollegeProfileLogos(supabase)

  const [rows, setRows] = useState(null)
  const [err, setErr] = useState('')
  const [gender, setGender] = useState('All')       // 'All' | 'M' | 'W'
  const [division, setDivision] = useState('All')
  const [conference, setConference] = useState('All')
  const [q, setQ] = useState('')
  const [sort, setSort] = useState('depth')          // 'depth' | 'name'

  useEffect(() => {
    if (status !== 'allowed') return
    let cancelled = false
    setRows(null); setErr('')
    fetchAllIndex()
      .then(data => { if (!cancelled) setRows(data) })
      .catch(e => { if (!cancelled) setErr(e.message || 'Could not load colleges.') })
    return () => { cancelled = true }
  }, [status])

  const divisions = useMemo(() => {
    if (!rows) return []
    return Array.from(new Set(rows.map(r => r.division).filter(Boolean)))
      .sort((a, b) => divRank(a) - divRank(b))
  }, [rows])

  const conferences = useMemo(() => {
    if (!rows) return []
    const scope = division === 'All' ? rows : rows.filter(r => r.division === division)
    return Array.from(new Set(scope.map(r => r.conference).filter(Boolean))).sort()
  }, [rows, division])

  const filtered = useMemo(() => {
    if (!rows) return []
    const query = q.trim().toLowerCase()
    let out
    if (query) {
      out = rows.filter(r => (r.school || '').toLowerCase().includes(query))
    } else {
      out = rows.filter(r =>
        (gender === 'All' || r.program_gender === gender) &&
        (division === 'All' || r.division === division) &&
        (conference === 'All' || r.conference === conference)
      )
    }
    out = [...out]
    if (sort === 'name') {
      out.sort((a, b) => (a.school || '').localeCompare(b.school || ''))
    } else {
      out.sort((a, b) =>
        (b.seasons - a.seasons) ||
        (b.current_active - a.current_active) ||
        (a.school || '').localeCompare(b.school || ''))
    }
    return out
  }, [rows, q, gender, division, conference, sort])

  if (status === 'checking') return <PageLoader message="Loading…" />
  if (status === 'locked') return <ProfileLocked backTo="/home" backLabel="Back to Home" />
  if (status === 'disabled') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center',
        background: '#F2F3F5', fontFamily: 'system-ui, sans-serif', padding: 24 }}>
        <div style={{ background: '#fff', border: '1px solid #E5E8EB', borderRadius: 14,
          boxShadow: '0 8px 24px rgba(20,25,28,.06)', padding: '28px 30px', maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ margin: '0 0 8px', fontSize: 22, color: '#15191C' }}>Not available</h1>
          <p style={{ color: '#5C6B73', margin: 0 }}>This feature isn’t available on this account.</p>
        </div>
      </div>
    )
  }

  const shown = filtered.slice(0, RENDER_CAP)
  const truncated = filtered.length - shown.length
  const searching = q.trim().length > 0
  const selectCls = 'text-sm border border-gray-300 rounded-lg px-2.5 py-2 bg-white text-gray-800'

  return (
    <div className="min-h-screen bg-[#F2F3F5]">
      <header className="bg-[#0a1628] text-white">
        <div className="max-w-5xl mx-auto px-4">
          <div className="flex items-center justify-between h-16">
            <div className="flex items-center gap-3">
              <OPLogo className="h-10 w-10" />
              <div>
                <div className="text-[11px] uppercase tracking-wider text-gray-400">College Soccer Intelligence</div>
                <h1 className="text-lg font-semibold leading-tight">Explore Colleges</h1>
              </div>
            </div>
            <HamburgerMenu />
          </div>
        </div>
      </header>

      <div className="max-w-5xl mx-auto px-4 py-5">
        {/* Filters */}
        <div className="bg-white border border-gray-200 rounded-xl p-3 mb-4">
          <input
            type="text"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Search all colleges by name…"
            autoCapitalize="none" autoCorrect="off" spellCheck={false}
            className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 mb-3 outline-none focus:border-gray-500"
          />
          <div className="flex flex-wrap gap-2 items-center">
            <select className={selectCls} value={gender} onChange={e => setGender(e.target.value)} disabled={searching}>
              <option value="All">All genders</option>
              <option value="W">Women</option>
              <option value="M">Men</option>
            </select>
            <select className={selectCls} value={division}
              onChange={e => { setDivision(e.target.value); setConference('All') }} disabled={searching}>
              <option value="All">All divisions</option>
              {divisions.map(d => <option key={d} value={d}>{d}</option>)}
            </select>
            <select className={selectCls} value={conference}
              onChange={e => setConference(e.target.value)} disabled={searching || division === 'All'}>
              <option value="All">{division === 'All' ? 'All conferences' : 'All conferences'}</option>
              {conferences.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
            <div className="ml-auto flex items-center gap-2">
              <span className="text-xs text-gray-500">Sort</span>
              <select className={selectCls} value={sort} onChange={e => setSort(e.target.value)}>
                <option value="depth">Most data</option>
                <option value="name">Name</option>
              </select>
            </div>
          </div>
          {searching && (
            <p className="text-xs text-gray-500 mt-2">Searching all colleges — filters are paused while you search.</p>
          )}
        </div>

        {/* States */}
        {err && <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-rose-700">{err}</div>}
        {!err && rows === null && <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">Loading colleges…</div>}

        {/* List */}
        {!err && rows !== null && (
          <>
            <div className="flex items-center justify-between mb-2 px-1">
              <p className="text-sm text-gray-600">
                {filtered.length.toLocaleString()} {filtered.length === 1 ? 'program' : 'programs'}
              </p>
            </div>
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {shown.map(row => (
                <Link key={row.id} to={`/school/${row.id}`}
                  className="flex items-center gap-3 px-3 py-3 hover:bg-gray-50 active:bg-gray-100">
                  <Crest row={row} logosEnabled={logosEnabled} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-gray-900 truncate">{row.school}</span>
                      <GenderBadge gender={row.program_gender} />
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {[row.division, row.conference].filter(Boolean).join(' · ')}
                    </div>
                    <div className="text-xs text-gray-400 truncate">
                      {[row.city, row.state].filter(Boolean).join(', ')}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <div className="text-xs font-medium text-gray-700">{row.seasons} {row.seasons === 1 ? 'season' : 'seasons'}</div>
                    {row.current_active > 0 && (
                      <div className="text-[11px] text-gray-400">{row.current_active} players</div>
                    )}
                  </div>
                </Link>
              ))}
              {shown.length === 0 && (
                <div className="px-3 py-10 text-center text-gray-500 text-sm">
                  No colleges match. Try clearing a filter or searching by name.
                </div>
              )}
            </div>
            {truncated > 0 && (
              <p className="text-xs text-gray-500 mt-3 text-center">
                Showing the first {RENDER_CAP.toLocaleString()} of {filtered.length.toLocaleString()} — refine the filters or search to narrow.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
