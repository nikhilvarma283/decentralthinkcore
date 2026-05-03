const llm = require("../lib/llm");

const DECOMPOSE_SYSTEM = `You are a task decomposition engine. Given a user task, determine whether it needs to be broken into sequential steps or can run as-is.

Rules:
- If the task is simple (a single question, lookup, or generation), return a single-element array with the original task.
- If the task is complex (multiple distinct operations, requires intermediate results, or has clear sequential phases), break it into 2–5 ordered steps.
- Each step must be self-contained and clearly worded.
- Return ONLY a JSON array of strings. No explanation, no markdown fences.

Example simple: ["What is the capital of France?"]
Example complex: ["Research the top 3 competitors of Salesforce","Summarize each competitor's pricing model","Compare them in a table"]`;

async function decompose(task, { maxSteps = 5 } = {}) {
  // Short single-line tasks skip decomposition entirely
  if (task.length < 120 && !task.includes("\n")) {
    return [task];
  }

  const { content } = await llm.chat(
    [{ role: "user", content: task }],
    { system: DECOMPOSE_SYSTEM, maxTokens: 512, temperature: 0.2 }
  );

  let steps;
  try {
    // Hermes sometimes wraps JSON in markdown fences — strip them
    const cleaned = content.replace(/```(?:json)?\n?/g, "").trim();
    steps = JSON.parse(cleaned);
    if (!Array.isArray(steps) || steps.length === 0) throw new Error("bad shape");
  } catch {
    steps = [task];
  }

  return steps.slice(0, maxSteps).filter((s) => typeof s === "string" && s.trim());
}

module.exports = { decompose };
