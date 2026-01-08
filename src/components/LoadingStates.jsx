import React, { useEffect, useState } from 'react';

/**
 * Full-page loading spinner
 */
export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center">
      <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4"></div>
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

/**
 * Inline spinner
 */
export function Spinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'h-4 w-4',
    md: 'h-6 w-6',
    lg: 'h-8 w-8'
  };

  return (
    <div className={`animate-spin rounded-full border-b-2 border-blue-600 ${sizeClasses[size]} ${className}`}></div>
  );
}

/**
 * Button with loading state
 */
export function LoadingButton({ 
  children, 
  loading = false, 
  disabled = false, 
  className = '', 
  ...props 
}) {
  return (
    <button
      disabled={loading || disabled}
      className={`relative ${className} ${(loading || disabled) ? 'opacity-70 cursor-not-allowed' : ''}`}
      {...props}
    >
      {loading && (
        <span className="absolute inset-0 flex items-center justify-center">
          <Spinner size="sm" />
        </span>
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
}

/**
 * Error message with retry option
 */
export function ErrorMessage({ 
  title = 'Something went wrong', 
  message = 'Please try again.', 
  onRetry 
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
      <div className="text-red-600 mb-2">
        <svg className="h-12 w-12 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
      </div>
      <h3 className="font-semibold text-red-800 mb-1">{title}</h3>
      <p className="text-red-600 text-sm mb-4">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="px-4 py-2 bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors"
        >
          Try Again
        </button>
      )}
    </div>
  );
}

/**
 * Toast notification
 */
export function Toast({ show, message, type = 'success', onClose, duration = 3000 }) {
  useEffect(() => {
    if (show && duration > 0) {
      const timer = setTimeout(() => {
        onClose?.();
      }, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  if (!show) return null;

  const bgColor = type === 'success' ? 'bg-green-600' : type === 'error' ? 'bg-red-600' : 'bg-blue-600';

  return (
    <div className="fixed bottom-20 left-4 right-4 z-50 animate-slide-up">
      <div className={`${bgColor} text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between`}>
        <span>{message}</span>
        <button onClick={onClose} className="ml-2 hover:opacity-80">
          <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Empty state
 */
export function EmptyState({ 
  icon, 
  title, 
  message, 
  action 
}) {
  return (
    <div className="text-center py-12 px-4">
      {icon && <div className="text-gray-400 mb-4">{icon}</div>}
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 mb-4">{message}</p>
      {action}
    </div>
  );
}

/**
 * Connection/refresh status indicator
 */
export function ConnectionStatus({ lastUpdate }) {
  const [secondsAgo, setSecondsAgo] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (!lastUpdate) return;

    const updateSeconds = () => {
      const diff = Math.floor((new Date() - lastUpdate) / 1000);
      setSecondsAgo(diff);
    };

    updateSeconds();
    const interval = setInterval(updateSeconds, 1000);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  // Hide after 5 seconds if everything is working
  useEffect(() => {
    if (secondsAgo < 10) {
      const timer = setTimeout(() => setVisible(false), 5000);
      return () => clearTimeout(timer);
    } else {
      setVisible(true);
    }
  }, [secondsAgo, lastUpdate]);

  if (!lastUpdate) return null;

  const isRecent = secondsAgo < 10;

  // Only show if stale or recently updated (for first 5 seconds)
  if (!visible && isRecent) return null;

  return (
    <div className="fixed bottom-24 right-4 z-40">
      <div className={`text-xs px-3 py-1.5 rounded-full shadow-md ${
        isRecent 
          ? 'bg-green-100 text-green-700 border border-green-200' 
          : 'bg-yellow-100 text-yellow-700 border border-yellow-200'
      }`}>
        {isRecent ? (
          <span className="flex items-center gap-1">
            <span className="h-1.5 w-1.5 bg-green-500 rounded-full animate-pulse"></span>
            Live
          </span>
        ) : (
          <span>Updated {secondsAgo}s ago</span>
        )}
      </div>
    </div>
  );
}

/**
 * Skeleton loading placeholder
 */
export function Skeleton({ className = '' }) {
  return (
    <div className={`animate-pulse bg-gray-200 rounded ${className}`}></div>
  );
}

/**
 * Card skeleton for loading states
 */
export function CardSkeleton() {
  return (
    <div className="bg-white rounded-lg border p-4">
      <Skeleton className="h-6 w-3/4 mb-3" />
      <Skeleton className="h-4 w-1/2 mb-2" />
      <Skeleton className="h-4 w-2/3" />
    </div>
  );
}

/**
 * List item skeleton for loading states
 */
export function ListItemSkeleton({ count = 3 }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 p-3 bg-white rounded-lg border">
          <Skeleton className="h-10 w-10 rounded-full flex-shrink-0" />
          <div className="flex-1">
            <Skeleton className="h-4 w-2/3 mb-2" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Table skeleton for loading states
 */
export function TableSkeleton({ rows = 5, cols = 4 }) {
  return (
    <div className="bg-white rounded-lg border overflow-hidden">
      {/* Header */}
      <div className="bg-gray-50 border-b p-3 flex gap-4">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1" />
        ))}
      </div>
      {/* Rows */}
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, rowIdx) => (
          <div key={rowIdx} className="p-3 flex gap-4">
            {Array.from({ length: cols }).map((_, colIdx) => (
              <Skeleton key={colIdx} className="h-4 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * Game card skeleton for loading states
 */
export function GameCardSkeleton({ count = 3 }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border shadow-sm p-4">
          <div className="flex justify-between items-start gap-3">
            <div className="flex-1">
              <Skeleton className="h-4 w-24 mb-2" />
              <Skeleton className="h-6 w-48" />
            </div>
            <Skeleton className="h-10 w-28 rounded-lg" />
          </div>
          <div className="mt-3 pt-3 border-t">
            <Skeleton className="h-4 w-40" />
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Stats skeleton for dashboard-style loading
 */
export function StatsSkeleton({ count = 4 }) {
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border p-4">
          <Skeleton className="h-3 w-16 mb-2" />
          <Skeleton className="h-8 w-12" />
        </div>
      ))}
    </div>
  );
}

// Add slide-up animation style
const style = document.createElement('style');
style.textContent = `
  @keyframes slide-up {
    from {
      transform: translateY(100%);
      opacity: 0;
    }
    to {
      transform: translateY(0);
      opacity: 1;
    }
  }
  .animate-slide-up {
    animation: slide-up 0.3s ease-out;
  }
`;
if (typeof document !== 'undefined' && !document.getElementById('loading-states-styles')) {
  style.id = 'loading-states-styles';
  document.head.appendChild(style);
}
