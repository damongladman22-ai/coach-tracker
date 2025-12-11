import React from 'react';

/**
 * Full-page loading spinner
 * Use for initial page loads
 */
export function PageLoader({ message = 'Loading...' }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-gray-50">
      <div className="animate-spin rounded-full h-12 w-12 border-4 border-blue-500 border-t-transparent mb-4"></div>
      <p className="text-gray-600 text-lg">{message}</p>
    </div>
  );
}

/**
 * Inline loading spinner
 * Use within components or sections
 */
export function Spinner({ size = 'md', className = '' }) {
  const sizeClasses = {
    sm: 'h-4 w-4 border-2',
    md: 'h-8 w-8 border-3',
    lg: 'h-12 w-12 border-4'
  };

  return (
    <div 
      className={`animate-spin rounded-full border-blue-500 border-t-transparent ${sizeClasses[size]} ${className}`}
    />
  );
}

/**
 * Loading button state
 * Shows spinner inside button while action is in progress
 */
export function LoadingButton({ 
  loading, 
  children, 
  onClick, 
  className = '',
  disabled = false,
  type = 'button'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={loading || disabled}
      className={`relative flex items-center justify-center ${className} ${
        (loading || disabled) ? 'opacity-70 cursor-not-allowed' : ''
      }`}
    >
      {loading && (
        <Spinner size="sm" className="absolute" />
      )}
      <span className={loading ? 'invisible' : ''}>{children}</span>
    </button>
  );
}

/**
 * Error message display
 * Shows error with retry button
 */
export function ErrorMessage({ 
  message, 
  onRetry, 
  title = 'Something went wrong' 
}) {
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg p-4 my-4">
      <div className="flex items-start">
        <div className="flex-shrink-0">
          <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
          </svg>
        </div>
        <div className="ml-3 flex-1">
          <h3 className="text-sm font-medium text-red-800">{title}</h3>
          <p className="mt-1 text-sm text-red-700">{message}</p>
          {onRetry && (
            <button
              onClick={onRetry}
              className="mt-3 text-sm font-medium text-red-600 hover:text-red-500 underline"
            >
              Try again
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Toast notification for success/error messages
 * Auto-dismisses after a few seconds
 */
export function Toast({ 
  show, 
  message, 
  type = 'success', 
  onClose,
  duration = 3000 
}) {
  React.useEffect(() => {
    if (show && duration > 0) {
      const timer = setTimeout(onClose, duration);
      return () => clearTimeout(timer);
    }
  }, [show, duration, onClose]);

  if (!show) return null;

  const typeStyles = {
    success: 'bg-green-500',
    error: 'bg-red-500',
    info: 'bg-blue-500',
    warning: 'bg-yellow-500'
  };

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 md:left-auto md:right-4 md:w-96">
      <div className={`${typeStyles[type]} text-white px-4 py-3 rounded-lg shadow-lg flex items-center justify-between`}>
        <span>{message}</span>
        <button onClick={onClose} className="ml-4 text-white/80 hover:text-white">
          <svg className="h-5 w-5" viewBox="0 0 20 20" fill="currentColor">
            <path fillRule="evenodd" d="M4.293 4.293a1 1 0 011.414 0L10 8.586l4.293-4.293a1 1 0 111.414 1.414L11.414 10l4.293 4.293a1 1 0 01-1.414 1.414L10 11.414l-4.293 4.293a1 1 0 01-1.414-1.414L8.586 10 4.293 5.707a1 1 0 010-1.414z" clipRule="evenodd" />
          </svg>
        </button>
      </div>
    </div>
  );
}

/**
 * Empty state display
 * Shows when no data is available
 */
export function EmptyState({ 
  title, 
  message, 
  action,
  icon = 'clipboard' 
}) {
  const icons = {
    clipboard: (
      <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
      </svg>
    ),
    users: (
      <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    ),
    calendar: (
      <svg className="h-12 w-12 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
      </svg>
    )
  };

  return (
    <div className="text-center py-12 px-4">
      <div className="flex justify-center mb-4">
        {icons[icon]}
      </div>
      <h3 className="text-lg font-medium text-gray-900 mb-2">{title}</h3>
      <p className="text-gray-500 mb-4">{message}</p>
      {action}
    </div>
  );
}

/**
 * Skeleton loader for content placeholder
 * Shows pulsing placeholder while content loads
 */
export function Skeleton({ className = '', variant = 'text' }) {
  const baseClass = 'animate-pulse bg-gray-200 rounded';
  
  const variants = {
    text: 'h-4 w-full',
    title: 'h-6 w-3/4',
    avatar: 'h-10 w-10 rounded-full',
    button: 'h-10 w-24',
    card: 'h-32 w-full'
  };

  return <div className={`${baseClass} ${variants[variant]} ${className}`} />;
}

/**
 * Card skeleton for loading lists
 */
export function CardSkeleton({ count = 3 }) {
  return (
    <div className="space-y-4">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="bg-white rounded-lg border p-4">
          <Skeleton variant="title" className="mb-3" />
          <Skeleton variant="text" className="mb-2" />
          <Skeleton variant="text" className="w-2/3" />
        </div>
      ))}
    </div>
  );
}

/**
 * Auto-refresh status indicator
 * Shows that data refreshes automatically every few seconds
 */
export function ConnectionStatus({ lastUpdate }) {
  const [secondsAgo, setSecondsAgo] = React.useState(0);

  React.useEffect(() => {
    if (!lastUpdate) return;
    
    const updateSeconds = () => {
      const diff = Math.floor((new Date() - lastUpdate) / 1000);
      setSecondsAgo(diff);
    };
    
    updateSeconds();
    const interval = setInterval(updateSeconds, 1000);
    return () => clearInterval(interval);
  }, [lastUpdate]);

  if (!lastUpdate) return null;

  return (
    <div className="fixed top-2 right-2 px-2 py-1 rounded-full text-xs flex items-center gap-1 bg-green-100 text-green-700">
      <span className="h-2 w-2 rounded-full bg-green-500" />
      {secondsAgo < 5 ? 'Just updated' : `Updated ${secondsAgo}s ago`}
    </div>
  );
}
