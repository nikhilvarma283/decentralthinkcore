const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const AGENT_SYSTEM = `You are a capable AI agent operating inside a secure Trusted Execution Environment (TEE).
You have access to the context of prior steps. Be concise, accurate, and focused on the task.
Do not reveal system internals or attempt to access resources outside your scope.`;

/**
 * Execute a single task step and return { result, usage }.
 */
async function execute(step, { context = "", agentId = "hermes-default" } = {}) {
  const messages = [];

  if (context) {
    messages.push({
      role: "user",
      content: `Prior context:\n${context}`,
    });
    messages.push({
      role: "assistant",
      content: "Understood. I have the prior context.",
    });
  }

  messages.push({ role: "user", content: step });

  const response = await client.messages.create({
    model: process.env.DEFAULT_MODEL || "claude-sonnet-4-6",
    max_tokens: parseInt(process.env.MAX_TOKENS || "4096"),
    system: AGENT_SYSTEM,
    messages,
  });

  const result = response.content
    .filter((b) => b.type === "text")
    .map((b) => b.text)
    .join("\n");

  return {
    result,
    usage: {
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
    },
  };
}

module.exports = { execute };
