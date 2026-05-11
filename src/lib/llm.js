/**
 * LLM client — Hermes via Ollama (self-hosted, zero data egress).
 *
 * All inference runs inside the container. No data is sent to any
 * external API. This is the privacy guarantee of DecentralThink Core.
 *
 * Response shape matches OpenAI's chat completions format since
 * Ollama exposes an OpenAI-compatible endpoint at /v1/chat/completions.
 */

const logger = require("./logger");

const OLLAMA_URL = process.env.OLLAMA_URL || "http://localhost:11434";
const DEFAULT_MODEL = process.env.HERMES_MODEL || "nous-hermes2";

/**
 * Send a chat completion request to Hermes via Ollama.
 *
 * @param {Array<{role: string, content: string}>} messages
 * @param {object} options
 * @returns {Promise<{content: string, usage: {input_tokens, output_tokens}}>}
 */
async function chat(messages, options = {}) {
  const model = options.model || DEFAULT_MODEL;
  const maxTokens = options.maxTokens || parseInt(process.env.MAX_TOKENS || "4096");

  const body = {
    model,
    messages,
    stream: false,
    options: {
      num_predict: maxTokens,
      temperature: options.temperature ?? 0.7,
    },
  };

  if (options.system) {
    // Hermes honours a system message prepended to the array
    body.messages = [{ role: "system", content: options.system }, ...messages];
  }

  const url = `${OLLAMA_URL}/api/chat`;

  logger.debug("LLM: sending request", { model, url, messageCount: body.messages.length });

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(options.timeoutMs || 120_000),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Ollama error ${response.status}: ${text}`);
  }

  const data = await response.json();

  // Ollama response shape: { message: { role, content }, prompt_eval_count, eval_count }
  const content = data.message?.content || "";
  const usage = {
    input_tokens: data.prompt_eval_count || 0,
    output_tokens: data.eval_count || 0,
  };

  logger.debug("LLM: received response", { model, usage });

  return { content, usage };
}

/**
 * Check if Ollama + the model are available.
 */
async function healthCheck() {
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return { ok: false, reason: `Ollama HTTP ${res.status}` };

    const { models = [] } = await res.json();
    const modelName = DEFAULT_MODEL.split(":")[0]; // strip tag suffix e.g. ":latest"
    const loaded = models.some(
      (m) => m.name === DEFAULT_MODEL || m.name.startsWith(`${modelName}:`) || m.name === modelName
    );

    return {
      ok: loaded,
      model: DEFAULT_MODEL,
      reason: loaded ? null : `Model "${DEFAULT_MODEL}" not found — run: ollama pull ${DEFAULT_MODEL}`,
      availableModels: models.map((m) => m.name),
    };
  } catch (err) {
    return { ok: false, reason: `Ollama unreachable at ${OLLAMA_URL}: ${err.message}` };
  }
}

/**
 * Block until Ollama is up and the model is loaded, or until timeoutMs elapses.
 * Call this from app startup to surface a clear error instead of silent 503s.
 *
 * @param {number} timeoutMs  — total time to wait (default: 5 minutes)
 * @param {number} intervalMs — retry interval (default: 5 seconds)
 */
async function waitForReady(timeoutMs = 300_000, intervalMs = 5_000) {
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (Date.now() < deadline) {
    attempt++;
    const { ok, reason, availableModels } = await healthCheck();

    if (ok) {
      logger.info(`LLM: Hermes ready (${DEFAULT_MODEL}) after ${attempt} attempt(s)`);
      return;
    }

    const remaining = Math.round((deadline - Date.now()) / 1000);
    logger.warn(`LLM: Hermes not ready (attempt ${attempt}, ${remaining}s remaining)`, {
      reason,
      availableModels,
      ollamaUrl: OLLAMA_URL,
      model: DEFAULT_MODEL,
    });

    await new Promise((r) => setTimeout(r, intervalMs));
  }

  // Timed out — log a clear actionable error but don't crash the process.
  // Requests will fail at the handler level with a proper 503 until Ollama recovers.
  logger.error(
    `LLM: Hermes did not become ready within ${timeoutMs / 1000}s. ` +
    `Check that Ollama is running at ${OLLAMA_URL} and that "${DEFAULT_MODEL}" is pulled.`
  );
}

module.exports = { chat, healthCheck, waitForReady };
