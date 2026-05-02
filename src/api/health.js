const { Router } = require("express");
const db = require("../lib/db");
const logger = require("../lib/logger");

const router = Router();

router.get("/", async (_req, res) => {
  const checks = {
    api: "ok",
    database: "unknown",
    opa: "unknown",
  };

  // DB check
  try {
    await db.query("SELECT 1");
    checks.database = "ok";
  } catch (err) {
    logger.warn("Health: DB unreachable", { error: err.message });
    checks.database = "unreachable";
  }

  // OPA check — Node 20 has global fetch built-in
  try {
    const resp = await fetch(`${process.env.OPA_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    checks.opa = resp.ok ? "ok" : "degraded";
  } catch (err) {
    logger.warn("Health: OPA unreachable", { error: err.message });
    checks.opa = "unreachable";
  }

  const allOk = Object.values(checks).every((v) => v === "ok");
  res.status(allOk ? 200 : 503).json({
    status: allOk ? "ok" : "degraded",
    version: process.env.npm_package_version || "0.1.0",
    checks,
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
