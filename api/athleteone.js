import discoverClubTeams from '../server/athleteone/discover-athleteone-club-teams.js'
import getGames from '../server/athleteone/get-athleteone-games.js'

/**
 * One serverless function for the two admin-only AthleteOne helpers.
 *
 * Vercel's Hobby plan allows 12 functions per deployment; adding /api/ask
 * (backlog F2, 2026-10-13) made 13. These two helpers were merged here so the
 * nightly ingest (/api/ingest-athleteone) stays exactly as it was. Their old
 * addresses still work through rewrites in vercel.json:
 *   /api/discover-athleteone-club-teams  -> /api/athleteone?op=discover
 *   /api/get-athleteone-games            -> /api/athleteone?op=games
 * The original handlers are unchanged, in server/athleteone/ (outside api/,
 * so Vercel does not count them as functions).
 */
export default async function handler(req, res) {
  const op = req.query?.op
  if (op === 'discover') return discoverClubTeams(req, res)
  if (op === 'games') return getGames(req, res)
  return res.status(404).json({ error: 'unknown op' })
}
