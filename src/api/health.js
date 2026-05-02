const { Router } = require("express");
const db = require("../lib/db");
const llm = require("../lib/llm");
const logger = require("../lib/logger");

const router = Router();

router.get("/", async (_req, res) => {
  const checks = {
    api: "ok",
    hermes: "unknown",
    database: "unknown",
    opa: "unknown",
  };

  // Hermes / Ollama check
  try {
    const { ok, reason } = await llm.healthCheck();
    checks.hermes = ok ? "ok" : "pulling-model";
    if (!ok) logger.warn("Health: Hermes not ready", { reason });
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

  const allOk = Object.values(checks).every((v) => v === "ok");
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    version: process.env.npm_package_version || "0.1.0",
    model: process.env.HERMES_MODEL || "nous-hermes2",
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
