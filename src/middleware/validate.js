/**
 * Lightweight request validation middleware factory.
 * Usage: router.post("/", validate(schema), handler)
 *
 * schema: { body?: {field: validator}, query?: {...}, params?: {...} }
 * validator: a function(value) => true | "error message"
 */
function validate(schema) {
  return (req, res, next) => {
    const errors = [];

    for (const [location, fields] of Object.entries(schema)) {
      const source = req[location] || {};
      for (const [field, validator] of Object.entries(fields)) {
        const result = validator(source[field], source);
        if (result !== true) {
          errors.push({ location, field, message: result });
        }
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ error: "Validation failed", details: errors });
    }

    next();
  };
}

// ── Common validators ────────────────────────────────────────────────────────

const required = (label) => (v) =>
  v !== undefined && v !== null && v !== "" ? true : `${label} is required`;

const isString = (label) => (v) =>
  typeof v === "string" ? true : `${label} must be a string`;

const maxLen = (label, max) => (v) =>
  !v || String(v).length <= max ? true : `${label} must be at most ${max} characters`;

const isUUID = (label) => (v) =>
  !v || /^[0-9a-f-]{36}$/.test(v) ? true : `${label} must be a valid UUID`;

module.exports = { validate, required, isString, maxLen, isUUID };
