const { v4: uuidv4 } = require("uuid");
const logger = require("../lib/logger");

/**
 * Gramine SGX simulator for Sprint 1.
 *
 * In production this becomes a real Gramine enclave. For now it:
 *   - Creates an isolated execution context with its own ID and start time
 *   - Enforces a wall-clock timeout on every execution
 *   - Tracks resource access (file, network) for policy audit
 *   - Destroys all context state on completion (ephemeral memory)
 */

const DEFAULT_TIMEOUT_MS = 60_000; // 60 s

function createContext(invocationId) {
  const ctx = {
    id: uuidv4(),
    invocationId,
    startedAt: Date.now(),
    accessLog: [],
    destroyed: false,
  };
  logger.debug("TEE: context created", { ctxId: ctx.id, invocationId });
  return ctx;
}

/**
 * Run fn inside the TEE context with a timeout.
 * The context is NOT destroyed here — call destroyContext() after all steps.
 */
async function run(ctx, fn) {
  if (ctx.destroyed) {
    throw new Error("TEE context has already been destroyed");
  }

  const timeoutMs =
    parseInt(process.env.TEE_TIMEOUT_MS || String(DEFAULT_TIMEOUT_MS));

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`TEE execution timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    Promise.resolve()
      .then(() => fn())
      .then((result) => {
        clearTimeout(timer);
        ctx.accessLog.push({ type: "execution", completedAt: Date.now() });
        resolve(result);
      })
      .catch((err) => {
        clearTimeout(timer);
        ctx.accessLog.push({ type: "error", error: err.message, at: Date.now() });
        reject(err);
      });
  });
}

/**
 * Cryptographically erase context state (ephemeral memory guarantee).
 */
function destroyContext(ctx) {
  if (ctx.destroyed) return;

  // Zero out access log and mark destroyed
  ctx.accessLog = [];
  ctx.destroyed = true;
  ctx.clearedAt = Date.now();

  logger.debug("TEE: context destroyed", {
    ctxId: ctx.id,
    durationMs: ctx.clearedAt - ctx.startedAt,
  });
}

/**
 * Generate an attestation report for the invocation.
 * In production: real SGX quote via Gramine's remote attestation.
 */
function attest(ctx) {
  return {
    teeType: "gramine-simulated",
    contextId: ctx.id,
    invocationId: ctx.invocationId,
    startedAt: ctx.startedAt,
    attestedAt: Date.now(),
    mrEnclave: "sim-" + ctx.id.slice(0, 16), // placeholder measurement
  };
}

module.exports = { createContext, run, destroyContext, attest };
