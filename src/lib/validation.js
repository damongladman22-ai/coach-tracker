/**
 * Validation Utilities
 * 
 * Common validation functions for form inputs
 */

/**
 * Validate email address format
 * Uses RFC 5322 compliant regex pattern
 * 
 * @param {string} email - Email address to validate
 * @returns {boolean} - True if valid email format
 */
export function isValidEmail(email) {
  if (!email || typeof email !== 'string') return false;
  
  // RFC 5322 compliant email regex
  const emailRegex = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  
  return emailRegex.test(email.trim());
}

/**
 * Validate phone number format
 * Accepts various US phone formats
 * 
 * @param {string} phone - Phone number to validate
 * @returns {boolean} - True if valid phone format
 */
export function isValidPhone(phone) {
  if (!phone || typeof phone !== 'string') return false;
  
  // Remove all non-digit characters
  const digits = phone.replace(/\D/g, '');
  
  // US phone numbers should have 10 or 11 digits (with country code)
  return digits.length === 10 || (digits.length === 11 && digits.startsWith('1'));
}

/**
 * Format phone number for display
 * 
 * @param {string} phone - Phone number to format
 * @returns {string} - Formatted phone number
 */
export function formatPhone(phone) {
  if (!phone) return '';
  
  const digits = phone.replace(/\D/g, '');
  
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  } else if (digits.length === 11 && digits.startsWith('1')) {
    return `+1 (${digits.slice(1, 4)}) ${digits.slice(4, 7)}-${digits.slice(7)}`;
  }
  
  return phone;
}

/**
 * Validate required field
 * 
 * @param {string} value - Value to check
 * @returns {boolean} - True if value is not empty
 */
export function isRequired(value) {
  if (value === null || value === undefined) return false;
  if (typeof value === 'string') return value.trim().length > 0;
  return true;
}

/**
 * Validate minimum length
 * 
 * @param {string} value - Value to check
 * @param {number} min - Minimum length
 * @returns {boolean} - True if value meets minimum length
 */
export function minLength(value, min) {
  if (!value || typeof value !== 'string') return false;
  return value.trim().length >= min;
}

/**
 * Validate maximum length
 * 
 * @param {string} value - Value to check
 * @param {number} max - Maximum length
 * @returns {boolean} - True if value is within maximum length
 */
export function maxLength(value, max) {
  if (!value || typeof value !== 'string') return true;
  return value.trim().length <= max;
}

/**
 * Sanitize string for display (prevent XSS)
 * 
 * @param {string} str - String to sanitize
 * @returns {string} - Sanitized string
 */
export function sanitizeString(str) {
  if (!str || typeof str !== 'string') return '';
  
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

/**
 * Validate form field and return error message
 * 
 * @param {string} value - Value to validate
 * @param {Object} rules - Validation rules
 * @returns {string|null} - Error message or null if valid
 */
export function validateField(value, rules) {
  if (rules.required && !isRequired(value)) {
    return rules.requiredMessage || 'This field is required';
  }
  
  if (rules.email && value && !isValidEmail(value)) {
    return rules.emailMessage || 'Please enter a valid email address';
  }
  
  if (rules.phone && value && !isValidPhone(value)) {
    return rules.phoneMessage || 'Please enter a valid phone number';
  }
  
  if (rules.minLength && value && !minLength(value, rules.minLength)) {
    return rules.minLengthMessage || `Must be at least ${rules.minLength} characters`;
  }
  
  if (rules.maxLength && value && !maxLength(value, rules.maxLength)) {
    return rules.maxLengthMessage || `Must be no more than ${rules.maxLength} characters`;
  }
  
  return null;
}
