/**
 * Marketplace Discovery — find agents by capability for Cortex routing.
 *
 * Cortex calls findAgentsForTask() to route each step to the best
 * available specialist agent. Falls back to the default Hermes agent
 * when no specialist matches.
 */

const db = require("../lib/db");
const logger = require("../lib/logger");

// Built-in Cortex default — always available, no marketplace lookup needed
const DEFAULT_AGENT = {
  agent_id: "cortex-default",
  name: "Cortex (Hermes)",
  description: "Default on-premises Hermes reasoning agent",
  capabilities: ["reasoning", "text-generation", "summarization", "analysis"],
  endpoint_url: null,
  tee_certified: true,
  reputation_score: 100,
};

// Built-in specialist agents — always available, no subscription needed.
// These run inside Cortex (endpointUrl: null) but use a dedicated handler
// in executor.js rather than Hermes.
const BUILTIN_SPECIALISTS = {
  "web-search": {
    agent_id: "web-search",
    name: "Web Search Agent",
    description: "Searches the internet using Brave/SerpAPI/DuckDuckGo",
    capabilities: ["web-search"],
    endpoint_url: null,
    tee_certified: false,
    reputation_score: 90,
  },
};

/**
 * Find agents subscribed to by a wallet that can handle a given capability.
 * Returns agents ordered by reputation.
 */
async function findByCapability(capability, walletAddress) {
  try {
    const { rows } = await db.query(
      `SELECT ma.*
         FROM marketplace_agents ma
         JOIN agent_subscriptions asub ON asub.agent_id = ma.agent_id
        WHERE asub.subscriber_address = $1
          AND asub.active = true
          AND (asub.expires_at IS NULL OR asub.expires_at > now())
          AND ma.active = true
          AND ma.capabilities::text ILIKE $2
        ORDER BY ma.reputation_score DESC, ma.tee_certified DESC
        LIMIT 5`,
      [walletAddress, `%${capability}%`]
    );
    return rows;
  } catch (err) {
    logger.warn("Marketplace: discovery query failed", { error: err.message });
    return [];
  }
}

/**
 * Route a task step to the best available agent.
 * Returns { agentId, endpointUrl, isDefault }.
 *
 * Routing heuristics (ordered):
 *   1. TEE-certified subscribed agents matching task keywords
 *   2. Any subscribed agent matching task keywords
 *   3. Default Hermes agent
 */
async function routeTask(task, walletAddress) {
  const keywords = extractCapabilityKeywords(task);

  for (const keyword of keywords) {
    // Check built-in specialists first — no DB lookup, no subscription required
    if (BUILTIN_SPECIALISTS[keyword]) {
      const agent = BUILTIN_SPECIALISTS[keyword];
      logger.info("Marketplace: routing to built-in specialist", {
        agentId: agent.agent_id,
        capability: keyword,
      });
      return {
        agentId: agent.agent_id,
        endpointUrl: null,
        name: agent.name,
        isDefault: false,
      };
    }

    // Then check marketplace for subscribed external agents
    const agents = await findByCapability(keyword, walletAddress);
    if (agents.length > 0) {
      const agent = agents[0];
      logger.info("Marketplace: routing task to subscribed specialist", {
        agentId: agent.agent_id,
        capability: keyword,
        walletAddress,
      });
      return {
        agentId: agent.agent_id,
        endpointUrl: agent.endpoint_url,
        name: agent.name,
        isDefault: false,
      };
    }
  }

  return {
    agentId: DEFAULT_AGENT.agent_id,
    endpointUrl: null,
    name: DEFAULT_AGENT.name,
    isDefault: true,
  };
}

/**
 * Extract capability keywords from task text for marketplace matching.
 * Simple heuristic: matches known capability domains.
 */
function extractCapabilityKeywords(task) {
  const taskLower = task.toLowerCase();
  const CAPABILITY_MAP = {
    "web-search":    ["search", "find", "lookup", "google", "web", "internet"],
    "code":          ["code", "program", "script", "function", "debug", "implement"],
    "data-analysis": ["analyze", "data", "csv", "chart", "statistics", "trend"],
    "image":         ["image", "photo", "picture", "visual", "screenshot"],
    "email":         ["email", "send", "message", "inbox", "compose"],
    "calendar":      ["schedule", "calendar", "meeting", "appointment"],
    "summarization": ["summarize", "summary", "tldr", "brief"],
    "translation":   ["translate", "language", "french", "spanish", "chinese"],
  };

  return Object.entries(CAPABILITY_MAP)
    .filter(([, keywords]) => keywords.some((kw) => taskLower.includes(kw)))
    .map(([capability]) => capability);
}

module.exports = { routeTask, findByCapability, DEFAULT_AGENT };
