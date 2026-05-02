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
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) return { ok: false, reason: `HTTP ${res.status}` };

    const { models = [] } = await res.json();
    const modelName = DEFAULT_MODEL.split(":")[0]; // strip tag
    const loaded = models.some((m) => m.name.startsWith(modelName));

    return {
      ok: loaded,
      model: DEFAULT_MODEL,
      reason: loaded ? null : `Model ${DEFAULT_MODEL} not yet pulled`,
      availableModels: models.map((m) => m.name),
    };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { chat, healthCheck };
