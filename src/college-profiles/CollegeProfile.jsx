import './college-profile.css'
import { useProgramProfile } from './data/useProgramProfile'
import {
  rosterSize, nonSeniorReturnRate, projectedOpeningsAfterCurrent,
  projectedOpeningsByYear, newcomers, geographyBuckets,
} from './data/metrics'
import Masthead from './cards/Masthead'
import KpiStrip from './cards/KpiStrip'
import SquadMap from './cards/SquadMap'
import ProjectedOpenings from './cards/ProjectedOpenings'
import RosterStability from './cards/RosterStability'
import RosterTable from './cards/RosterTable'
import Geography from './cards/Geography'
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

export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back', theme }) {
  const { loading, error, school, rosters, coaches, seasons, currentSeason, currentRoster, lastSyncedRaw } =
    useProgramProfile(client, schoolId)

  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

  const ready = !loading && !error && school
  const returnStats = ready ? nonSeniorReturnRate(rosters, seasons) : null
  const openingBuckets = ready ? projectedOpeningsByYear(currentRoster, currentSeason) : []
  const geoBuckets = ready ? geographyBuckets(currentRoster) : []

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
            <SquadMap roster={currentRoster} season={currentSeason} />
            <div className="cp-two">
              <ProjectedOpenings buckets={openingBuckets} />
              <RosterStability stats={returnStats} />
            </div>
            <RosterTable roster={currentRoster} />
            <div className="cp-two">
              <Geography buckets={geoBuckets} />
              <CoachStaff coaches={coaches} />
            </div>
            <footer className="cp-foot">
              <p><b>About this data.</b> Roster, class, and position data are aggregated from public
                college athletics sources and linked across seasons to a single player identity — which is
                what makes the stability and projected-openings analysis possible.</p>
              <p>Stability reflects the seasons currently tracked for this program ({seasonRange(seasons)}).
                Position analysis is at the group level (GK / Defense / Midfield / Attack). Projected
                openings are a forward signal, not a guarantee — transfers, redshirts, and recruiting all
                shift the picture.</p>
            </footer>
          </>
        )}
      </div>
    </div>
  )
}
