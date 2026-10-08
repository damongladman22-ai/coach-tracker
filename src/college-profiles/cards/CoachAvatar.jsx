import { useState } from 'react'
import { useCoachHeadshot } from '../data/coachHeadshots'

/**
 * CoachAvatar — a coach's round headshot, or `fallback` when there is none.
 *
 * `fallback` is what the surface showed before headshots existed (the profile
 * card's initials circle; nothing at all in the Coach Directory and on event
 * summaries), so with the owner switch off every surface is unchanged.
 * A photo that fails to load also falls back. Decorative: the coach's name is
 * always printed beside it, so the image carries empty alt text.
 */
export default function CoachAvatar({ client, coach, size = 40, fallback = null, dim = false }) {
  const url = useCoachHeadshot(client, coach?.id)
  const [failed, setFailed] = useState(null)
  if (!url || failed === url) return fallback
  return (
    <img
      src={url}
      alt=""
      width={size}
      height={size}
      loading="lazy"
      decoding="async"
      onError={() => setFailed(url)}
      style={{
        width: size, height: size, flex: 'none', borderRadius: '50%', objectFit: 'cover',
        background: '#F2F3F5', boxShadow: 'inset 0 0 0 1px rgba(0,0,0,.06)',
        opacity: dim ? 0.55 : 1, filter: dim ? 'grayscale(1)' : 'none',
      }}
    />
  )
}
