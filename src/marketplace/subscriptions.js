/**
 * Subscription manager — builders subscribe to agents from the marketplace.
 *
 * A subscription grants a wallet address the right to route tasks to an agent.
 * commitment_hash = SHA-256(subscriberAddress + agentId + timestamp) stored
 * in DB; in Sprint 6 this will also be anchored to Algorand.
 */

const crypto = require("crypto");
const db = require("../lib/db");
const logger = require("../lib/logger");
const auditLogger = require("../blockchain/auditLogger");

function buildCommitment(subscriberAddress, agentId) {
  return crypto
    .createHash("sha256")
    .update(`${subscriberAddress}|${agentId}|${Date.now()}`)
    .digest("hex");
}

async function subscribe(subscriberAddress, agentId, { capabilities = [], ttlDays } = {}) {
  const commitmentHash = buildCommitment(subscriberAddress, agentId);
  const expiresAt = ttlDays
    ? new Date(Date.now() + ttlDays * 86_400_000)
    : null;

  const { rows } = await db.query(
    `INSERT INTO agent_subscriptions
       (subscriber_address, agent_id, capabilities, commitment_hash, expires_at)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (subscriber_address, agent_id) DO UPDATE SET
       capabilities     = EXCLUDED.capabilities,
       commitment_hash  = EXCLUDED.commitment_hash,
       expires_at       = EXCLUDED.expires_at,
       revoked_at       = NULL,
       active           = true
     RETURNING *`,
    [subscriberAddress, agentId, JSON.stringify(capabilities), commitmentHash, expiresAt]
  );

  await auditLogger.logEvent("marketplace.subscribe", {
    data: { subscriberAddress, agentId, capabilities },
    payload: { agentId, capabilityCount: capabilities.length },
  });

  logger.info("Marketplace: subscription created", { subscriberAddress, agentId });
  return rows[0];
}

async function unsubscribe(subscriberAddress, agentId) {
  const { rowCount } = await db.query(
    `UPDATE agent_subscriptions
        SET active = false, revoked_at = now()
      WHERE subscriber_address = $1 AND agent_id = $2`,
    [subscriberAddress, agentId]
  );
  return rowCount > 0;
}

async function listSubscriptions(subscriberAddress) {
  const { rows } = await db.query(
    `SELECT asub.*, ma.name, ma.description, ma.capabilities AS agent_capabilities,
            ma.tee_certified, ma.reputation_score, ma.endpoint_url
       FROM agent_subscriptions asub
       JOIN marketplace_agents ma ON ma.agent_id = asub.agent_id
      WHERE asub.subscriber_address = $1
        AND asub.active = true
      ORDER BY asub.subscribed_at DESC`,
    [subscriberAddress]
  );
  return rows;
}

async function hasSubscription(subscriberAddress, agentId) {
  const { rows } = await db.query(
    `SELECT 1 FROM agent_subscriptions
      WHERE subscriber_address = $1
        AND agent_id = $2
        AND active = true
        AND (expires_at IS NULL OR expires_at > now())`,
    [subscriberAddress, agentId]
  );
  return rows.length > 0;
}

module.exports = { subscribe, unsubscribe, listSubscriptions, hasSubscription };
