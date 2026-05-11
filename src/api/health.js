const { Router } = require("express");
const db = require("../lib/db");
const llm = require("../lib/llm");
const logger = require("../lib/logger");
const algorand = require("../blockchain/algorand");

const router = Router();

router.get("/", async (_req, res) => {
  const checks = {
    api: "ok",
    hermes: "unknown",
    database: "unknown",
    algorand: "unknown",
    opa: "unknown",
  };

  // Hermes / Ollama check
  let hermesDetail = {};
  try {
    const result = await llm.healthCheck();
    hermesDetail = result;
    if (result.ok) {
      checks.hermes = "ok";
    } else {
      // "pulling-model" is a transient startup state — treat as degraded, not fatal.
      // The API will handle LLM unavailability gracefully at the request level.
      checks.hermes = "pulling-model";
      logger.warn("Health: Hermes model not yet available", { reason: result.reason });
    }
  } catch (err) {
    logger.warn("Health: Hermes unreachable", { error: err.message });
    checks.hermes = "unreachable";
  }

  // DB check
  try {
    await db.query("SELECT 1");
    checks.database = "ok";
  } catch (err) {
    logger.warn("Health: DB unreachable", { error: err.message });
    checks.database = "unreachable";
  }

  // Algorand check
  try {
    const { ok } = await algorand.healthCheck();
    checks.algorand = ok ? "ok" : "degraded";
  } catch (err) {
    logger.warn("Health: Algorand unreachable", { error: err.message });
    checks.algorand = "unreachable";
  }

  // OPA check
  if (!process.env.OPA_URL) {
    checks.opa = "not-configured";
  } else {
    try {
      const resp = await fetch(`${process.env.OPA_URL}/health`, {
        signal: AbortSignal.timeout(2000),
      });
      checks.opa = resp.ok ? "ok" : "degraded";
    } catch (err) {
      logger.warn("Health: OPA unreachable", { error: err.message });
      checks.opa = "unreachable";
    }
  }

  // Non-fatal states: "ok", "not-configured", "degraded", "pulling-model"
  // Only "unreachable" is hard-fatal and forces a 503.
  const NON_FATAL = new Set(["ok", "not-configured", "degraded", "pulling-model"]);
  const allOk = Object.values(checks).every((v) => NON_FATAL.has(v));

  // Overall status: "ok" only when every check is "ok"; "degraded" otherwise.
  const anyNotOk = Object.values(checks).some((v) => v !== "ok");
  const overallStatus = !allOk ? "degraded" : anyNotOk ? "degraded" : "ok";

  res.status(allOk ? 200 : 503).json({
    status: overallStatus,
    version: process.env.npm_package_version || "0.1.0",
    model: process.env.HERMES_MODEL || "nous-hermes2",
    checks,
    // Surface Hermes diagnostics so operators can see which models are available
    hermes: hermesDetail.availableModels
      ? { availableModels: hermesDetail.availableModels, reason: hermesDetail.reason }
      : undefined,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
