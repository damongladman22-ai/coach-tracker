import './college-profile.css'

/**
 * CollegeProfile — the portable module entry point.
 *
 * Receives everything through props so it never imports PitchSide internals:
 *   client    — a Supabase client (the host passes its own)
 *   schoolId  — which program to render
 *   backTo    — href for the back link (host decides the destination)
 *   backLabel — label for the back link
 *
 * Scaffold stage: renders a styled placeholder under .cp-root to prove the
 * module mounts, is scoped, and loads its own design system. Cards land next.
 */
export default function CollegeProfile({ client, schoolId, backTo = '/', backLabel = 'Back' }) {
  return (
    <div className="cp-root">
      <div className="cp-wrap">
        <div className="cp-scaffold">
          <p className="cp-eyebrow">College Profile · scaffold</p>
          <h1>Module mounted</h1>
          <p>Rendering for school <code>{String(schoolId)}</code>.</p>
          <p>{client ? 'Data client connected.' : 'No data client.'}</p>
          <a className="cp-back" href={backTo}>‹ {backLabel}</a>
        </div>
      </div>
    </div>
  )
}
