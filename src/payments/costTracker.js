const db = require("../lib/db");
const logger = require("../lib/logger");

// Anthropic pricing (USD per million tokens) — update as models change
const MODEL_PRICING = {
  "claude-opus-4-6":    { input: 15.00, output: 75.00 },
  "claude-sonnet-4-6":  { input:  3.00, output: 15.00 },
  "claude-haiku-4-5":   { input:  0.80, output:  4.00 },
};

const DEFAULT_PRICING = { input: 3.00, output: 15.00 };
const CREDITS_PER_USD = parseFloat(process.env.CREDITS_PER_USD || "100");

function computeCost(model, usage) {
  const pricing = MODEL_PRICING[model] || DEFAULT_PRICING;
  const usd =
    (usage.input_tokens / 1_000_000) * pricing.input +
    (usage.output_tokens / 1_000_000) * pricing.output;
  const credits = usd * CREDITS_PER_USD;
  return { usd: parseFloat(usd.toFixed(8)), credits: parseFloat(credits.toFixed(6)) };
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
        model,
        usage.input_tokens,
        usage.output_tokens,
        cost.usd,
        cost.credits,
      ]
    );
  } catch (err) {
    // Non-fatal — log and continue so the invocation result is preserved
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
