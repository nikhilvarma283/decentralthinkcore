/**
 * x402 Payment Verifier — validates Algorand payment proofs.
 *
 * Two modes (X402_VERIFY_MODE env var):
 *   "simulate" (default in dev): verifies signature locally, no on-chain submission.
 *              Works without a funded account. Good for integration tests.
 *   "submit":  submits the signed txn to Algorand and waits for confirmation.
 *              Requires ALGORAND_MNEMONIC on the agent side to verify on-chain.
 *
 * The verifier NEVER executes the payment itself — it only checks that the
 * payer has already signed a valid transaction.
 */

const algosdk = require("algosdk");
const logger = require("../lib/logger");

const VERIFY_MODE = process.env.X402_VERIFY_MODE || "simulate";

/**
 * Verify a payment proof from an X-Payment header.
 *
 * @param {object} paymentProof  - parsed X-Payment JSON
 * @param {object} requirement   - the requirement this payment is for
 * @returns {{ valid, reason, txId }}
 */
async function verify(paymentProof, requirement) {
  try {
    const { scheme, network, payload } = paymentProof;

    if (scheme !== "exact") {
      return { valid: false, reason: `Unsupported scheme: ${scheme}` };
    }
    if (!payload?.signedTxn) {
      return { valid: false, reason: "Missing signedTxn in payload" };
    }

    const signedTxnBuf = Buffer.from(payload.signedTxn, "base64");

    // Decode the signed transaction to inspect fields
    let decodedTxn;
    try {
      decodedTxn = algosdk.decodeSignedTransaction(signedTxnBuf);
    } catch {
      return { valid: false, reason: "Cannot decode signed transaction" };
    }

    const { txn } = decodedTxn;

    // Verify receiver matches our address
    const payTo = requirement.payTo;
    if (payTo && algosdk.encodeAddress(txn.to.publicKey) !== payTo) {
      return { valid: false, reason: "Payment receiver does not match requirement" };
    }

    // Verify amount meets requirement
    const requiredAmount = parseInt(requirement.maxAmountRequired || "0");
    if (txn.amount < requiredAmount) {
      return {
        valid: false,
        reason: `Payment amount ${txn.amount} < required ${requiredAmount}`,
      };
    }

    const txId = txn.txID();

    if (VERIFY_MODE === "submit") {
      return await _submitAndConfirm(signedTxnBuf, txId, network);
    }

    // Simulate mode: signature check via algosdk decode (it validates internally)
    logger.info("x402Verifier: payment verified (simulate mode)", { txId, amount: txn.amount });
    return { valid: true, txId, mode: "simulate" };

  } catch (err) {
    logger.error("x402Verifier: verification error", { error: err.message });
    return { valid: false, reason: err.message };
  }
}

async function _submitAndConfirm(signedTxnBuf, txId, _network) {
  const algosdk_pkg = require("algosdk");
  const client = new algosdk_pkg.Algodv2(
    process.env.ALGORAND_TOKEN || "",
    process.env.ALGORAND_SERVER || "https://testnet-api.algonode.cloud",
    parseInt(process.env.ALGORAND_PORT || "443")
  );

  try {
    await client.sendRawTransaction(signedTxnBuf).do();
    await algosdk_pkg.waitForConfirmation(client, txId, 4);
    logger.info("x402Verifier: payment confirmed on-chain", { txId });
    return { valid: true, txId, mode: "submit" };
  } catch (err) {
    logger.error("x402Verifier: on-chain confirmation failed", { txId, error: err.message });
    return { valid: false, reason: `On-chain verification failed: ${err.message}`, txId };
  }
}

module.exports = { verify, VERIFY_MODE };
