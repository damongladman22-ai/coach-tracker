import { useState } from 'react'

export default function HelpTooltip({ text, children }) {
  const [isOpen, setIsOpen] = useState(false)

  return (
    <div className="relative inline-block">
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        onBlur={() => setTimeout(() => setIsOpen(false), 150)}
        className="ml-1 w-5 h-5 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-600 text-xs font-bold inline-flex items-center justify-center"
        aria-label="Help"
      >
        ?
      </button>
      
      {isOpen && (
        <div className="absolute z-50 w-64 p-3 mt-1 text-sm bg-gray-900 text-white rounded-lg shadow-lg left-0 top-full">
          <div className="relative">
            {children || text}
            <div className="absolute -top-2 left-2 w-0 h-0 border-l-8 border-r-8 border-b-8 border-transparent border-b-gray-900"></div>
          </div>
        </div>
      )}
    </div>
  )
}

// Larger help button variant for mobile
export function HelpButton({ onClick, className = '' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-8 h-8 rounded-full bg-blue-100 hover:bg-blue-200 text-blue-600 text-sm font-bold inline-flex items-center justify-center ${className}`}
      aria-label="Help"
    >
      ?
    </button>
  )
}
