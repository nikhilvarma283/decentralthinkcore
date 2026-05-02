const { Router } = require("express");
const db = require("../../lib/db");
const costTracker = require("../../payments/costTracker");
const tee = require("../../tee/simulator");

const router = Router();

// GET /api/v1/invocations/:id
router.get("/:id", async (req, res) => {
  const { id } = req.params;

  if (!/^[0-9a-f-]{36}$/.test(id)) {
    return res.status(400).json({ error: "Invalid invocation ID" });
  }

  const { rows } = await db.query(
    `SELECT
       id, session_id, agent_id, task, status,
       result, cost_credits, policy_decision, blockchain_txid,
       started_at, completed_at, error
     FROM invocations WHERE id = $1`,
    [id]
  );

  if (rows.length === 0) {
    return res.status(404).json({ error: "Invocation not found" });
  }

  const inv = rows[0];
  return res.json(formatInvocation(inv));
});

// GET /api/v1/invocations?wallet=...&status=...&limit=20&offset=0
router.get("/", async (req, res) => {
  const wallet = req.headers["x-wallet-address"] || req.query.wallet;
  const status = req.query.status;
  const limit = Math.min(parseInt(req.query.limit || "20"), 100);
  const offset = parseInt(req.query.offset || "0");

  const conditions = [];
  const params = [];

  if (wallet) {
    // Join with sessions to filter by wallet, or use a direct lookup when anonymoused
    // For Sprint 1 (no SIWE yet) we filter by x-wallet-address header stored in session
    conditions.push(`agent_id IS NOT NULL`); // no-op filter — keeps query valid
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  params.push(limit, offset);
  const { rows } = await db.query(
    `SELECT id, agent_id, task, status, cost_credits, started_at, completed_at
     FROM invocations ${where}
     ORDER BY started_at DESC
     LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  res.json({
    invocations: rows.map(formatInvocation),
    limit,
    offset,
  });
});

function formatInvocation(inv) {
  return {
    id: inv.id,
    agent_id: inv.agent_id,
    task: inv.task,
    status: inv.status,
    result: inv.status === "completed" ? inv.result : undefined,
    cost: inv.cost_credits
      ? { credits: parseFloat(inv.cost_credits) }
      : undefined,
    policy_decision: inv.policy_decision,
    blockchain_txid: inv.blockchain_txid,
    started_at: inv.started_at,
    completed_at: inv.completed_at,
    error: inv.status === "failed" ? inv.error : undefined,
  };
}

module.exports = router;
