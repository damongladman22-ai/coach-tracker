import { useState, useEffect, useRef } from 'react'

/**
 * SectionNav — a sticky pill bar that jumps to anchored sections and highlights
 * the one in view (scroll-spy). On narrow screens the bar scrolls horizontally,
 * so we keep the active chip centered/visible as the active section changes.
 */
export default function SectionNav({ items }) {
  const [active, setActive] = useState(items[0]?.id)
  const navRef = useRef(null)
  const chipRefs = useRef({})

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

  // keep the active chip in view within the horizontally-scrolling pill
  useEffect(() => {
    const nav = navRef.current
    const chip = chipRefs.current[active]
    if (nav && chip) {
      const target = chip.offsetLeft - (nav.clientWidth - chip.offsetWidth) / 2
      nav.scrollTo({ left: Math.max(0, target), behavior: 'smooth' })
    }
  }, [active])

  const jump = id => {
    const el = document.getElementById(id)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return (
    <nav className="cp-nav" aria-label="Profile sections">
      <div className="cp-nav-inner" ref={navRef}>
        {items.map(i => (
          <button key={i.id} type="button"
            ref={el => { chipRefs.current[i.id] = el }}
            className={'cp-navchip' + (active === i.id ? ' cp-navchip--on' : '')}
            aria-current={active === i.id ? 'true' : undefined}
            onClick={() => jump(i.id)}>{i.label}</button>
        ))}
      </div>
    </nav>
  )
}
