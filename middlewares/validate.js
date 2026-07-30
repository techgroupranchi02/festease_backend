/**
 * Validation Utility
 *
 * Usage:
 *   const { validate, rules } = require('../middlewares/validate');
 *
 *   validate(req.body, {
 *     name:  [rules.required(), rules.string(), rules.maxLength(255)],
 *     email: [rules.required(), rules.email()],
 *     roles: [rules.required(), rules.array()],
 *   })
 *
 * Returns: { valid: true } | { valid: false, errors: { field: [msg, ...] } }
 *
 * To send the standard 422 response immediately:
 *   const result = validate(data, schema);
 *   if (!result.valid) return sendValidationError(res, result.errors);
 */

/**
 * Built-in rule factories.
 * Each factory returns a function: (value, fieldName, allData) => string|null
 *   - Returns an error message string on failure.
 *   - Returns null on success.
 */
const rules = {
  /** Field must be present and not empty/null/undefined */
  required: () => (value, field) => {
    if (value === undefined || value === null || value === '') {
      return `The ${field} field is required.`;
    }
    return null;
  },

  /** Value must be a string */
  string: () => (value, field) => {
    if (value !== undefined && value !== null && typeof value !== 'string') {
      return `The ${field} field must be a string.`;
    }
    return null;
  },

  /** Value must be a number (or numeric string coercible to a number) */
  numeric: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '' && isNaN(Number(value))) {
      return `The ${field} field must be a number.`;
    }
    return null;
  },

  /** Value must be a positive integer */
  positiveInt: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      const n = Number(value);
      if (!Number.isInteger(n) || n <= 0) {
        return `The ${field} field must be a positive integer.`;
      }
    }
    return null;
  },

  /** Value must be a valid email address */
  email: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(String(value).trim())) {
        return `The ${field} field must be a valid email address.`;
      }
    }
    return null;
  },

  /** Value must be a boolean */
  boolean: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      if (typeof value !== 'boolean') {
        return `The ${field} field must be a boolean.`;
      }
    }
    return null;
  },

  /** Value must be a non-empty array */
  array: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      if (!Array.isArray(value) || value.length === 0) {
        return `The ${field} field must be a non-empty array.`;
      }
    }
    return null;
  },

  /** Value must be one of the allowed values */
  inList: (allowed) => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      if (!allowed.includes(value)) {
        return `The ${field} field must be one of: ${allowed.join(', ')}.`;
      }
    }
    return null;
  },

  /** Value must not exceed maxLen characters */
  maxLength: (maxLen) => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      if (String(value).length > maxLen) {
        return `The ${field} field must not exceed ${maxLen} characters.`;
      }
    }
    return null;
  },

  /** Value must be at least minLen characters */
  minLength: (minLen) => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      if (String(value).length < minLen) {
        return `The ${field} field must be at least ${minLen} characters.`;
      }
    }
    return null;
  },

  /** Value must be a valid date string */
  date: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Date.parse(String(value));
      if (isNaN(parsed)) {
        return `The ${field} must be a valid date.`;
      }
    }
    return null;
  },

  /** Date value must not be in the past */
  futureDate: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      const parsed = Date.parse(String(value));
      if (!isNaN(parsed) && new Date(parsed) < new Date()) {
        return `The ${field} cannot be a past date.`;
      }
    }
    return null;
  },

  /** Value must be a valid phone number (digits, spaces, dashes, +, parens) */
  phone: () => (value, field) => {
    if (value !== undefined && value !== null && value !== '') {
      const phoneRegex = /^[+\d][\d\s\-().]{6,19}$/;
      if (!phoneRegex.test(String(value).trim())) {
        return `The ${field} field must be a valid phone number.`;
      }
    }
    return null;
  },
};

/**
 * Core validation function.
 *
 * @param {object} data   - The input object to validate (e.g. req.body, req.params).
 * @param {object} schema - Map of field name → array of rule functions.
 * @returns {{ valid: boolean, errors: object }}
 */
function validate(data, schema) {
  const errors = {};

  for (const [field, fieldRules] of Object.entries(schema)) {
    const value = data ? data[field] : undefined;
    const fieldErrors = [];

    for (const rule of fieldRules) {
      const msg = rule(value, field, data);
      if (msg) fieldErrors.push(msg);
    }

    if (fieldErrors.length > 0) {
      errors[field] = fieldErrors;
    }
  }

  return Object.keys(errors).length > 0
    ? { valid: false, errors }
    : { valid: true, errors: {} };
}

/**
 * Send the standard 422 validation error response.
 *
 * @param {object} res    - Express response object.
 * @param {object} errors - Error map from validate().
 */
function sendValidationError(res, errors) {
  return res.status(422).json({
    success: false,
    message: 'Validation failed.',
    errors,
  });
}

module.exports = { validate, rules, sendValidationError };
