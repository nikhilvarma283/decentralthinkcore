/**
 * Decomposer — breaks a task into a dependency graph of classified steps.
 *
 * Returns a DAG (directed acyclic graph) where each node is a step with:
 *   - id            unique step identifier
 *   - description   what this step does
 *   - parallel      can this run concurrently with other parallel=true steps?
 *   - deps          step IDs this step depends on (must complete first)
 *   - classification { sensitivity, execution, category } from classifier
 *   - agentCapability what marketplace capability this step needs (if external)
 *
 * Cortex executes the DAG in topological order:
 *   1. All steps with no unsatisfied deps run in parallel (Promise.all)
 *   2. Each completed step unlocks its dependents
 *   3. Repeat until all steps are done
 */

const { v4: uuidv4 } = require('uuid');
const llm = require('../lib/llm');
const { classifyStep } = require('./classifier');

const DECOMPOSE_SYSTEM = `You are a task decomposition engine for a privacy-preserving AI orchestrator.

Given a user task, decompose it into ordered steps. For each step identify:
- Whether it can run in parallel with other steps (true/false)
- What prior step IDs it depends on (empty array if none)
- What type of agent capability it needs: flight-search | hotel-search | web-search | data-analysis | code | general

Rules:
- Information retrieval steps (search, find, look up) can usually run in parallel
- Synthesis/assembly steps must depend on the steps that produce their inputs
- Data analysis and report generation always run locally (mark execution: local)
- Maximum 6 steps
- Return ONLY valid JSON — no markdown, no explanation

Output format (array of objects):
[
  { "id": "s1", "description": "...", "parallel": true, "deps": [], "agentCapability": "flight-search" },
  { "id": "s2", "description": "...", "parallel": true, "deps": [], "agentCapability": "hotel-search" },
  { "id": "s3", "description": "...", "parallel": false, "deps": ["s1","s2"], "agentCapability": "general" }
]`;

/**
 * Decompose a task into a classified, dependency-aware step graph.
 *
 * @param {string} task
 * @param {object} options
 * @returns {Promise<Array>} — array of classified step objects
 */
async function decompose(task, options = {}) {
  const { maxSteps = 6, context = {} } = options;

  // Very short tasks — single step, no decomposition needed
  if (task.length < 100 && !task.includes('\n')) {
    return [_makeStep('s1', task, false, [], 'general', context)];
  }

  let rawSteps;
  try {
    const { content } = await llm.chat(
      [{ role: 'user', content: task }],
      { system: DECOMPOSE_SYSTEM, maxTokens: 1024, temperature: 0.1 }
    );

    const cleaned = content.replace(/```(?:json)?\n?/g, '').trim();
    rawSteps = JSON.parse(cleaned);

    if (!Array.isArray(rawSteps) || rawSteps.length === 0) throw new Error('bad shape');
  } catch (err) {
    // Fallback: single step
    rawSteps = [{ id: 's1', description: task, parallel: false, deps: [], agentCapability: 'general' }];
  }

  // Classify each step and attach metadata
  return rawSteps
    .slice(0, maxSteps)
    .filter((s) => s && typeof s.description === 'string')
    .map((s) => _makeStep(s.id || uuidv4(), s.description, s.parallel, s.deps || [], s.agentCapability || 'general', context));
}

function _makeStep(id, description, parallel, deps, agentCapability, context) {
  const classification = classifyStep(description, context);
  return {
    id,
    description,
    parallel: parallel && classification.execution !== 'local', // local steps never parallelise with external
    deps,
    agentCapability: classification.execution === 'local' ? null : agentCapability,
    classification,
  };
}

/**
 * Build execution batches from a DAG.
 * Returns an ordered array of batches — each batch is an array of steps
 * that can run concurrently (all their deps are in prior batches).
 *
 * @param {Array} steps
 * @returns {Array<Array>} batches
 */
function buildExecutionBatches(steps) {
  const completed = new Set();
  const batches = [];
  let remaining = [...steps];

  while (remaining.length > 0) {
    const ready = remaining.filter((s) =>
      s.deps.every((dep) => completed.has(dep))
    );

    if (ready.length === 0) {
      // Cycle or unresolvable deps — run everything remaining as one batch
      batches.push(remaining);
      break;
    }

    batches.push(ready);
    ready.forEach((s) => completed.add(s.id));
    remaining = remaining.filter((s) => !completed.has(s.id));
  }

  return batches;
}

module.exports = { decompose, buildExecutionBatches };
