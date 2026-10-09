import { useState, useEffect, useMemo } from 'react'
import { Link } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import GenderBadge from '../components/GenderBadge'
import { PageLoader } from '../components/LoadingStates'
import { useCollegeProfilesAccess } from '../college-profiles/access/useCollegeProfilesAccess'
import { useCollegeProfileLogos } from '../college-profiles/access/useCollegeProfileLogos'
import ProfileLocked from '../college-profiles/access/ProfileLocked'
import { brandingFor } from '../college-profiles/data/schoolBranding'
import {
  POSITIONS, DIVISIONS, STATES, REGIONS, statesInRegion, stateAbbr, rankPrograms,
  rankValue, aboutText, reasons, isBehind,
} from '../lib/findPrograms'
import {
  buildCatalog, searchMajors, offeringsBySchool, offeringFor, majorReason, choiceLabel,
} from '../lib/majorFilter'

/**
 * FindPrograms — "Find programs" (backlog F3, Targeting: ranked fit list).
 *
 * A player picks men's / women's, a position and a high-school class; the
 * page ranks every program by estimated openings at that position for that
 * entering class. Decisions (Damon, 2026-10-09): openings first; division and
 * states are hard filters, never part of the score; behind the same access as
 * College Profiles.
 *
 * Numbers come from program_openings_outlook (pipeline
 * out_sql/17_program_openings_outlook.sql), one row per program x entering
 * season x position, built with the same rules as the College Profile
 * "Projected openings" card. Ranking and wording live in src/lib/findPrograms.js
 * (tested). Nothing is saved: there are no family accounts yet (F1).
 *
 * MAJOR (Damon 2026-10-09: a specific major, with search). Typing suggests
 * majors from college_major_catalog (pipeline out_sql/19_...), plus whole
 * areas ("Engineering, any major"). Picking one keeps only programs whose
 * college graduates students in it (College Scorecard, the same data as the
 * Campus and cost card); rules in src/lib/majorFilter.js. If the catalog
 * cannot be read the major box is simply not shown.
 */
const PAGE = 1000
const STEP = 25

const COLS = 'school_id,entry_season,position,current_season,two_year,roster_rows,' +
  'graduating,continuing,early_rate,transitions,fresh_share,fresh_share_source,est_spots,est_freshman,' +
  'schools!inner(school,program_gender,division,conference,city,state)'

async function fetchLatestSeason() {
  const { data, error } = await supabase.from('program_openings_outlook')
    .select('current_season').order('current_season', { ascending: false }).limit(1)
  if (error) throw error
  return data?.[0]?.current_season ?? null
}

async function fetchOutlook(gender, position, entrySeason) {
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await supabase
      .from('program_openings_outlook')
      .select(COLS)
      .eq('entry_season', entrySeason)
      .eq('position', position)
      .eq('schools.program_gender', gender)
      .order('school_id', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchPaged(build) {
  let from = 0
  let all = []
  for (;;) {
    const { data, error } = await build().range(from, from + PAGE - 1)
    if (error) throw error
    all = all.concat(data || [])
    if (!data || data.length < PAGE) break
    from += PAGE
  }
  return all
}

async function fetchCatalog() {
  const { data, error } = await supabase.from('college_major_catalog')
    .select('cip_code,title,family_code,family_title,colleges_bachelors,colleges_associate').limit(PAGE)
  if (error) throw error
  return buildCatalog(data || [])
}

// Programs and majors for one choice: who offers it.
async function fetchOfferings(kind, code) {
  const [links, rows] = await Promise.all([
    fetchPaged(() => supabase.from('school_federal_college').select('school_id,unitid').order('school_id')),
    fetchPaged(() => supabase.from('college_majors')
      .select('unitid,cip_code,title,credential_level,graduates_2yr')
      .eq(kind === 'area' ? 'family_code' : 'cip_code', code)
      .in('credential_level', [2, 3])
      .order('unitid').order('cip_code').order('credential_level')),
  ])
  return offeringsBySchool(links, rows)
}

function deriveMonogram(name) {
  if (!name) return '—'
  const words = name.replace(/[^A-Za-z ]/g, '').split(/\s+/).filter(Boolean)
  const letters = words.slice(0, 2).map(w => w[0]).join('')
  return (letters || name.slice(0, 2)).toUpperCase()
}

function Crest({ id, name, logosEnabled }) {
  const brand = brandingFor(id)
  const logoUrl = logosEnabled && brand?.logoUrl ? brand.logoUrl : null
  const [ok, setOk] = useState(true)
  const show = logoUrl && ok
  return (
    <div className="flex-shrink-0 grid place-items-center rounded-full overflow-hidden"
      style={{ width: 44, height: 44, background: show ? '#fff' : '#334155',
        boxShadow: show ? 'inset 0 0 0 1px #E5E8EB' : 'inset 0 0 0 2px rgba(255,255,255,.25)' }}>
      {show
        ? <img src={logoUrl} alt="" onError={() => setOk(false)}
            style={{ width: '100%', height: '100%', objectFit: 'contain', padding: 6 }} />
        : <span style={{ color: '#fff', fontWeight: 700, fontSize: 15, letterSpacing: '.5px' }}>
            {deriveMonogram(name)}
          </span>}
    </div>
  )
}

function Chip({ on, onClick, children }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={'text-sm rounded-full px-3 py-1.5 border transition-colors ' +
        (on ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-700 border-gray-300 hover:border-gray-500')}>
      {children}
    </button>
  )
}

export default function FindPrograms() {
  const status = useCollegeProfilesAccess(supabase)
  const logosEnabled = useCollegeProfileLogos(supabase)

  const [latest, setLatest] = useState(null)
  const [gender, setGender] = useState('')
  const [position, setPosition] = useState('')
  const [entry, setEntry] = useState('')
  const [divisions, setDivisions] = useState(() => new Set())   // empty = all
  const [states, setStates] = useState(() => new Set())         // empty = anywhere
  const [showStates, setShowStates] = useState(false)
  const [loadErr, setLoadErr] = useState('')
  // Results are kept with the question they answer, so a new question shows
  // "Finding programs…" until its own answer arrives, and "Show more" starts
  // over for each new question.
  const [res, setRes] = useState({ key: null, rows: null, err: '' })
  const [more, setMore] = useState({ key: null, n: STEP })
  // Major filter
  const [catalog, setCatalog] = useState(null)        // null until loaded; stays null on failure
  const [choice, setChoice] = useState(null)          // { kind: 'major' | 'area', code, label }
  const [query, setQuery] = useState('')
  const [offer, setOffer] = useState({ key: null, map: null, err: '' })

  useEffect(() => {
    if (status !== 'allowed') return
    let cancelled = false
    fetchLatestSeason()
      .then(s => { if (!cancelled) setLatest(s) })
      .catch(e => { if (!cancelled) setLoadErr(e.message || 'Could not load.') })
    fetchCatalog()
      .then(c => { if (!cancelled) setCatalog(c) })
      .catch(() => { /* no catalog: the major box is not shown */ })
    return () => { cancelled = true }
  }, [status])

  const choiceKey = choice ? `${choice.kind}|${choice.code}` : null
  useEffect(() => {
    if (status !== 'allowed' || !choiceKey) return
    let cancelled = false
    const [kind, code] = choiceKey.split('|')
    fetchOfferings(kind, code)
      .then(map => { if (!cancelled) setOffer({ key: choiceKey, map, err: '' }) })
      .catch(e => { if (!cancelled) setOffer({ key: choiceKey, map: null, err: e.message || 'Could not load majors.' }) })
    return () => { cancelled = true }
  }, [status, choiceKey])
  const offerReady = !choiceKey || offer.key === choiceKey
  const offerings = choiceKey && offer.key === choiceKey ? offer.map : null
  const suggestions = useMemo(() => (choice ? [] : searchMajors(catalog, query)), [catalog, query, choice])

  const ready = !!(gender && position && entry)
  const key = ready ? `${gender}|${position}|${entry}` : null
  useEffect(() => {
    if (status !== 'allowed' || !key) return
    let cancelled = false
    const [g, p, y] = key.split('|')
    fetchOutlook(g, p, Number(y))
      .then(data => { if (!cancelled) setRes({ key, rows: data, err: '' }) })
      .catch(e => { if (!cancelled) setRes({ key, rows: null, err: e.message || 'Could not load programs.' }) })
    return () => { cancelled = true }
  }, [status, key])
  const answered = key != null && res.key === key
  const rows = answered ? res.rows : null
  const loading = ready && (!answered || !offerReady)
  const err = loadErr || (answered ? res.err : '') || (choiceKey && offer.key === choiceKey ? offer.err : '')
  const limit = more.key === key ? more.n : STEP

  const ranked = useMemo(() => {
    if (!rows) return []
    const keep = choiceKey
      ? (offerings ? r => !!offeringFor(offerings, r.school_id, r.schools?.division) : () => false)
      : null
    return rankPrograms(rows, { divisions, states, minSeason: latest != null ? latest - 1 : null, keep })
  }, [rows, divisions, states, latest, choiceKey, offerings])

  const years = latest != null ? [latest + 1, latest + 2, latest + 3, latest + 4] : []
  const pos = POSITIONS.find(p => p.code === position)

  const toggle = (set, setter, value) => {
    const next = new Set(set)
    if (next.has(value)) next.delete(value); else next.add(value)
    setter(next)
  }
  const regionOn = region => {
    const list = statesInRegion(region)
    return list.length > 0 && list.every(s => states.has(s))
  }
  const toggleRegion = region => {
    const list = statesInRegion(region)
    const next = new Set(states)
    if (regionOn(region)) list.forEach(s => next.delete(s)); else list.forEach(s => next.add(s))
    setStates(next)
  }

  if (status === 'checking') return <PageLoader message="Loading…" />
  if (status === 'locked') return <ProfileLocked backTo="/home" backLabel="Back to Home" />
  if (status === 'disabled') {
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#F2F3F5', padding: 24 }}>
        <div className="bg-white border border-gray-200 rounded-xl p-7 max-w-md text-center">
          <h1 className="text-xl font-semibold text-gray-900 mb-2">Not available</h1>
          <p className="text-gray-600">This feature isn’t available on this account.</p>
        </div>
      </div>
    )
  }

  const selectCls = 'text-sm border border-gray-300 rounded-lg px-2.5 py-2 bg-white text-gray-800'
  const shown = ranked.slice(0, limit)
  const stateSummary = states.size === 0
    ? 'Anywhere'
    : states.size <= 6 ? [...states].sort().join(', ') : `${states.size} states`

  return (
    <div className="min-h-screen bg-[#F2F3F5]">
      <div className="max-w-5xl mx-auto px-4 py-5">
        <div className="bg-white border border-gray-200 rounded-xl p-4 mb-4">
          <h1 className="text-lg font-semibold text-gray-900">Find programs</h1>
          <p className="text-sm text-gray-600 mb-3">
            Programs ranked by how many spots are likely to open at your position for your entering class.
          </p>

          <div className="flex flex-wrap gap-2 items-center mb-3">
            <select className={selectCls} value={gender} onChange={e => setGender(e.target.value)} aria-label="Women's or men's">
              <option value="">Women’s or men’s…</option>
              <option value="W">Women’s soccer</option>
              <option value="M">Men’s soccer</option>
            </select>
            <select className={selectCls} value={position} onChange={e => setPosition(e.target.value)} aria-label="Position">
              <option value="">Position…</option>
              {POSITIONS.map(p => <option key={p.code} value={p.code}>{p.one[0].toUpperCase() + p.one.slice(1)}</option>)}
            </select>
            <select className={selectCls} value={entry} onChange={e => setEntry(e.target.value)} aria-label="High school class">
              <option value="">High school class of…</option>
              {years.map(y => <option key={y} value={y}>Class of {y}</option>)}
            </select>
          </div>

          <div className="mb-3">
            <div className="text-xs text-gray-500 mb-1.5">Divisions {divisions.size === 0 && '(all)'}</div>
            <div className="flex flex-wrap gap-2">
              {DIVISIONS.map(d => (
                <Chip key={d} on={divisions.has(d)} onClick={() => toggle(divisions, setDivisions, d)}>{d}</Chip>
              ))}
            </div>
          </div>

          <div>
            <div className="text-xs text-gray-500 mb-1.5">Where: <span className="text-gray-800">{stateSummary}</span></div>
            <div className="flex flex-wrap gap-2 items-center">
              <Chip on={states.size === 0} onClick={() => setStates(new Set())}>Anywhere</Chip>
              {REGIONS.map(r => <Chip key={r} on={regionOn(r)} onClick={() => toggleRegion(r)}>{r}</Chip>)}
              <button type="button" onClick={() => setShowStates(v => !v)}
                className="text-sm text-[#1d4ed8] hover:underline ml-1">
                {showStates ? 'Hide states' : 'Pick states'}
              </button>
            </div>
            {showStates && (
              <div className="grid grid-cols-4 sm:grid-cols-8 gap-1.5 mt-3">
                {STATES.map(([abbr, name]) => (
                  <label key={abbr} title={name}
                    className={'text-sm text-center rounded-md border px-1 py-1 cursor-pointer select-none ' +
                      (states.has(abbr) ? 'bg-[#0a1628] text-white border-[#0a1628]' : 'bg-white text-gray-700 border-gray-300')}>
                    <input type="checkbox" className="sr-only" checked={states.has(abbr)}
                      onChange={() => toggle(states, setStates, abbr)} />
                    {abbr}
                  </label>
                ))}
              </div>
            )}
          </div>

          {catalog && (
            <div className="mt-3">
              <div className="text-xs text-gray-500 mb-1.5">Major {!choice && '(any)'}</div>
              {choice ? (
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm rounded-full px-3 py-1.5 bg-[#0a1628] text-white">{choiceLabel(choice)}</span>
                  <button type="button" onClick={() => { setChoice(null); setQuery('') }}
                    className="text-sm text-[#1d4ed8] hover:underline">Any major</button>
                </div>
              ) : (
                <div className="relative max-w-md">
                  <input type="search" value={query} onChange={e => setQuery(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter' && suggestions[0]) { setChoice(suggestions[0]); setQuery('') } }}
                    placeholder="Type a major, e.g. nursing, kinesiology, engineering"
                    aria-label="Major"
                    className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2 bg-white text-gray-800" />
                  {suggestions.length > 0 && (
                    <ul className="absolute z-10 mt-1 w-full bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden">
                      {suggestions.map(sg => (
                        <li key={sg.kind + sg.code}>
                          <button type="button" onClick={() => { setChoice(sg); setQuery('') }}
                            className="w-full text-left px-3 py-2 hover:bg-gray-50">
                            <div className="text-sm text-gray-900">{choiceLabel(sg)}</div>
                            <div className="text-[11px] text-gray-500">
                              {sg.kind === 'area'
                                ? 'Every major in this area'
                                : sg.colleges > 0
                                  ? `${sg.area} · bachelor’s at ${sg.colleges.toLocaleString()} soccer colleges`
                                  : `${sg.area} · associate degree at ${sg.associate.toLocaleString()} soccer colleges`}
                            </div>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                  {query.trim() && suggestions.length === 0 && (
                    <div className="text-xs text-gray-500 mt-1">No major matches “{query.trim()}”.</div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {err && <div className="bg-white border border-gray-200 rounded-xl p-6 text-center text-rose-700">{err}</div>}
        {!err && !ready && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500 text-sm">
            Choose women’s or men’s, a position and a high school class to see programs.
          </div>
        )}
        {!err && ready && loading && (
          <div className="bg-white border border-gray-200 rounded-xl p-8 text-center text-gray-500">Finding programs…</div>
        )}

        {!err && ready && !loading && rows && (
          <>
            <p className="text-sm text-gray-600 mb-2 px-1">
              {ranked.length.toLocaleString()} {ranked.length === 1 ? 'program' : 'programs'}, ranked by estimated
              openings for a {pos?.one} entering in fall {entry}{choice ? <>, at colleges that offer {choiceLabel(choice)}</> : null}.
            </p>
            <div className="bg-white border border-gray-200 rounded-xl divide-y divide-gray-100 overflow-hidden">
              {shown.map((r, i) => {
                const s = r.schools || {}
                const est = rankValue(r)
                const forFreshmen = r.est_freshman != null
                return (
                  <Link key={r.school_id} to={`/school/${r.school_id}`}
                    className="block px-3 py-3 hover:bg-gray-50 active:bg-gray-100">
                    <div className="flex items-center gap-3">
                      <div className="w-6 flex-shrink-0 text-right text-sm font-semibold text-gray-400 tabular-nums">{i + 1}</div>
                      <Crest id={r.school_id} name={s.school} logosEnabled={logosEnabled} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-semibold text-gray-900 leading-snug">{s.school}</span>
                          <GenderBadge gender={s.program_gender} />
                        </div>
                        <div className="text-xs text-gray-500 truncate">
                          {[s.division, s.conference].filter(Boolean).join(' · ')}
                        </div>
                        <div className="text-xs text-gray-400 truncate">
                          {[s.city, stateAbbr(s.state) || s.state].filter(Boolean).join(', ')}
                        </div>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-lg font-semibold text-gray-900 leading-tight whitespace-nowrap">{aboutText(est)}</div>
                        <div className="text-[11px] text-gray-500 leading-tight whitespace-nowrap">
                          {est >= 0.5 && Math.round(est) === 1 ? 'opening' : 'openings'}
                          {forFreshmen ? ' for freshmen' : ''}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5 whitespace-nowrap">{r.roster_rows} {pos?.many} on roster</div>
                      </div>
                    </div>
                    <ul className="mt-2 space-y-0.5 sm:pl-[94px]">
                      {reasons(r, position, Number(entry)).map((t, k) => (
                        <li key={k} className="text-xs text-gray-600">{t}</li>
                      ))}
                      {choice && offerings && (
                        <li className="text-xs text-gray-600">
                          {majorReason(offeringFor(offerings, r.school_id, s.division), choice)}
                        </li>
                      )}
                      {isBehind(r, latest) && (
                        <li className="text-xs text-amber-700">
                          Newest roster on file is {r.current_season}; these numbers may be a year behind.
                        </li>
                      )}
                    </ul>
                  </Link>
                )
              })}
              {shown.length === 0 && (
                <div className="px-3 py-10 text-center text-gray-500 text-sm">
                  No programs match. Try more divisions{choice ? ', states or another major' : ' or states'}.
                </div>
              )}
            </div>
            {ranked.length > shown.length && (
              <div className="text-center mt-3">
                <button type="button" onClick={() => setMore({ key, n: limit + STEP })}
                  className="text-sm border border-gray-300 bg-white rounded-lg px-4 py-2 hover:border-gray-500">
                  Show {Math.min(STEP, ranked.length - shown.length)} more
                </button>
              </div>
            )}
            <p className="text-xs text-gray-500 mt-4 px-1 leading-relaxed">
              How this is worked out: players who finish before your freshman fall are counted from each
              program’s current roster. Early leavers are expected from each program’s own history, steadied by
              similar programs and adjusted for its roster mix and win record; the share of newcomers who arrive as
              freshmen is that program’s own average. Both are estimates, not promises.
              Commits already made for your class are not known and are not subtracted.
              {choice && <> Majors come from the federal College Scorecard: a college counts if it awarded the
              degree in the last two years (bachelor’s, or at a junior college an associate degree too). Programs
              we cannot link to a federal college, such as joint teams, are left out when a major is chosen.</>}
            </p>
          </>
        )}
      </div>
    </div>
  )
}
