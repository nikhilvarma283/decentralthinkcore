const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const DECOMPOSE_SYSTEM = `You are a task decomposition engine. Given a user task, determine whether it needs to be broken into sequential steps or can run as-is.

Rules:
- If the task is simple (a single question, lookup, or generation), return a single-element array with the original task.
- If the task is complex (multiple distinct operations, requires intermediate results, or has clear sequential phases), break it into 2–5 ordered steps.
- Each step must be self-contained and clearly worded.
- Return ONLY a JSON array of strings. No explanation, no markdown fences.

Example simple: ["What is the capital of France?"]
Example complex: ["Research the top 3 competitors of Salesforce","Summarize each competitor's pricing model","Compare them in a table"]`;

async function decompose(task, { maxSteps = 5 } = {}) {
  // Short tasks (<120 chars with no newlines) skip decomposition
  if (task.length < 120 && !task.includes("\n")) {
    return [task];
  }

  const response = await client.messages.create({
    model: process.env.DEFAULT_MODEL || "claude-sonnet-4-6",
    max_tokens: 512,
    system: DECOMPOSE_SYSTEM,
    messages: [{ role: "user", content: task }],
  });

  const raw = response.content[0].text.trim();

  let steps;
  try {
    steps = JSON.parse(raw);
    if (!Array.isArray(steps) || steps.length === 0) throw new Error("bad shape");
  } catch {
    // Fallback: treat as single step if parsing fails
    steps = [task];
  }

  return steps.slice(0, maxSteps).filter((s) => typeof s === "string" && s.trim());
}

module.exports = { decompose };
