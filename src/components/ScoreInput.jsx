import { useState, useEffect } from 'react'

/**
 * Inline score entry for a game.
 *
 * Two small number inputs (our, opp) and a Save button.
 * Calls onSave(ourScore, opponentScore) when clicked.
 * Pass null/null to clear a score.
 *
 * Props:
 *   ourScore        – current value (number or null)
 *   opponentScore   – current value (number or null)
 *   onSave(o, p)    – async callback; pass numbers or nulls
 *   compact         – smaller layout
 */
export default function ScoreInput({
  ourScore,
  opponentScore,
  onSave,
  compact = false,
}) {
  const [our, setOur] = useState(ourScore ?? '')
  const [opp, setOpp] = useState(opponentScore ?? '')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    setOur(ourScore ?? '')
    setOpp(opponentScore ?? '')
  }, [ourScore, opponentScore])

  const isDirty =
    String(our) !== String(ourScore ?? '') ||
    String(opp) !== String(opponentScore ?? '')

  const isValidPair = () => {
    if (our === '' && opp === '') return true // clearing is fine
    if (our === '' || opp === '') return false // one missing
    return Number.isInteger(Number(our)) && Number.isInteger(Number(opp)) &&
      Number(our) >= 0 && Number(opp) >= 0
  }

  const handleSave = async () => {
    if (!isValidPair()) return
    setSaving(true)
    const o = our === '' ? null : Number(our)
    const p = opp === '' ? null : Number(opp)
    await onSave(o, p)
    setSaving(false)
    setSaved(true)
    setTimeout(() => setSaved(false), 1500)
  }

  const inputClasses = compact
    ? 'w-12 px-2 py-1 border border-gray-300 rounded text-sm text-center'
    : 'w-14 px-2 py-1 border border-gray-300 rounded text-center'

  return (
    <div className="flex items-center gap-1">
      <input
        type="number"
        min="0"
        value={our}
        onChange={(e) => setOur(e.target.value)}
        placeholder="—"
        className={inputClasses}
        aria-label="Our score"
      />
      <span className="text-gray-400">–</span>
      <input
        type="number"
        min="0"
        value={opp}
        onChange={(e) => setOpp(e.target.value)}
        placeholder="—"
        className={inputClasses}
        aria-label="Opponent score"
      />
      {isDirty && (
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || !isValidPair()}
          className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-2 py-1 rounded disabled:bg-gray-300"
        >
          {saving ? '...' : 'Save'}
        </button>
      )}
      {saved && (
        <span className="text-green-600 text-xs">✓</span>
      )}
    </div>
  )
}

/**
 * Compute team season record from a list of games.
 * Returns { wins, losses, ties, gf, ga, played, gd, percent }.
 */
export function computeRecord(games) {
  let wins = 0,
    losses = 0,
    ties = 0,
    gf = 0,
    ga = 0,
    played = 0
  games.forEach((g) => {
    if (g.our_score == null || g.opponent_score == null) return
    played += 1
    gf += g.our_score
    ga += g.opponent_score
    if (g.our_score > g.opponent_score) wins += 1
    else if (g.our_score < g.opponent_score) losses += 1
    else ties += 1
  })
  const points = wins * 3 + ties
  const percent = played > 0 ? Math.round(((wins + ties * 0.5) / played) * 100) : 0
  return { wins, losses, ties, gf, ga, played, gd: gf - ga, points, percent }
}

/**
 * Get a result label for a single game.
 * Returns { label: 'W'|'L'|'T'|null, color: tailwind classes }
 */
export function gameResult(game) {
  if (game.our_score == null || game.opponent_score == null) {
    return { label: null, color: '' }
  }
  if (game.our_score > game.opponent_score)
    return {
      label: 'W',
      color: 'bg-emerald-100 text-emerald-700',
      score: `${game.our_score}-${game.opponent_score}`,
    }
  if (game.our_score < game.opponent_score)
    return {
      label: 'L',
      color: 'bg-rose-100 text-rose-700',
      score: `${game.our_score}-${game.opponent_score}`,
    }
  return {
    label: 'T',
    color: 'bg-gray-200 text-gray-700',
    score: `${game.our_score}-${game.opponent_score}`,
  }
}
