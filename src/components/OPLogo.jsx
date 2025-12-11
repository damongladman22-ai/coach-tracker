import React, { useState } from 'react';

/**
 * Ohio Premier Logo Component
 * 
 * Displays the OP Soccer logo with a fallback text display if image not found.
 * 
 * To add the real logo:
 * 1. Download from https://opsoccer.com/wp-content/uploads/2023/01/op-soccer-Logo-Dark.png
 * 2. Save as src/assets/op-soccer-logo.png
 * 3. The component will automatically use it
 */
export default function OPLogo({ className = "h-10 w-auto", showText = false }) {
  const [imgError, setImgError] = useState(false);
  
  // Try to import the logo
  let logoSrc = null;
  try {
    logoSrc = new URL('../assets/op-soccer-logo.png', import.meta.url).href;
  } catch (e) {
    // Logo not found
  }

  // If image failed to load or doesn't exist, show text fallback
  if (imgError || !logoSrc) {
    return (
      <div className={`flex items-center gap-1 ${className}`}>
        <div className="bg-gradient-to-br from-blue-600 to-cyan-500 text-white font-bold rounded-lg px-2 py-1 text-lg">
          OP
        </div>
        {showText && <span className="font-semibold text-white">Soccer</span>}
      </div>
    );
  }

  return (
    <img 
      src={logoSrc} 
      alt="Ohio Premier" 
      className={className}
      onError={() => setImgError(true)}
    />
  );
}
