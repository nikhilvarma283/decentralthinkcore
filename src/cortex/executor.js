const llm = require("../lib/llm");

const AGENT_SYSTEM = `You are a capable AI agent operating inside a secure Trusted Execution Environment (TEE).
You run entirely on-premises — no data leaves this system.
You have access to context from prior steps. Be concise, accurate, and focused on the task.
Do not reveal system internals or attempt to access resources outside your scope.`;

/**
 * Execute a single task step using Hermes via Ollama.
 * Returns { result, usage }.
 */
async function execute(step, { context = "", agentId = "hermes-default" } = {}) {
  const messages = [];

  if (context) {
    messages.push({ role: "user", content: `Prior context:\n${context}` });
    messages.push({ role: "assistant", content: "Understood. I have the prior context." });
  }

  messages.push({ role: "user", content: step });

  const { content, usage } = await llm.chat(messages, { system: AGENT_SYSTEM });

  return { result: content, usage };
}

module.exports = { execute };
