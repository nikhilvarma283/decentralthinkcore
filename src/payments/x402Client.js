/**
 * x402 HTTP Client — wraps fetch() to handle the 402 → pay → retry cycle.
 *
 * When Cortex calls an external agent endpoint:
 *   1. Makes the request
 *   2. If 402: parses X-Payment-Required, signs payment from ephemeral wallet
 *   3. Retries with X-Payment header
 *   4. Returns response + payment receipt from X-Payment-Response
 *
 * Spending limit enforcement: the ephemeral wallet tracks .spent and refuses
 * to sign if the limit would be exceeded.
 */

const algosdk = require("algosdk");
const { signPayment } = require("./wallet");
const logger = require("../lib/logger");

const X402_VERSION = 1;
const MAX_RETRIES = 1; // pay once then give up

/**
 * Make an HTTP request to an agent endpoint, handling x402 automatically.
 *
 * @param {string} url             - Agent endpoint URL
 * @param {object} fetchOptions    - Standard fetch options (method, headers, body, etc.)
 * @param {object} ephemeralWallet - Cortex session wallet from wallet.js
 * @returns {{ response, body, paymentReceipt }} - paymentReceipt is null if no payment needed
 */
async function fetchWithPayment(url, fetchOptions = {}, ephemeralWallet = null) {
  const headers = { "Content-Type": "application/json", ...(fetchOptions.headers || {}) };
  let paymentReceipt = null;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    const res = await fetch(url, { ...fetchOptions, headers });

    if (res.status !== 402) {
      // Parse payment receipt header if present
      const receiptHeader = res.headers.get("x-payment-response");
      if (receiptHeader) {
        try {
          paymentReceipt = JSON.parse(Buffer.from(receiptHeader, "base64").toString("utf8"));
        } catch {}
      }
      const body = await res.json().catch(() => ({}));
      return { response: res, body, paymentReceipt };
    }

    // ── 402 Payment Required ──────────────────────────────────────────────
    if (attempt === MAX_RETRIES) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`x402: payment failed after retry — ${body.reason || "unknown reason"}`);
    }

    const requirementHeader = res.headers.get("x-payment-required");
    if (!requirementHeader) {
      throw new Error("x402: server returned 402 without X-Payment-Required header");
    }

    let requirement;
    try {
      requirement = JSON.parse(Buffer.from(requirementHeader, "base64").toString("utf8"));
    } catch {
      throw new Error("x402: cannot decode X-Payment-Required header");
    }

    const accepted = requirement.accepts?.[0];
    if (!accepted) throw new Error("x402: no accepted payment schemes in requirement");

    const amountMicroAlgo = parseInt(accepted.maxAmountRequired || "0");

    logger.info("x402Client: payment required", {
      url,
      amountMicroAlgo,
      payTo: accepted.payTo,
      description: accepted.description,
    });

    // Build and sign the payment
    const paymentPayload = await _buildPaymentPayload(
      ephemeralWallet,
      accepted,
      amountMicroAlgo
    );

    headers["X-Payment"] = Buffer.from(JSON.stringify(paymentPayload)).toString("base64");
  }

  throw new Error("x402: unexpected exit from retry loop");
}

async function _buildPaymentPayload(wallet, accepted, amountMicroAlgo) {
  // Simulate mode: construct a fake signed txn structure for dev/test
  if (!wallet || wallet.destroyed) {
    logger.warn("x402Client: no wallet — using simulate payment");
    return _simulatePayment(accepted, amountMicroAlgo);
  }

  // Real mode: get suggested params from Algorand and sign
  let suggestedParams;
  try {
    const algodClient = new algosdk.Algodv2(
      process.env.ALGORAND_TOKEN || "",
      process.env.ALGORAND_SERVER || "https://testnet-api.algonode.cloud",
      parseInt(process.env.ALGORAND_PORT || "443")
    );
    suggestedParams = await algodClient.getTransactionParams().do();
  } catch (err) {
    logger.warn("x402Client: Algorand unreachable — falling back to simulate", {
      error: err.message,
    });
    return _simulatePayment(accepted, amountMicroAlgo);
  }

  // Guard: payTo must be a valid Algorand address.
  // Falls back to simulate if ALGORAND_PLATFORM_ADDRESS is not configured.
  if (!accepted.payTo || accepted.payTo.length < 58) {
    logger.warn("x402Client: payTo address not configured — falling back to simulate", {
      payTo: accepted.payTo || "(empty)",
    });
    return _simulatePayment(accepted, amountMicroAlgo);
  }

  let signed;
  try {
    signed = await signPayment(wallet, {
      to: accepted.payTo,
      amountMicroAlgo,
      suggestedParams,
    });
  } catch (err) {
    logger.warn("x402Client: signPayment failed — falling back to simulate", {
      error: err.message,
    });
    return _simulatePayment(accepted, amountMicroAlgo);
  }

  if (!signed) {
    throw new Error(
      `x402Client: spending limit exceeded — cannot pay ${amountMicroAlgo} microALGO`
    );
  }

  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: accepted.network || "testnet",
    payload: {
      signedTxn: signed.signedTxn.toString("base64"),
      txId: signed.txId,
      payer: wallet.address,
    },
  };
}

function _simulatePayment(accepted, amountMicroAlgo) {
  const fakeTxId = `SIM${Date.now().toString(36).toUpperCase()}`;
  return {
    x402Version: X402_VERSION,
    scheme: "exact",
    network: accepted.network || "testnet",
    payload: {
      signedTxn: Buffer.from(`simulated|${amountMicroAlgo}|${fakeTxId}`).toString("base64"),
      txId: fakeTxId,
      payer: "SIMULATED_WALLET",
    },
  };
}

module.exports = { fetchWithPayment };
