const db = require("../lib/db");
const logger = require("../lib/logger");

// Hermes runs self-hosted — no per-token API fees.
// We meter token usage so tenants are billed fairly for infrastructure
// (GPU/CPU time). Adjust INFRA_COST_PER_1K_TOKENS to match your hosting cost.
// Typical estimate: ~$0.0003 / 1K tokens on a budget GPU instance.
function computeCost(_model, usage) {
  const infraCostPer1k = parseFloat(process.env.INFRA_COST_PER_1K_TOKENS || "0.0003");
  const creditsPerUsd = parseFloat(process.env.CREDITS_PER_USD || "100");
  const totalTokens = (usage.input_tokens || 0) + (usage.output_tokens || 0);
  const usd = (totalTokens / 1000) * infraCostPer1k;
  const credits = usd * creditsPerUsd;
  return {
    usd: parseFloat(usd.toFixed(8)),
    credits: parseFloat(credits.toFixed(6)),
    tokens: totalTokens,
  };
}

async function record({ invocationId, walletAddress, model, usage }) {
  const cost = computeCost(model, usage);

  try {
    await db.query(
      `INSERT INTO cost_ledger
         (invocation_id, wallet_address, model, input_tokens, output_tokens, cost_usd, cost_credits)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        invocationId,
        walletAddress,
        model || process.env.HERMES_MODEL || "nous-hermes2",
        usage.input_tokens || 0,
        usage.output_tokens || 0,
        cost.usd,
        cost.credits,
      ]
    );
  } catch (err) {
    logger.error("costTracker: failed to record cost", {
      invocationId,
      error: err.message,
    });
  }

  return cost;
}

async function totalForWallet(walletAddress) {
  const { rows } = await db.query(
    `SELECT
       SUM(cost_usd)     AS total_usd,
       SUM(cost_credits) AS total_credits,
       SUM(input_tokens + output_tokens) AS total_tokens
     FROM cost_ledger
     WHERE wallet_address = $1`,
    [walletAddress]
  );
  return rows[0];
}

module.exports = { record, computeCost, totalForWallet };
