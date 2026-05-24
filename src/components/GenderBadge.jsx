import React from 'react'

/**
 * Compact M/W badge for school rows.
 * - 'M' renders blue (men's)
 * - 'W' renders pink-ish (women's)
 * - anything else renders nothing
 */
export default function GenderBadge({ gender, size = 'sm', title }) {
  if (gender !== 'M' && gender !== 'W') return null

  const colors = gender === 'M'
    ? 'bg-blue-100 text-blue-800 border-blue-200'
    : 'bg-rose-100 text-rose-800 border-rose-200'

  const sizing = size === 'xs'
    ? 'text-[10px] px-1 py-0 leading-4'
    : 'text-xs px-1.5 py-0.5 leading-4'

  return (
    <span
      className={`inline-flex items-center font-semibold rounded border ${colors} ${sizing}`}
      title={title || (gender === 'M' ? "Men's program" : "Women's program")}
    >
      {gender}
    </span>
  )
}
