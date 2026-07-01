import './college-profile.css'
import { useProgramProfile } from './data/useProgramProfile'
import {
  rosterSize, nonSeniorReturnRate, projectedOpeningsAfterCurrent,
  projectedOpeningsByYear, newcomers, geographyOverTime, compositionOverTime, sizeProfile,
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

/**
 * CollegeProfile — the portable module entry point.
 * Props (all injected; no PitchSide imports): client, schoolId, backTo, backLabel, theme
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
  { id: 'sec-roster', label: 'Roster' },
  { id: 'sec-trends', label: 'Trends' },
  { id: 'sec-geography', label: 'Geography' },
  { id: 'sec-staff', label: 'Staff' },
]

export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back', theme }) {
  const { loading, error, school, rosters, coaches, seasons, currentSeason, currentRoster, lastSyncedRaw } =
    useProgramProfile(client, schoolId)

  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

  const ready = !loading && !error && school
  const returnStats = ready ? nonSeniorReturnRate(rosters, seasons) : null
  const openingBuckets = ready ? projectedOpeningsByYear(currentRoster, currentSeason) : []
  const geoTime = ready ? geographyOverTime(rosters, seasons) : null
  const compData = ready ? compositionOverTime(rosters, seasons) : null
  const sizeData = ready ? sizeProfile(currentRoster) : null

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
            />
            <KpiStrip
              rosterSize={rosterSize(currentRoster)}
              returnRate={returnStats?.rate}
              projectedOpenings={projectedOpeningsAfterCurrent(currentRoster)}
              newcomers={newcomers(rosters, currentRoster, currentSeason)}
              currentSeason={currentSeason}
            />
            <SectionNav items={NAV} />
            <div id="sec-squad" className="cp-anchor">
              <SquadMap roster={currentRoster} season={currentSeason} />
            </div>
            <div id="sec-openings" className="cp-anchor cp-two">
              <ProjectedOpenings buckets={openingBuckets} />
              <RosterStability stats={returnStats} />
            </div>
            <div id="sec-roster" className="cp-anchor">
              <RosterTable roster={currentRoster} />
            </div>
            <div id="sec-trends" className="cp-anchor cp-pair">
              <CompositionOverTime data={compData} />
              <SizeProfile data={sizeData} />
            </div>
            <div id="sec-geography" className="cp-anchor">
              <GeographyTrend data={geoTime} />
            </div>
            <div id="sec-staff" className="cp-anchor cp-sec">
              <CoachStaff coaches={coaches} />
            </div>
            <footer className="cp-foot">
              <p><b>About this data.</b> Roster, class, position, and hometown data are aggregated from
                public college athletics sources and linked across seasons to a single player identity —
                which is what makes the stability, projected-openings, and recruiting-footprint analysis
                possible.</p>
              <p>Metrics reflect the seasons currently tracked for this program ({seasonRange(seasons)}).
                Position analysis is at the group level (GK / Defense / Midfield / Attack); geography is at
                the state/country level. Projected openings are a forward signal, not a guarantee —
                transfers, redshirts, and recruiting all shift the picture.</p>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
