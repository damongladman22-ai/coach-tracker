import './college-profile.css'
import { useProgramProfile } from './data/useProgramProfile'
import Masthead from './cards/Masthead'

/**
 * CollegeProfile — the portable module entry point.
 *
 * Props (everything injected; no PitchSide imports):
 *   client    — a Supabase client (the host passes its own)
 *   schoolId  — which program to render
 *   backTo    — href for the back link (host decides the destination)
 *   backLabel — label for the back link
 *   theme     — optional { accent, accentDeep, accentTint } → applied as CSS vars
 *               on .cp-root (per-school brand-color theming; a color map fills
 *               this later, defaults to the stylesheet's colorway)
 */
function fmtDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (isNaN(d.getTime())) return null
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
}

export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back', theme }) {
  const { loading, error, school, seasons, currentRoster, lastSyncedRaw } =
    useProgramProfile(client, schoolId)

  const styleVars = theme
    ? { '--accent': theme.accent, '--accent-deep': theme.accentDeep, '--accent-tint': theme.accentTint }
    : undefined

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

        {!loading && !error && school && (
          <>
            <Masthead
              school={school}
              currentRoster={currentRoster}
              seasons={seasons}
              lastSynced={fmtDate(lastSyncedRaw)}
            />
            {/* analytical cards land here next */}
          </>
        )}
      </div>
    </div>
  )
}
