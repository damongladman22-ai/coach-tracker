/**
 * Utility functions for the Coach Tracker app
 */

/**
 * Parse date string to avoid timezone issues
 * Database stores dates as YYYY-MM-DD strings
 * This parses them without UTC conversion
 */
export function parseLocalDate(dateStr) {
  if (!dateStr) return null;
  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(year, month - 1, day);
}

/**
 * Format date for display
 */
export function formatDate(dateStr, options = {}) {
  const date = parseLocalDate(dateStr);
  if (!date) return '';
  
  const defaultOptions = {
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  };
  
  return date.toLocaleDateString('en-US', { ...defaultOptions, ...options });
}

/**
 * Format date range for events
 */
export function formatDateRange(startDate, endDate) {
  const start = parseLocalDate(startDate);
  const end = parseLocalDate(endDate);
  
  if (!start) return '';
  if (!end || startDate === endDate) {
    return formatDate(startDate);
  }
  
  // Same month
  if (start.getMonth() === end.getMonth()) {
    return `${start.toLocaleDateString('en-US', { month: 'short' })} ${start.getDate()}-${end.getDate()}, ${start.getFullYear()}`;
  }
  
  // Different months
  return `${formatDate(startDate, { weekday: undefined })} - ${formatDate(endDate, { weekday: undefined })}`;
}

/**
 * Generate URL-friendly slug from text
 */
export function generateSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Debounce function for search inputs
 */
export function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

/**
 * Group array items by a key
 */
export function groupBy(array, keyFn) {
  return array.reduce((result, item) => {
    const key = keyFn(item);
    if (!result[key]) {
      result[key] = [];
    }
    result[key].push(item);
    return result;
  }, {});
}

/**
 * Sort function for coach names
 */
export function sortByName(a, b) {
  const nameA = `${a.last_name} ${a.first_name}`.toLowerCase();
  const nameB = `${b.last_name} ${b.first_name}`.toLowerCase();
  return nameA.localeCompare(nameB);
}

/**
 * Check if we're on a mobile device
 */
export function isMobile() {
  return window.innerWidth < 768;
}

/**
 * Safe JSON parse with fallback
 */
export function safeJsonParse(str, fallback = null) {
  try {
    return JSON.parse(str);
  } catch {
    return fallback;
  }
}

/**
 * Truncate text with ellipsis
 */
export function truncate(str, maxLength = 50) {
  if (!str || str.length <= maxLength) return str;
  return str.slice(0, maxLength - 3) + '...';
}
