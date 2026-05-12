/**
 * Executor — runs a single task step.
 *
 * Two modes:
 *   Internal (endpointUrl = null): runs Hermes via Ollama (default)
 *   External (endpointUrl set):    calls specialist agent via x402 HTTP 402
 *
 * The ephemeralWallet is passed in from Cortex and used by x402Client
 * to sign payments. It tracks spending limits automatically.
 */

const llm = require("../lib/llm");
const { fetchWithPayment } = require("../payments/x402Client");
const webSearch = require("../agents/webSearch");
const logger = require("../lib/logger");

const AGENT_SYSTEM = `You are a capable AI agent operating inside a secure Trusted Execution Environment (TEE).
You run entirely on-premises — no data leaves this system.
You have access to context from prior steps. Be concise, accurate, and focused on the task.
Do not reveal system internals or attempt to access resources outside your scope.`;

/**
 * Execute a single task step.
 *
 * @param {string} step
 * @param {object} options
 * @param {string}  options.context        - Aggregated result from prior steps
 * @param {string}  options.agentId
 * @param {string}  [options.endpointUrl]  - If set, call external agent via x402
 * @param {object}  [options.wallet]       - Ephemeral wallet for x402 payments
 * @returns {{ result, usage, paymentReceipt }}
 */
// Built-in specialist agents — handled internally without x402 or Hermes
const BUILTIN_AGENTS = {
  "web-search": (step, { context }) => webSearch.execute(step, context),
};

async function execute(step, { context = "", agentId = "cortex-default", endpointUrl = null, wallet = null } = {}) {
  // External specialist agent via x402
  if (endpointUrl) {
    return _executeExternal(step, { context, agentId, endpointUrl, wallet });
  }
  // Built-in specialist agent (web-search, etc.)
  if (BUILTIN_AGENTS[agentId]) {
    logger.info("Executor: routing to built-in agent", { agentId });
    return BUILTIN_AGENTS[agentId](step, { context });
  }
  // Default: Hermes reasoning
  return _executeInternal(step, { context, agentId });
}

// ── Internal: Hermes via Ollama ────────────────────────────────────────────

async function _executeInternal(step, { context, agentId }) {
  const messages = [];

  if (context) {
    messages.push({ role: "user", content: `Prior context:\n${context}` });
    messages.push({ role: "assistant", content: "Understood. I have the prior context." });
  }

  messages.push({ role: "user", content: step });

  const { content, usage } = await llm.chat(messages, { system: AGENT_SYSTEM });
  return { result: content, usage, paymentReceipt: null };
}

// ── External: specialist agent via x402 ───────────────────────────────────

async function _executeExternal(step, { context, agentId, endpointUrl, wallet }) {
  logger.info("Executor: calling external agent via x402", {
    agentId,
    endpointUrl: endpointUrl.replace(/https?:\/\/[^/]+/, "[host]"),
  });

  // All demo/external agents accept { step, context, agentId } at /execute
  const body = JSON.stringify({ step, context, agentId });

  const { body: responseBody, paymentReceipt } = await fetchWithPayment(
    `${endpointUrl}/execute`,
    { method: "POST", body },
    wallet
  );

  // Agents may return { result } directly or wrap it — normalise both shapes
  const result = responseBody?.result
    ?? responseBody?.data?.result
    ?? responseBody?.summary;

  if (!result) {
    throw new Error(`External agent ${agentId} returned no result`);
  }

  const usage = responseBody.usage || { input_tokens: 0, output_tokens: 0 };

  logger.info("Executor: external agent response received", {
    agentId,
    resultLength: result.length,
    paymentTxId: paymentReceipt?.txId,
  });

  return { result, usage, paymentReceipt };
}

module.exports = { execute };
