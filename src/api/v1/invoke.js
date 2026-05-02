const { Router } = require("express");
const { v4: uuidv4 } = require("uuid");
const db = require("../../lib/db");
const logger = require("../../lib/logger");
const hermes = require("../../orchestrator/hermes");
const { validate, required, isString, maxLen } = require("../../middleware/validate");
const { optionalAuth } = require("../../middleware/auth");

const router = Router();

router.use(optionalAuth);

const invokeSchema = {
  body: {
    task: (v) => {
      if (!v) return "task is required";
      if (typeof v !== "string") return "task must be a string";
      if (v.trim().length === 0) return "task cannot be empty";
      if (v.length > 10_000) return "task must be at most 10,000 characters";
      return true;
    },
    agent_id: (v) =>
      !v || (typeof v === "string" && v.length <= 64)
        ? true
        : "agent_id must be a string up to 64 characters",
    session_id: (v) =>
      !v || /^[0-9a-f-]{36}$/.test(v) ? true : "session_id must be a valid UUID",
  },
};

// POST /api/v1/invoke
// Submit an agent task. Returns invocation_id immediately; task runs async.
router.post("/", validate(invokeSchema), async (req, res) => {
  const { task, agent_id = "hermes-default", session_id } = req.body;
  // Prefer authenticated wallet; fall back to header for anonymous callers
  const walletAddress = req.walletAddress || req.headers["x-wallet-address"] || "anonymous";
  const resolvedSessionId = session_id || req.session?.id || null;

  const invocationId = uuidv4();

  // Persist the invocation record before spawning async work
  try {
    await db.query(
      `INSERT INTO invocations (id, session_id, agent_id, task, status)
       VALUES ($1, $2, $3, $4, 'pending')`,
      [invocationId, resolvedSessionId, agent_id, task]
    );
  } catch (err) {
    logger.error("invoke: failed to create invocation record", { error: err.message });
    return res.status(500).json({ error: "Failed to create invocation" });
  }

  // Run orchestration asynchronously — don't await
  setImmediate(() => {
    hermes
      .run(invocationId, task, {
        agentId: agent_id,
        sessionId: session_id,
        walletAddress,
        model: process.env.DEFAULT_MODEL,
      })
      .catch((err) => {
        logger.error("invoke: async orchestration error", {
          invocationId,
          error: err.message,
        });
      });
  });

  res.status(202).json({
    invocation_id: invocationId,
    status: "pending",
    message: "Task accepted. Poll /api/v1/invocations/:id for status.",
  });
});

module.exports = router;
