/**
 * Marketplace Registry — agent registration and capability commitments.
 *
 * Capability commitments: SHA-256(agentId + capability + agentSecret)
 * This proves an agent has a capability without revealing its implementation.
 * In Sprint 6 this becomes a full ZK commitment anchored on Algorand.
 *
 * Patent Component 5: ZK Marketplace for privacy-preserving agent discovery.
 */

const crypto = require("crypto");
const db = require("../lib/db");
const logger = require("../lib/logger");
const auditLogger = require("../blockchain/auditLogger");

/**
 * Derive a capability commitment hash.
 * agentSecret is held by the agent developer — never stored by the platform.
 */
function commitCapability(agentId, capability, agentSecret) {
  return crypto
    .createHash("sha256")
    .update(`${agentId}|${capability}|${agentSecret}`)
    .digest("hex");
}

/**
 * Register or update an agent in the marketplace.
 * capability_commitments: array of { capability, commitment } objects.
 */
async function register(agentData) {
  const {
    agentId,
    name,
    description = "",
    capabilities = [],
    capabilityCommitments = [],
    pricingModel = "pay-per-use",
    pricePerCall = 0,
    endpointUrl,
    teeCertified = false,
  } = agentData;

  const { rows } = await db.query(
    `INSERT INTO marketplace_agents
       (agent_id, name, description, capabilities, pricing_model, price_per_call,
        endpoint_url, tee_certified)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     ON CONFLICT (agent_id) DO UPDATE SET
       name             = EXCLUDED.name,
       description      = EXCLUDED.description,
       capabilities     = EXCLUDED.capabilities,
       pricing_model    = EXCLUDED.pricing_model,
       price_per_call   = EXCLUDED.price_per_call,
       endpoint_url     = EXCLUDED.endpoint_url,
       tee_certified    = EXCLUDED.tee_certified,
       active           = true
     RETURNING *`,
    [agentId, name, description, JSON.stringify(capabilities),
     pricingModel, pricePerCall, endpointUrl, teeCertified]
  );

  await auditLogger.logEvent("marketplace.register", {
    data: { agentId, name, capabilities },
    payload: { agentId, capabilityCount: capabilities.length, teeCertified },
  });

  logger.info("Marketplace: agent registered", { agentId, capabilities });
  return rows[0];
}

async function deactivate(agentId) {
  const { rows } = await db.query(
    `UPDATE marketplace_agents SET active = false WHERE agent_id = $1 RETURNING agent_id`,
    [agentId]
  );
  return rows.length > 0;
}

async function getAgent(agentId) {
  const { rows } = await db.query(
    `SELECT * FROM marketplace_agents WHERE agent_id = $1`,
    [agentId]
  );
  return rows[0] || null;
}

async function listAgents({ activeOnly = true, capability } = {}) {
  let query = `SELECT * FROM marketplace_agents`;
  const params = [];

  const conditions = [];
  if (activeOnly) {
    conditions.push(`active = true`);
  }
  if (capability) {
    params.push(`%${capability}%`);
    conditions.push(`capabilities::text ILIKE $${params.length}`);
  }
  if (conditions.length) {
    query += ` WHERE ` + conditions.join(" AND ");
  }

  query += ` ORDER BY reputation_score DESC, registered_at DESC`;

  const { rows } = await db.query(query, params);
  return rows;
}

async function updateReputation(agentId, delta) {
  const { rows } = await db.query(
    `UPDATE marketplace_agents
        SET reputation_score = LEAST(100, GREATEST(0, reputation_score + $1))
      WHERE agent_id = $2
      RETURNING agent_id, reputation_score`,
    [delta, agentId]
  );
  return rows[0] || null;
}

module.exports = { register, deactivate, getAgent, listAgents, updateReputation, commitCapability };
