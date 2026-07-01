import { useState, useEffect } from 'react'

/**
 * SectionNav — a sticky pill bar that jumps to anchored sections and highlights
 * the one in view (scroll-spy via IntersectionObserver). Purely wayfinding; the
 * page stays a single scroll.
 */
export default function SectionNav({ items }) {
  const [active, setActive] = useState(items[0]?.id)

  useEffect(() => {
    const els = items.map(i => document.getElementById(i.id)).filter(Boolean)
    if (!els.length || typeof IntersectionObserver === 'undefined') return
    const obs = new IntersectionObserver(entries => {
      const vis = entries.filter(e => e.isIntersecting)
      if (vis.length) {
        vis.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        setActive(vis[0].target.id)
      }
    }, { rootMargin: '-72px 0px -70% 0px', threshold: 0 })
    els.forEach(el => obs.observe(el))
    return () => obs.disconnect()
  }, [items])

  const jump = id => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className="cp-nav" aria-label="Profile sections">
      <div className="cp-nav-inner">
        {items.map(i => (
          <button key={i.id} type="button"
            className={'cp-navchip' + (active === i.id ? ' cp-navchip--on' : '')}
            aria-current={active === i.id ? 'true' : undefined}
            onClick={() => jump(i.id)}>{i.label}</button>
        ))}
      </div>
    </nav>
  )
}
