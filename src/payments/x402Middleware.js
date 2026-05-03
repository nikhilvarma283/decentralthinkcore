/**
 * x402 Middleware — Express middleware that gates agent endpoints behind payment.
 *
 * Usage:
 *   const { requirePayment } = require("./x402Middleware");
 *   router.post("/execute", requirePayment({ amountMicroAlgo: 1000 }), handler);
 *
 * Protocol (per x402 open spec):
 *   1. Request arrives without X-Payment → respond 402 with X-Payment-Required
 *   2. Client sends X-Payment header with signed Algorand txn
 *   3. Middleware verifies payment → calls next() if valid
 *   4. Response includes X-Payment-Response header with txId
 */

const verifier = require("./x402Verifier");
const logger = require("../lib/logger");

const X402_VERSION = 1;

/**
 * Build the payment requirement object for a given agent endpoint.
 */
function buildRequirement({ amountMicroAlgo, resource, description, agentId, payTo }) {
  return {
    x402Version: X402_VERSION,
    accepts: [
      {
        scheme: "exact",
        network: process.env.ALGORAND_NETWORK || "testnet",
        maxAmountRequired: String(amountMicroAlgo),
        resource,
        description: description || `Agent execution fee for ${agentId || "agent"}`,
        payTo: payTo || process.env.ALGORAND_PLATFORM_ADDRESS || "",
        maxTimeoutSeconds: 300,
        asset: "ALGO",
        extra: { agentId, platform: "decentralthink-core" },
      },
    ],
  };
}

/**
 * Express middleware factory — wraps an agent endpoint with x402 payment gate.
 *
 * @param {object} options
 * @param {number} options.amountMicroAlgo  - Required payment in microALGO (1 ALGO = 1_000_000)
 * @param {string} [options.description]   - Human-readable fee description
 * @param {string} [options.agentId]       - Agent identifier for the requirement
 * @param {string} [options.payTo]         - Override platform receiving address
 */
function requirePayment(options = {}) {
  const {
    amountMicroAlgo = parseInt(process.env.X402_DEFAULT_FEE_MICROALGO || "1000"),
    description,
    agentId,
    payTo,
  } = options;

  return async (req, res, next) => {
    const resource = req.originalUrl || req.path;
    const requirement = buildRequirement({ amountMicroAlgo, resource, description, agentId, payTo });

    // No payment header — return 402 with requirements
    const paymentHeader = req.headers["x-payment"];
    if (!paymentHeader) {
      logger.info("x402: no payment header — returning 402", { resource, amountMicroAlgo });
      return res
        .status(402)
        .set("X-Payment-Required", Buffer.from(JSON.stringify(requirement)).toString("base64"))
        .json({
          error: "Payment required",
          x402Version: X402_VERSION,
          accepts: requirement.accepts,
        });
    }

    // Parse and verify payment
    let paymentProof;
    try {
      paymentProof = JSON.parse(Buffer.from(paymentHeader, "base64").toString("utf8"));
    } catch {
      return res.status(400).json({ error: "X-Payment header must be base64-encoded JSON" });
    }

    const { valid, reason, txId, mode } = await verifier.verify(
      paymentProof,
      requirement.accepts[0]
    );

    if (!valid) {
      logger.warn("x402: payment verification failed", { resource, reason });
      return res
        .status(402)
        .set("X-Payment-Required", Buffer.from(JSON.stringify(requirement)).toString("base64"))
        .json({ error: "Payment verification failed", reason });
    }

    // Attach payment receipt to response after handler completes
    const paymentResponse = {
      success: true,
      txId,
      network: process.env.ALGORAND_NETWORK || "testnet",
      payer: paymentProof.payload?.payer || "unknown",
      mode: mode || "simulate",
    };

    res.set("X-Payment-Response", Buffer.from(JSON.stringify(paymentResponse)).toString("base64"));

    // Make payment info available to the handler
    req.payment = { txId, amountMicroAlgo, payer: paymentProof.payload?.payer, mode };

    logger.info("x402: payment accepted", { resource, txId, amountMicroAlgo });
    next();
  };
}

module.exports = { requirePayment, buildRequirement };
