import React, { useEffect, useState } from 'react';
import { getCurrentClub } from '../lib/club';

/**
 * Club logo.
 *
 * Renders the CURRENT CLUB's logo, falling back to the bundled OP Soccer mark
 * and then to a text badge.
 *
 * Why it reads the club record: ClubSettings has shipped a branding editor for
 * some time — it writes clubs.logo_url and tells the admin "Optional. If blank,
 * the bundled OP Soccer logo is used." That sentence described an intention,
 * not the behaviour: this component ignored logo_url entirely and always drew
 * the bundled asset, so setting a club logo did nothing in any of the fourteen
 * places the mark appears. Reading the record is what makes that setting true.
 *
 * getCurrentClub() caches after its first call, so the fourteen call sites do
 * not each cost a query. The component renders the bundled fallback on the
 * first paint and swaps if a club logo resolves, rather than holding the header
 * blank while a lookup completes — a logo is decoration, and blocking layout on
 * it would be worse than showing the wrong one for a frame.
 *
 * Deliberately unchanged: the prop signature. Every caller passes only
 * className (and occasionally showText/eager), so this is a drop-in.
 */
export default function OPLogo({ className = "h-10 w-auto", showText = false, eager = false }) {
  const [imgError, setImgError] = useState(false);
  const [club, setClub] = useState(null);

  useEffect(() => {
    let alive = true;
    getCurrentClub()
      .then((c) => { if (alive) setClub(c); })
      .catch(() => { /* branding is decoration — never fail a page over it */ });
    return () => { alive = false; };
  }, []);

  // The bundled OP mark remains the fallback for the single-tenant deployment
  // and for any club that has not uploaded one.
  let bundledSrc = null;
  try {
    bundledSrc = new URL('../assets/op-soccer-logo.png', import.meta.url).href;
  } catch {
    // Asset missing — the text badge below covers it.
  }

  const clubLogo = (club?.logo_url || '').trim() || null;
  const logoSrc = imgError ? null : (clubLogo || bundledSrc);
  const name = club?.name || 'Ohio Premier';

  // Text fallback. Uses the club's initials rather than a hardcoded "OP" so a
  // club with no logo still sees itself, not the previous tenant.
  if (!logoSrc) {
    const initials = name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0])
      .join('')
      .toUpperCase() || 'OP';
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <div className="bg-gradient-to-br from-blue-600 to-cyan-500 text-white font-bold rounded-lg px-2 py-1 text-lg">
          {initials}
        </div>
        {showText && (
          <span className="font-semibold text-white">{club?.name || 'Soccer'}</span>
        )}
      </div>
    );
  }

  return (
    <img
      src={logoSrc}
      alt={name}
      className={className}
      loading={eager ? "eager" : "lazy"}
      decoding="async"
      onError={() => setImgError(true)}
    />
  );
}
