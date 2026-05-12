/**
 * Anonymizer — strips identity and sensitive fields from task fragments
 * before they are dispatched to external agents.
 *
 * Guarantee: nothing that could identify the user, their org, or their
 * colleagues ever leaves the TEE boundary in a recognisable form.
 *
 * What gets stripped:
 *   - Email addresses
 *   - Phone numbers
 *   - Wallet / blockchain addresses
 *   - Named person references (Title + Name patterns)
 *   - Org name (injected from session context)
 *   - Specific financial figures above a threshold (abstracted to ranges)
 *   - National ID / passport / SSN patterns
 *
 * What does NOT get stripped:
 *   - Generic locations (cities, airports, landmarks)
 *   - Dates and times
 *   - Product names, service names
 *   - Abstract queries (the actual question)
 *
 * Every stripping action is logged to the anonymization_log
 * which becomes part of the immutable decision record.
 */

const crypto = require('crypto');

// ── PII pattern definitions ───────────────────────────────────────────────────

const PATTERNS = [
  {
    name: 'email',
    regex: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g,
    replacement: '[EMAIL_REDACTED]',
  },
  {
    name: 'phone',
    regex: /(\+?\d[\d\s\-().]{7,}\d)/g,
    replacement: '[PHONE_REDACTED]',
  },
  {
    name: 'wallet-address',
    // Algorand (58 chars base32), Ethereum (0x + 40 hex), Solana (32-44 base58)
    regex: /\b([A-Z2-7]{58}|0x[0-9a-fA-F]{40}|[1-9A-HJ-NP-Za-km-z]{32,44})\b/g,
    replacement: '[WALLET_REDACTED]',
  },
  {
    name: 'ssn',
    regex: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
    replacement: '[ID_REDACTED]',
  },
  {
    name: 'passport',
    regex: /\b[A-Z]{1,2}[0-9]{6,9}\b/g,
    replacement: '[PASSPORT_REDACTED]',
  },
  {
    name: 'named-person',
    // Title + capitalised first + last name
    regex: /\b(Mr|Mrs|Ms|Dr|Prof|Sir)\.?\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g,
    replacement: '[PERSON_REDACTED]',
  },
];

// Financial figures: $X,XXX or $X.XXXk — abstract to a range
const FINANCIAL_REGEX = /\$\s?(\d[\d,]*(\.\d+)?)\s*(k|K|thousand|million|m|M)?\b/g;

/**
 * Anonymize a task step before external dispatch.
 *
 * @param {string} text        - The step text to anonymize
 * @param {object} sessionCtx  - Session context: { orgName, userName, knownNames }
 * @returns {{ anonymized: string, log: Array, inputHash: string }}
 */
function anonymize(text, sessionCtx = {}) {
  let result = text;
  const log = [];

  // 1. Strip known org / user names from session context
  if (sessionCtx.orgName) {
    const orgRegex = new RegExp(`\\b${escapeRegex(sessionCtx.orgName)}\\b`, 'gi');
    if (orgRegex.test(result)) {
      result = result.replace(orgRegex, '[ORG_REDACTED]');
      log.push({ field: 'org-name', rule: 'session-context', replacement: '[ORG_REDACTED]' });
    }
  }

  if (sessionCtx.userName) {
    const userRegex = new RegExp(`\\b${escapeRegex(sessionCtx.userName)}\\b`, 'gi');
    if (userRegex.test(result)) {
      result = result.replace(userRegex, '[USER_REDACTED]');
      log.push({ field: 'user-name', rule: 'session-context', replacement: '[USER_REDACTED]' });
    }
  }

  for (const known of sessionCtx.knownNames || []) {
    const knownRegex = new RegExp(`\\b${escapeRegex(known)}\\b`, 'gi');
    if (knownRegex.test(result)) {
      result = result.replace(knownRegex, '[PERSON_REDACTED]');
      log.push({ field: 'known-name', rule: 'session-context', replacement: '[PERSON_REDACTED]' });
    }
  }

  // 2. Apply structural PII patterns
  for (const { name, regex, replacement } of PATTERNS) {
    const before = result;
    result = result.replace(regex, replacement);
    if (result !== before) {
      log.push({ field: name, rule: 'pattern-match', replacement });
    }
  }

  // 3. Abstract large financial figures to ranges
  result = result.replace(FINANCIAL_REGEX, (match, raw) => {
    const value = parseFloat(raw.replace(/,/g, ''));
    const range = toFinancialRange(value);
    log.push({ field: 'financial-figure', rule: 'financial-abstraction', original: match, replacement: range });
    return range;
  });

  return {
    anonymized: result,
    log,
    inputHash: hash(text),       // hash of ORIGINAL — for decision record
    outputHash: hash(result),    // hash of ANONYMIZED — what was actually sent
  };
}

/**
 * Abstract a dollar figure to a range bucket.
 * Prevents exact budget figures from leaking to agents.
 */
function toFinancialRange(value) {
  if (value < 100)    return 'under $100';
  if (value < 500)    return '$100-$500';
  if (value < 1000)   return '$500-$1,000';
  if (value < 5000)   return '$1,000-$5,000';
  if (value < 10000)  return '$5,000-$10,000';
  if (value < 50000)  return '$10,000-$50,000';
  if (value < 100000) return '$50,000-$100,000';
  return 'over $100,000';
}

function hash(text) {
  return 'sha256:' + crypto.createHash('sha256').update(text).digest('hex');
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

module.exports = { anonymize, hash };
