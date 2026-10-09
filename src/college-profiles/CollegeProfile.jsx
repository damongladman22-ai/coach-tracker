import './college-profile.css'
import { useMemo, useState } from 'react'
import { useProgramProfile } from './data/useProgramProfile'
import { useProgramBenchmarks } from './data/useProgramBenchmarks'
import {
  rosterSize, nonSeniorReturnRate, projectedOpeningsAfterCurrent, nextSeasonOpeningsEstimate, isTwoYearProgram,
  projectedOpeningsByYear, newcomers, geographyOverTime, compositionOverTime, sizeProfile,
  newcomerMix,
} from './data/metrics'
import Masthead from './cards/Masthead'
import KpiStrip from './cards/KpiStrip'
import SquadMap from './cards/SquadMap'
import ProjectedOpenings from './cards/ProjectedOpenings'
import RosterStability from './cards/RosterStability'
import RosterTable from './cards/RosterTable'
import CompositionOverTime from './cards/CompositionOverTime'
import SizeProfile from './cards/SizeProfile'
import SectionNav from './cards/SectionNav'
import GeographyTrend from './cards/GeographyTrend'
import CoachStaff from './cards/CoachStaff'
import ProgramResults from './cards/ProgramResults'
import RosterBuild from './cards/RosterBuild'
import CampusAndCost from './cards/CampusAndCost'
import { useProgramResults } from './data/useProgramResults'
import { usePeerResults } from './data/usePeerResults'
import { useProgramTransfers } from './data/useProgramTransfers'
import { useEarlyDepartures } from './data/useEarlyDepartures'
import { useDepartureOutlook } from './data/useDepartureOutlook'
import { useCollegeFacts } from './data/useCollegeFacts'
import { useHometownGeocodes } from './data/useHometownGeocodes'
import { themeFromSchool, softOf } from './data/schoolBranding'
import { classShares, inStateShare } from './data/peerOverlays'

/**
 * CollegeProfile — the portable module entry point.
 * Props (all injected; no PitchSide imports): client, schoolId, backTo, backLabel, theme, logoUrl
 *   theme   → { accent, accentDeep, accentTint } — the OVERRIDE tier. When the
 *             host supplies one it wins, so a hand-curated colourway is never
 *             displaced by a derived one. When it does not, the colourway is
 *             read off the schools row this component already fetched (see
 *             themeFromSchool), which is why theming costs no extra request.
 *             Either way it drives the .cp-root CSS vars.
 *   logoUrl → school mark for the masthead crest; falsy → monogram fallback
 */
function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}
function seasonRange(seasons) {
  if (!seasons?.length) return ''
  const a = seasons[0], b = seasons[seasons.length - 1]
  return a === b ? `${a}` : `${a}\u2013${b}`
}

const NAV = [
  { id: 'sec-squad', label: 'Squad' },
  { id: 'sec-openings', label: 'Openings' },
  { id: 'sec-arrivals', label: 'Arrivals' },
  { id: 'sec-roster', label: 'Roster' },
  { id: 'sec-trends', label: 'Trends' },
  { id: 'sec-geography', label: 'Geography' },
  { id: 'sec-campus', label: 'Campus' },
  { id: 'sec-staff', label: 'Staff' },
]

export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back', theme, logoUrl }) {
  const { loading, error, school, rosters, coaches, seasons, currentSeason, currentRoster, lastSyncedRaw, rosterUrl, homeUrl } =
    useProgramProfile(client, schoolId)
  const benchmarks = useProgramBenchmarks(client, school, currentSeason)
  const results = useProgramResults(client, schoolId)
  // Peers' records for the Program performance standing lines (backlog G2).
  const peerResults = usePeerResults(client, results.rows, school?.program_gender || null)
  const transfers = useProgramTransfers(client, schoolId)
  const departures = useEarlyDepartures(client, schoolId)
  const departureOutlook = useDepartureOutlook(client, schoolId)
  const college = useCollegeFacts(client, schoolId)
  // Map positions for the Recruiting geography Cities view (backlog G5).
  const hometownPoints = useHometownGeocodes(client, rosters)
  // The Campus chip only appears when the program has a federal college to show.
  // Memoised: SectionNav rebuilds its scroll observer whenever `items` changes.
  const hasCampus = !!college.facts
  const navItems = useMemo(() => (hasCampus ? NAV : NAV.filter(i => i.id !== 'sec-campus')), [hasCampus])
  const [peer, setPeer] = useState('div')
  const hasConf = !!benchmarks.conf
  const activePeer = peer === 'conf' && hasConf ? 'conf' : 'div'
  const scope = activePeer === 'conf' ? benchmarks.conf : benchmarks.div

  // Host override first, then the row. Null leaves the module's neutral
  // defaults in place, which is the honest state for a school we have no
  // colourway for — it is not another school's scarlet.
  const colorway = theme || themeFromSchool(school)
  const styleVars = colorway
    ? {
        '--accent': colorway.accent,
        '--accent-deep': colorway.accentDeep,
        '--accent-tint': colorway.accentTint,
        '--accent-on': colorway.accentOn || '#FFFFFF',
        '--accent-soft': colorway.accentSoft || softOf(colorway.accent) || undefined,
        ...(colorway.accent2 ? { '--accent-2': colorway.accent2 } : null),
      }
    : undefined

  const ready = !loading && !error && school
  const twoYear = ready ? isTwoYearProgram(rosters, school.division) : false
  const returnStats = ready ? nonSeniorReturnRate(rosters, seasons, { twoYear }) : null
  const openingBuckets = ready ? projectedOpeningsByYear(currentRoster, currentSeason) : []
  const geoTime = ready ? geographyOverTime(rosters, seasons) : null
  const compData = ready ? compositionOverTime(rosters, seasons) : null
  const sizeData = ready ? sizeProfile(currentRoster) : null
  const mixData = ready ? newcomerMix(rosters, seasons) : null
  // G4 overlays: current-roster class mix and in-state share, defined as the peer substrate defines them.
  const classMix = ready ? classShares(currentRoster) : null
  const inState = ready ? inStateShare(currentRoster, school.state) : null
  // Two-year programs are included again: their stored grad_year was corrected
  // to two-year offsets on 2026-09-29 (pipeline out_sql/13_two_year_grad_year.sql),
  // so the "graduating" count matches the NEXT bar for them too.
  // G8: the early-leaver rate is the program's departure outlook (the same rate
  // Find programs uses). Wait for it rather than flash the old own average; if
  // it cannot be read, the estimate falls back to the own average.
  const openingsEstimate = ready && !departureOutlook.loading
    ? nextSeasonOpeningsEstimate({ currentRoster, currentSeason, returnStats, mix: mixData,
        outlook: departureOutlook.outlook, twoYear })
    : null

  return (
    <div className="cp-root" style={styleVars}>
      <div className="cp-wrap">
        <a className="cp-back" href={backTo}>‹ {backLabel}</a>

        {loading && <div className="cp-state">Loading program…</div>}

        {!loading && error && (
          <div className="cp-state cp-state--err">
            Couldn’t load this program.
            <span className="cp-state-detail">{error}</span>
          </div>
        )}

        {!loading && !error && !school && (
          <div className="cp-state">Program not found.</div>
        )}

        {ready && (
          <>
            <Masthead
              school={school}
              currentRoster={currentRoster}
              seasons={seasons}
              lastSynced={fmtDate(lastSyncedRaw)}
              logoUrl={logoUrl}
              rosterUrl={rosterUrl}
              homeUrl={homeUrl}
            />
            {benchmarks.div && (
              <div className="cp-peerbar">
                <span className="cp-peerbar-l">Compared against</span>
                <div className="cp-peer-toggle" role="tablist" aria-label="Benchmark peer group">
                  <button type="button" role="tab" aria-selected={activePeer === 'div'}
                    className={`cp-peer-tgl${activePeer === 'div' ? ' cp-peer-tgl--on' : ''}`}
                    onClick={() => setPeer('div')}>{benchmarks.divLabel} {benchmarks.genderWord}</button>
                  {hasConf && (
                    <button type="button" role="tab" aria-selected={activePeer === 'conf'}
                      className={`cp-peer-tgl${activePeer === 'conf' ? ' cp-peer-tgl--on' : ''}`}
                      onClick={() => setPeer('conf')}>{benchmarks.confLabel}</button>
                  )}
                </div>
                <span className="cp-peerbar-note">Every card below compares to this peer group</span>
              </div>
            )}
            {/* The peer bar sits above Program performance (backlog G2, 2026-10-09):
                the card's standing lines follow the same switch as every card below. */}
            {results.rows.length > 0 && (
              <div className="cp-perf-sec">
                <ProgramResults rows={results.rows} schoolId={schoolId} peers={peerResults.index}
                  scope={activePeer} genderWord={benchmarks.genderWord} />
              </div>
            )}
            <KpiStrip
              rosterSize={rosterSize(currentRoster)}
              returnRate={returnStats?.rate}
              projectedOpenings={projectedOpeningsAfterCurrent(currentRoster, { twoYear })}
              newcomers={newcomers(rosters, currentRoster, currentSeason)}
              currentSeason={currentSeason}
              benchmark={scope}
            />
            <SectionNav items={navItems} />
            <div id="sec-squad" className="cp-anchor">
              <SquadMap roster={currentRoster} season={currentSeason} />
            </div>
            <div id="sec-openings" className="cp-anchor cp-two">
              <ProjectedOpenings buckets={openingBuckets} estimate={openingsEstimate} twoYear={twoYear} />
              <RosterStability stats={returnStats} benchmark={scope}
                departures={departures.rows} twoYear={twoYear} />
            </div>
            <div id="sec-arrivals" className="cp-anchor">
              <RosterBuild mix={mixData} transfers={transfers.rows} span={transfers.span} benchmark={scope} />
            </div>
            <div id="sec-roster" className="cp-anchor">
              <RosterTable roster={currentRoster} />
            </div>
            <div id="sec-trends" className="cp-anchor cp-pair">
              <CompositionOverTime data={compData} benchmark={scope} classMix={classMix} />
              <SizeProfile data={sizeData} benchmark={scope} season={currentSeason} />
            </div>
            <div id="sec-geography" className="cp-anchor">
              <GeographyTrend data={geoTime} benchmark={scope} inState={inState} schoolState={school.state}
                cityPoints={hometownPoints.points} />
            </div>
            {college.facts && (
              <div id="sec-campus" className="cp-anchor cp-sec">
                <CampusAndCost facts={college.facts} majors={college.majors} />
              </div>
            )}
            <div id="sec-staff" className="cp-anchor cp-sec">
              <CoachStaff coaches={coaches} client={client} />
            </div>
            <footer className="cp-foot">
              <p><b>About this data.</b> Roster, class, position, and hometown data are aggregated from
                public college athletics sources and linked across seasons to a single player identity —
                which is what makes the stability, projected-openings, and recruiting-footprint analysis
                possible.</p>
              <p>Metrics reflect the seasons currently tracked for this program ({seasonRange(seasons)}).
                Position analysis is at the group level (GK / Defense / Midfield / Attack); geography is at
                the state/country level. Projected openings count players reaching their graduation year;
                the next-season estimate adds expected early departures (the program’s own history, steadied by
                similar programs and adjusted for its roster mix and win record) and the program’s usual freshman
                share. Both are a forward signal, not a guarantee —
                transfers, redshirts, and recruiting all shift the picture.</p>
              {college.facts && (
                <p>Campus, cost, admissions, outcomes, and majors are the U.S. Department of Education&rsquo;s
                  College Scorecard figures for the college this program belongs to.</p>
              )}
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
