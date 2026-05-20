/**
 * Returns the canonical public URL for shareable links.
 *
 * Order of precedence:
 *  1. VITE_PUBLIC_APP_URL env var if set (e.g. https://coach-tracker-zeta.vercel.app
 *     or https://tracker.opsoccer.com once a custom domain is in place)
 *  2. window.location.origin as a fallback for local dev / preview builds
 *
 * Why: admins sometimes browse preview/branch URLs like
 * coach-tracker-git-main-<scope>.vercel.app. Sharing a link built from
 * the browser URL would push that ugly preview URL to parents instead
 * of the stable public one. The env var pins shareable links to the
 * club's canonical address.
 */
export function getPublicBaseUrl() {
  const fromEnv = import.meta.env?.VITE_PUBLIC_APP_URL
  if (fromEnv && typeof fromEnv === 'string' && fromEnv.trim()) {
    // Strip trailing slash so callers can safely do `${base}/path`
    return fromEnv.trim().replace(/\/+$/, '')
  }
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin
  }
  return ''
}
