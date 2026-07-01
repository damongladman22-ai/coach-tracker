import './college-profile.css'
import { useProgramProfile } from './data/useProgramProfile'
import {
  rosterSize, nonSeniorReturnRate, projectedOpeningsAfterCurrent,
  projectedOpeningsByYear, newcomers,
} from './data/metrics'
import Masthead from './cards/Masthead'
import KpiStrip from './cards/KpiStrip'
import SquadMap from './cards/SquadMap'
import ProjectedOpenings from './cards/ProjectedOpenings'
import RosterStability from './cards/RosterStability'

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

export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back', theme }) {
  const { loading, error, school, rosters, seasons, currentSeason, currentRoster, lastSyncedRaw } =
    useProgramProfile(client, schoolId)

  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

  const ready = !loading && !error && school
  const returnStats = ready ? nonSeniorReturnRate(rosters, seasons) : null
  const openingBuckets = ready ? projectedOpeningsByYear(currentRoster, currentSeason) : []

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
            {/* more analytical cards land here next */}
          </>
        )}
      </div>
    </div>
  )
}
