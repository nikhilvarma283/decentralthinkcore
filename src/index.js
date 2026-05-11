require("dotenv").config();
const app = require("./app");
const logger = require("./lib/logger");
const llm = require("./lib/llm");

const PORT = process.env.PORT || 3000;

// Start listening immediately so health/readiness probes pass during boot.
// Then begin a background wait for Hermes — this surfaces a clear log message
// and keeps retrying without blocking request handling.
app.listen(PORT, () => {
  logger.info(`DecentralThink Core running on port ${PORT}`, {
    env: process.env.NODE_ENV,
    pid: process.pid,
  });

  // Non-blocking: logs warnings until Hermes is ready, then logs "ready".
  // Requests that hit the LLM before it's up receive a proper 503 from the handler.
  llm.waitForReady(
    parseInt(process.env.LLM_STARTUP_TIMEOUT_MS || "300000"),  // 5 min default
    parseInt(process.env.LLM_STARTUP_INTERVAL_MS || "5000"),   // 5s retry
  ).catch((err) => {
    // waitForReady never throws, but guard anyway
    logger.error("LLM startup watcher crashed", { error: err.message });
  });
});
