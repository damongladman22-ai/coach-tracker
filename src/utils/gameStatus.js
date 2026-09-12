/**
 * Shared game-status rules.
 *
 * The "is this game still open?" decision was implemented twice — once in
 * ClubDashboard's home card and once in PublicTeamPage's GameCard — with
 * identical logic and two identically-implemented date parsers under different
 * names (parseDate / parseGameDate). A rule copied into two screens is a rule
 * that eventually disagrees with itself, and these two must never disagree:
 * they render the same "Open Tracker" affordance for the same game.
 */

import { gameResult } from '../components/ScoreInput'

/** Parse a date-only 'YYYY-MM-DD' string in LOCAL time.
 *  new Date('2026-09-12') would parse as UTC midnight and shift a day
 *  backwards in western timezones, which is why this is explicit. */
export function parseGameDate(s) {
  if (!s) return new Date()
  const [y, m, d] = s.split('-')
  return new Date(y, m - 1, d)
}

/** Local midnight today — the reference point for date-only comparisons. */
export function startOfToday() {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d
}

/** A posted score, or a result label, means the game has been played.
 *  Same signal the result badge uses, so the two can never disagree. */
export function hasGameResult(game) {
  return (
    !!gameResult(game).label ||
    game.our_score != null ||
    game.opponent_score != null
  )
}

/**
 * Deliberately DATE-ONLY, with no time-of-day comparison. AthleteOne games
 * carry a blanket and often wrong timezone, so a clock-based "kick-off has
 * passed" test cannot be trusted. Score presence is the reliable signal.
 * Pass `today` when looping over many games to avoid recomputing it.
 */
export function isGamePast(game, today = startOfToday()) {
  if (hasGameResult(game) || game.is_closed) return true
  return parseGameDate(game.game_date) < today
}

/**
 * The Open Tracker rule: attached to an event, not past, not closed.
 * This is the single definition both the home card and the team page use.
 */
export function isTrackerOpen(game, today = startOfToday()) {
  return !!game.events?.slug && !isGamePast(game, today) && !game.is_closed
}
