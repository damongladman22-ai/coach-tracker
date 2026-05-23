import { useEffect, useState, useCallback } from 'react'

const STORAGE_KEY = 'pitchside.favorites'
const CHANGE_EVENT = 'pitchside-favorites-change'

/**
 * Read the current favorites list from localStorage. Returns array of team IDs
 * (numbers). Tolerates corrupted/missing data by returning an empty array.
 */
export function getFavorites() {
  if (typeof window === 'undefined') return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

/**
 * Write favorites and notify other useFavorite/useFavorites consumers on
 * the same page. Fires a custom window event because the standard "storage"
 * event only fires across different tabs, not within the same one.
 */
function writeFavorites(ids) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ids))
    window.dispatchEvent(new Event(CHANGE_EVENT))
  } catch {
    // Quota exceeded or private-mode: swallow silently — failing the UI for
    // a corrupt localStorage is worse than just not persisting.
  }
}

/**
 * useFavorite — true/false state for whether a single teamId is favorited,
 * with a setter that persists to localStorage and notifies peers.
 *
 * Usage:
 *   const [isFavorite, setFavorite] = useFavorite(team.id)
 *   <button onClick={() => setFavorite(!isFavorite)}>{isFavorite ? '★' : '☆'}</button>
 */
export function useFavorite(teamId) {
  const [favorite, setFavoriteState] = useState(() =>
    getFavorites().includes(teamId)
  )

  // Sync with peers — when another TeamCard or the "My Teams" section
  // changes favorites, this hook reflects it immediately.
  useEffect(() => {
    if (teamId == null) return
    const handler = () => {
      setFavoriteState(getFavorites().includes(teamId))
    }
    window.addEventListener(CHANGE_EVENT, handler)
    window.addEventListener('storage', handler) // cross-tab
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [teamId])

  const setFavorite = useCallback(
    (newVal) => {
      const current = getFavorites()
      let next
      if (newVal) {
        next = current.includes(teamId) ? current : [...current, teamId]
      } else {
        next = current.filter((id) => id !== teamId)
      }
      writeFavorites(next)
      setFavoriteState(newVal)
    },
    [teamId]
  )

  return [favorite, setFavorite]
}

/**
 * useFavorites — the full list of favorited team IDs. Useful for the
 * "My Teams" section at the top of /home, where we render every favorited
 * team regardless of which one any individual card holds.
 */
export function useFavorites() {
  const [favorites, setFavorites] = useState(() => getFavorites())

  useEffect(() => {
    const handler = () => setFavorites(getFavorites())
    window.addEventListener(CHANGE_EVENT, handler)
    window.addEventListener('storage', handler)
    return () => {
      window.removeEventListener(CHANGE_EVENT, handler)
      window.removeEventListener('storage', handler)
    }
  }, [])

  return favorites
}
