import './college-profile.css'
import { useProgramProfile } from './data/useProgramProfile'
import { rosterSize, nonSeniorReturnRate, projectedOpeningsAfterCurrent, newcomers } from './data/metrics'
import Masthead from './cards/Masthead'
import KpiStrip from './cards/KpiStrip'

/**
 * CollegeProfile — the portable module entry point.
 *
 * Props (everything injected; no PitchSide imports):
 *   client, schoolId, backTo, backLabel
 *   theme — optional { accent, accentDeep, accentTint } → CSS vars on .cp-root
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
            {/* analytical cards land here next */}
          </>
        )}
      </div>
    </div>
  )
}
