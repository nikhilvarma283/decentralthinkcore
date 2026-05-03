/**
 * Payments API — spending ledger and cortex session wallet activity.
 *
 * Exposes read-only views of infra cost + x402 payment history.
 * No wallet keys are ever exposed through this API.
 */

const { Router } = require("express");
const { requireAuth } = require("../../middleware/auth");
const db = require("../../lib/db");

const router = Router();
router.use(requireAuth);

// GET /api/v1/payments/summary — total spend for the authenticated wallet
router.get("/summary", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT
         COUNT(*)::int                         AS total_invocations,
         COALESCE(SUM(cost_usd), 0)            AS total_usd,
         COALESCE(SUM(cost_credits), 0)        AS total_credits,
         COALESCE(SUM(input_tokens + output_tokens), 0) AS total_tokens
       FROM cost_ledger
       WHERE wallet_address = $1`,
      [req.walletAddress]
    );
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to fetch payment summary" });
  }
});

// GET /api/v1/payments/sessions — cortex session spending history
router.get("/sessions", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  try {
    const { rows } = await db.query(
      `SELECT
         cs.id, cs.wallet_address, cs.tee_context_id AS ephemeral_wallet,
         cs.spending_limit, cs.spent,
         cs.instantiated_at, cs.terminated_at,
         cs.memory_wiped, cs.termination_reason,
         COUNT(al.id)::int AS audit_events
       FROM cortex_sessions cs
       LEFT JOIN audit_log al ON al.cortex_session_id = cs.id
       WHERE cs.wallet_address = $1
       GROUP BY cs.id
       ORDER BY cs.instantiated_at DESC
       LIMIT $2`,
      [req.walletAddress, limit]
    );
    res.json({ sessions: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch session history" });
  }
});

// GET /api/v1/payments/ledger — itemised cost records
router.get("/ledger", async (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 50, 200);
  try {
    const { rows } = await db.query(
      `SELECT
         cl.id, cl.invocation_id, cl.cortex_session_id,
         cl.model, cl.input_tokens, cl.output_tokens,
         cl.cost_usd, cl.cost_credits, cl.recorded_at
       FROM cost_ledger cl
       WHERE cl.wallet_address = $1
       ORDER BY cl.recorded_at DESC
       LIMIT $2`,
      [req.walletAddress, limit]
    );
    res.json({ records: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch ledger" });
  }
});

module.exports = router;
