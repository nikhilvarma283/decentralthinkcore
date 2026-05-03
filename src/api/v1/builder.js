/**
 * Builder API — deployment configuration for the Shopify-like builder layer.
 *
 * Builders use this to define:
 *   - Which blockchain network their container runs on
 *   - Which marketplace agents power their application
 *   - Smart contract rules (user permission policies)
 *   - Spending limits per session
 *
 * Each deployment is a named, versioned configuration owned by a wallet.
 */

const { Router } = require("express");
const { requireAuth } = require("../../middleware/auth");
const db = require("../../lib/db");
const registry = require("../../marketplace/registry");
const subscriptions = require("../../marketplace/subscriptions");
const auditLogger = require("../../blockchain/auditLogger");

const router = Router();
router.use(requireAuth);

const VALID_NETWORKS = ["testnet", "mainnet", "localnet"];
const VALID_STATUSES = ["draft", "active", "paused", "archived"];

// GET /api/v1/builder/deployments — list this builder's deployments
router.get("/deployments", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM builder_deployments
        WHERE owner_address = $1
        ORDER BY updated_at DESC`,
      [req.walletAddress]
    );
    res.json({ deployments: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch deployments" });
  }
});

// GET /api/v1/builder/deployments/:id
router.get("/deployments/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT * FROM builder_deployments WHERE id = $1 AND owner_address = $2`,
      [req.params.id, req.walletAddress]
    );
    if (!rows.length) return res.status(404).json({ error: "Deployment not found" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch deployment" });
  }
});

// POST /api/v1/builder/deployments — create a new deployment
router.post("/deployments", async (req, res) => {
  const {
    name, description = "", blockchain_network = "testnet",
    spending_limit = 0.01, agent_ids = [], smart_contract_rules = {}, opa_policy = "",
  } = req.body;

  if (!name || typeof name !== "string" || name.length > 64) {
    return res.status(400).json({ error: "name is required (max 64 chars)" });
  }
  if (!VALID_NETWORKS.includes(blockchain_network)) {
    return res.status(400).json({ error: `blockchain_network must be one of: ${VALID_NETWORKS.join(", ")}` });
  }
  if (!Array.isArray(agent_ids)) {
    return res.status(400).json({ error: "agent_ids must be an array" });
  }

  try {
    const { rows } = await db.query(
      `INSERT INTO builder_deployments
         (owner_address, name, description, blockchain_network, spending_limit,
          agent_ids, smart_contract_rules, opa_policy)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [req.walletAddress, name, description, blockchain_network, spending_limit,
       JSON.stringify(agent_ids), smart_contract_rules, opa_policy]
    );

    await auditLogger.logEvent("builder.deployment.create", {
      data: { name, blockchain_network, agentCount: agent_ids.length },
      payload: { deploymentId: rows[0].id, name, network: blockchain_network },
    });

    res.status(201).json(rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res.status(409).json({ error: `Deployment "${name}" already exists` });
    }
    res.status(500).json({ error: "Failed to create deployment" });
  }
});

// PATCH /api/v1/builder/deployments/:id — update configuration
router.patch("/deployments/:id", async (req, res) => {
  const allowed = [
    "name", "description", "blockchain_network", "spending_limit",
    "agent_ids", "smart_contract_rules", "opa_policy", "status",
  ];
  const updates = {};
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key];
  }

  if (updates.blockchain_network && !VALID_NETWORKS.includes(updates.blockchain_network)) {
    return res.status(400).json({ error: "Invalid blockchain_network" });
  }
  if (updates.status && !VALID_STATUSES.includes(updates.status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (updates.agent_ids && !Array.isArray(updates.agent_ids)) {
    return res.status(400).json({ error: "agent_ids must be an array" });
  }

  if (!Object.keys(updates).length) {
    return res.status(400).json({ error: "No updatable fields provided" });
  }

  const setClauses = Object.keys(updates).map((k, i) => `${k} = $${i + 3}`);
  setClauses.push("updated_at = now()");

  try {
    const { rows } = await db.query(
      `UPDATE builder_deployments
          SET ${setClauses.join(", ")}
        WHERE id = $1 AND owner_address = $2
        RETURNING *`,
      [req.params.id, req.walletAddress, ...Object.values(updates)]
    );
    if (!rows.length) return res.status(404).json({ error: "Deployment not found" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to update deployment" });
  }
});

// DELETE /api/v1/builder/deployments/:id — archive (soft delete)
router.delete("/deployments/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE builder_deployments
          SET status = 'archived', updated_at = now()
        WHERE id = $1 AND owner_address = $2
        RETURNING id`,
      [req.params.id, req.walletAddress]
    );
    if (!rows.length) return res.status(404).json({ error: "Deployment not found" });
    res.json({ id: rows[0].id, status: "archived" });
  } catch {
    res.status(500).json({ error: "Failed to archive deployment" });
  }
});

// POST /api/v1/builder/deployments/:id/agents — add agent subscription to deployment
router.post("/deployments/:id/agents", async (req, res) => {
  const { agent_id, capabilities } = req.body;
  if (!agent_id) return res.status(400).json({ error: "agent_id is required" });

  const agent = await registry.getAgent(agent_id).catch(() => null);
  if (!agent) return res.status(404).json({ error: "Agent not found in marketplace" });

  try {
    // Subscribe the builder's wallet to this agent
    const sub = await subscriptions.subscribe(
      req.walletAddress, agent_id,
      { capabilities: capabilities || agent.capabilities }
    );

    // Add to deployment's agent_ids list
    await db.query(
      `UPDATE builder_deployments
          SET agent_ids = agent_ids || $1::jsonb, updated_at = now()
        WHERE id = $2 AND owner_address = $3
          AND NOT (agent_ids @> $1::jsonb)`,
      [JSON.stringify([agent_id]), req.params.id, req.walletAddress]
    );

    res.status(201).json({ agent_id, subscription: sub });
  } catch {
    res.status(500).json({ error: "Failed to add agent" });
  }
});

// GET /api/v1/builder/overview — aggregate stats for the builder dashboard
router.get("/overview", async (req, res) => {
  try {
    const [deployments, sessions, agents, costs] = await Promise.all([
      db.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status='active')::int AS active
           FROM builder_deployments WHERE owner_address = $1`,
        [req.walletAddress]
      ),
      db.query(
        `SELECT COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE terminated_at IS NOT NULL AND memory_wiped)::int AS wiped
           FROM cortex_sessions WHERE wallet_address = $1`,
        [req.walletAddress]
      ),
      db.query(
        `SELECT COUNT(*)::int AS subscribed FROM agent_subscriptions
           WHERE subscriber_address = $1 AND active = true`,
        [req.walletAddress]
      ),
      db.query(
        `SELECT COALESCE(SUM(cost_usd),0) AS total_usd,
                COALESCE(SUM(cost_credits),0) AS total_credits
           FROM cost_ledger WHERE wallet_address = $1`,
        [req.walletAddress]
      ),
    ]);

    res.json({
      deployments: deployments.rows[0],
      sessions: sessions.rows[0],
      agents: agents.rows[0],
      costs: costs.rows[0],
    });
  } catch {
    res.status(500).json({ error: "Failed to fetch overview" });
  }
});

module.exports = router;
