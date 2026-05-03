/**
 * Demo Agent Endpoint — shows what a specialist agent looks like in the marketplace.
 *
 * This is a reference implementation of an x402-gated agent endpoint.
 * Real specialist agents (code, data-analysis, web-search, etc.) are external
 * services registered in the marketplace. This demo runs on the same server
 * to show the full 402 → pay → execute → respond cycle working end-to-end.
 *
 * POST /api/v1/agent/execute — gated by x402 (1000 microALGO default)
 * GET  /api/v1/agent/info   — public metadata (no payment required)
 */

const { Router } = require("express");
const { requirePayment } = require("../../payments/x402Middleware");
const llm = require("../../lib/llm");
const logger = require("../../lib/logger");

const router = Router();

const AGENT_INFO = {
  agent_id: "demo-agent",
  name: "Demo Specialist Agent",
  description: "Reference x402-gated agent. Demonstrates the payment protocol end-to-end.",
  capabilities: ["reasoning", "summarization"],
  pricing: {
    scheme: "exact",
    amountMicroAlgo: parseInt(process.env.X402_DEFAULT_FEE_MICROALGO || "1000"),
    asset: "ALGO",
    network: process.env.ALGORAND_NETWORK || "testnet",
  },
  tee_certified: false,
  x402Version: 1,
};

// GET /api/v1/agent/info — no payment required
router.get("/info", (_req, res) => {
  res.json(AGENT_INFO);
});

// POST /api/v1/agent/execute — x402 payment gate
router.post(
  "/execute",
  requirePayment({
    amountMicroAlgo: parseInt(process.env.X402_DEFAULT_FEE_MICROALGO || "1000"),
    agentId: AGENT_INFO.agent_id,
    description: "Demo agent execution fee (1000 microALGO)",
  }),
  async (req, res) => {
    const { step, context = "" } = req.body || {};

    if (!step || typeof step !== "string") {
      return res.status(400).json({ error: "step is required" });
    }

    logger.info("Demo agent: executing step", {
      stepLength: step.length,
      paymentTxId: req.payment?.txId,
    });

    try {
      const messages = [];
      if (context) {
        messages.push({ role: "user", content: `Prior context:\n${context}` });
        messages.push({ role: "assistant", content: "Understood." });
      }
      messages.push({ role: "user", content: step });

      const { content, usage } = await llm.chat(messages, {
        system: "You are a specialist agent. Be concise and accurate.",
      });

      res.json({
        result: content,
        usage,
        agent_id: AGENT_INFO.agent_id,
        payment: req.payment,
      });
    } catch (err) {
      logger.error("Demo agent: execution failed", { error: err.message });
      res.status(500).json({ error: "Agent execution failed" });
    }
  }
);

module.exports = router;
