/**
 * Task Classifier — determines sensitivity and execution zone for each step.
 *
 * Every step Cortex considers for external dispatch is first classified:
 *
 *   sensitivity:  public | internal | confidential | secret
 *   execution:    local (stays in TEE, Hermes only) | external (can go to agent)
 *   category:     what type of work this step represents
 *
 * The classification drives:
 *   - Whether a step can leave the TEE at all
 *   - Which agents are eligible (some only accept public data)
 *   - What anonymization is required before dispatch
 *   - What gets written to the decision record
 *
 * In Sprint 10 this is replaced by the org OPA policy engine.
 * For now: rule-based heuristics that are conservative by default.
 */

const CATEGORIES = {
  'data-analysis':        ['analyze', 'analyse', 'calculate', 'compute', 'statistics', 'trend', 'chart', 'compare data', 'data from', 'numbers', 'figure'],
  'report-generation':    ['write a report', 'generate report', 'draft report', 'summarize findings', 'compile report', 'create document'],
  'synthesis':            ['compile', 'assemble', 'combine', 'merge results', 'put together', 'aggregate', 'summarize all'],
  'information-retrieval':['find', 'search', 'look up', 'what is', 'what are', 'list of', 'available', 'options for', 'current price', 'latest'],
  'interaction':          ['book', 'reserve', 'schedule', 'order', 'purchase', 'buy', 'contact', 'send', 'request'],
  'negotiation':          ['negotiate', 'best price', 'discount', 'counter', 'offer', 'bid', 'quote'],
};

// Steps in these categories must always run locally — they handle raw data
const LOCAL_ONLY_CATEGORIES = new Set(['data-analysis', 'report-generation', 'synthesis']);

// Patterns that elevate sensitivity
const SENSITIVITY_PATTERNS = {
  secret:       [/\bpassword\b/i, /\bsecret\b/i, /\bprivate key\b/i, /\bcredential\b/i, /\bapi key\b/i],
  confidential: [/\bsalary\b/i, /\bpayroll\b/i, /\bmedical\b/i, /\bhealth\b/i, /\bhr\b/i, /\bpersonnel\b/i, /\blegal\b/i, /\bcontract\b/i, /\bconfidential\b/i],
  internal:     [/\binternal\b/i, /\bstrategy\b/i, /\bcompetitor\b/i, /\bbudget\b/i, /\bforecast\b/i, /\bpipeline\b/i, /\bboard\b/i],
};

/**
 * Classify a single task step.
 *
 * @param {string} step
 * @param {object} context - org rules, user persona (Sprint 10: from OPA)
 * @returns {{ sensitivity, execution, category, reason }}
 */
function classifyStep(step, context = {}) {
  const lower = step.toLowerCase();

  // Determine category
  let category = 'general';
  for (const [cat, keywords] of Object.entries(CATEGORIES)) {
    if (keywords.some((kw) => lower.includes(kw))) {
      category = cat;
      break;
    }
  }

  // Determine sensitivity (most restrictive match wins)
  let sensitivity = 'public';
  for (const [level, patterns] of Object.entries(SENSITIVITY_PATTERNS)) {
    if (patterns.some((p) => p.test(step))) {
      sensitivity = level;
      break;
    }
  }

  // Execution zone: local if category requires it OR data is confidential+
  const sensitivityRank = { public: 0, internal: 1, confidential: 2, secret: 3 };
  const mustBeLocal =
    LOCAL_ONLY_CATEGORIES.has(category) ||
    sensitivityRank[sensitivity] >= sensitivityRank['confidential'];

  const execution = mustBeLocal ? 'local' : 'external';

  const reason = mustBeLocal
    ? `category "${category}" or sensitivity "${sensitivity}" requires local execution`
    : `category "${category}" with sensitivity "${sensitivity}" may be externalized with anonymization`;

  return { sensitivity, execution, category, reason };
}

/**
 * Classify all steps in a decomposition graph.
 * Attaches classification to each step in place.
 */
function classifyGraph(steps, context = {}) {
  return steps.map((step) => ({
    ...step,
    classification: classifyStep(
      typeof step === 'string' ? step : step.description,
      context
    ),
  }));
}

module.exports = { classifyStep, classifyGraph };
