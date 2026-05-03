/**
 * Marketplace API — agent registration, discovery, and subscriptions.
 *
 * Public endpoints (no auth): GET /marketplace, GET /marketplace/:id
 * Authenticated endpoints: POST /marketplace (register), DELETE /marketplace/:id
 * Subscription endpoints: POST/DELETE /marketplace/:id/subscribe, GET /marketplace/subscriptions
 */

const { Router } = require("express");
const { requireAuth, optionalAuth } = require("../../middleware/auth");
const registry = require("../../marketplace/registry");
const subscriptions = require("../../marketplace/subscriptions");

const router = Router();

// ── Agent registry ─────────────────────────────────────────────────────���──────

// GET /api/v1/marketplace — list active agents (public)
router.get("/", optionalAuth, async (req, res) => {
  const { capability } = req.query;
  try {
    const agents = await registry.listAgents({ activeOnly: true, capability });
    res.json({ agents, count: agents.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list agents" });
  }
});

// GET /api/v1/marketplace/subscriptions — list caller's subscriptions
router.get("/subscriptions", requireAuth, async (req, res) => {
  try {
    const subs = await subscriptions.listSubscriptions(req.walletAddress);
    res.json({ subscriptions: subs, count: subs.length });
  } catch (err) {
    res.status(500).json({ error: "Failed to list subscriptions" });
  }
});

// GET /api/v1/marketplace/:agentId — agent detail (public)
router.get("/:agentId", optionalAuth, async (req, res) => {
  try {
    const agent = await registry.getAgent(req.params.agentId);
    if (!agent) return res.status(404).json({ error: "Agent not found" });
    res.json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch agent" });
  }
});

// POST /api/v1/marketplace — register or update an agent
router.post("/", requireAuth, async (req, res) => {
  const {
    agent_id,
    name,
    description,
    capabilities,
    capability_commitments,
    pricing_model,
    price_per_call,
    endpoint_url,
    tee_certified,
  } = req.body;

  if (!agent_id || typeof agent_id !== "string" || !/^[a-zA-Z0-9_-]{1,64}$/.test(agent_id)) {
    return res.status(400).json({ error: "agent_id must be 1–64 alphanumeric/dash/underscore chars" });
  }
  if (!name || typeof name !== "string" || name.length > 128) {
    return res.status(400).json({ error: "name is required (max 128 chars)" });
  }
  if (capabilities !== undefined && !Array.isArray(capabilities)) {
    return res.status(400).json({ error: "capabilities must be an array" });
  }

  try {
    const agent = await registry.register({
      agentId: agent_id,
      name,
      description,
      capabilities: capabilities || [],
      capabilityCommitments: capability_commitments || [],
      pricingModel: pricing_model,
      pricePerCall: price_per_call,
      endpointUrl: endpoint_url,
      teeCertified: tee_certified || false,
    });
    res.status(201).json(agent);
  } catch (err) {
    res.status(500).json({ error: "Failed to register agent" });
  }
});

// DELETE /api/v1/marketplace/:agentId — deactivate agent
router.delete("/:agentId", requireAuth, async (req, res) => {
  try {
    const ok = await registry.deactivate(req.params.agentId);
    if (!ok) return res.status(404).json({ error: "Agent not found" });
    res.json({ agent_id: req.params.agentId, active: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to deactivate agent" });
  }
});

// ── Subscriptions ─────────────────────────────────────────────────────────────

// POST /api/v1/marketplace/:agentId/subscribe
router.post("/:agentId/subscribe", requireAuth, async (req, res) => {
  const { capabilities, ttl_days } = req.body;

  const agent = await registry.getAgent(req.params.agentId).catch(() => null);
  if (!agent) return res.status(404).json({ error: "Agent not found" });
  if (!agent.active) return res.status(400).json({ error: "Agent is not active" });

  try {
    const sub = await subscriptions.subscribe(
      req.walletAddress,
      req.params.agentId,
      { capabilities: capabilities || agent.capabilities, ttlDays: ttl_days }
    );
    res.status(201).json(sub);
  } catch (err) {
    res.status(500).json({ error: "Failed to subscribe" });
  }
});

// DELETE /api/v1/marketplace/:agentId/subscribe — unsubscribe
router.delete("/:agentId/subscribe", requireAuth, async (req, res) => {
  try {
    const ok = await subscriptions.unsubscribe(req.walletAddress, req.params.agentId);
    if (!ok) return res.status(404).json({ error: "Subscription not found" });
    res.json({ agent_id: req.params.agentId, subscribed: false });
  } catch (err) {
    res.status(500).json({ error: "Failed to unsubscribe" });
  }
});

module.exports = router;
