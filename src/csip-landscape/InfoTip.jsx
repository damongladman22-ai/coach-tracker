import { useState, useRef, useEffect } from 'react'

/**
 * InfoTip — small ⓘ affordance for a card header. Tap/click toggles a popover
 * describing what the card shows, how to read it, and the source/caveats.
 * Accessible: real button with aria-label/aria-expanded, Escape + tap-outside
 * to dismiss, keyboard focusable. Touch-friendly (no hover dependency).
 */
export default function InfoTip({ title, what, read, source, align = 'right' }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    const onDoc = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    const onKey = e => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc)
    document.addEventListener('touchstart', onDoc)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDoc)
      document.removeEventListener('touchstart', onDoc)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <span className="csl-info" ref={ref}>
      <button
        type="button"
        className="csl-info-btn"
        aria-label={`About: ${title}`}
        aria-expanded={open}
        onClick={() => setOpen(o => !o)}
      >
        <svg viewBox="0 0 20 20" width="17" height="17" aria-hidden="true">
          <circle cx="10" cy="10" r="8.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
          <circle cx="10" cy="6.1" r="1.15" fill="currentColor" />
          <rect x="9.1" y="8.7" width="1.8" height="6" rx="0.9" fill="currentColor" />
        </svg>
      </button>
      {open && (
        <div className={`csl-info-pop csl-info-pop--${align}`} role="dialog" aria-label={title}>
          <div className="csl-info-pop-h">
            <span className="csl-info-pop-title">{title}</span>
            <button type="button" className="csl-info-pop-x" aria-label="Close" onClick={() => setOpen(false)}>×</button>
          </div>
          {what && <p><b>What this shows.</b> {what}</p>}
          {read && <p><b>How to read it.</b> {read}</p>}
          {source && <p className="csl-info-src">{source}</p>}
        </div>
      )}
    </span>
  )
}
