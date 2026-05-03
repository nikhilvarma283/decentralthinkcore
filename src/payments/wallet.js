/**
 * Ephemeral Cortex Wallet — patent Component 4.
 *
 * Each Cortex session gets a fresh Algorand account generated inside the TEE.
 * The account is funded up to the user's spending_limit from their master wallet.
 * On session termination the secret key bytes are zeroed — the wallet is
 * permanently destroyed and can never be recovered.
 *
 * Wallet hierarchy:
 *   Master Wallet (user's MetaMask / Algorand account)
 *     └─ Cortex Wallet (ephemeral, per-session, spending_limit enforced)
 *          └─ Agent Wallets (paid per-call via x402 HTTP 402)
 */

const algosdk = require("algosdk");
const logger = require("../lib/logger");

/**
 * Create a fresh ephemeral wallet for a Cortex session.
 * Returns { address, sk, spendingLimit, spent }.
 * sk is a Uint8Array — MUST be zeroed on session end.
 */
function createEphemeralWallet(spendingLimitMicroAlgo = 0) {
  const account = algosdk.generateAccount();
  // algosdk v2+ returns addr as an Address object — convert to string
  const address = typeof account.addr === "string"
    ? account.addr
    : algosdk.encodeAddress(account.addr.publicKey);
  logger.info("Wallet: ephemeral wallet created", { address, spendingLimitMicroAlgo });
  return {
    address,
    sk: account.sk,          // Uint8Array — zero this on session end
    spendingLimit: spendingLimitMicroAlgo,
    spent: 0,
  };
}

/**
 * Sign a payment transaction from the ephemeral wallet to a payee.
 * Returns { signedTxn: Buffer, txId: string } or null if budget exceeded.
 */
async function signPayment(wallet, { to, amountMicroAlgo, suggestedParams }) {
  if (wallet.destroyed) {
    throw new Error("Wallet: cannot sign — wallet already destroyed");
  }

  const remaining = wallet.spendingLimit - wallet.spent;
  if (amountMicroAlgo > remaining) {
    logger.warn("Wallet: spending limit exceeded", {
      address: wallet.address,
      requested: amountMicroAlgo,
      remaining,
    });
    return null;
  }

  const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
    from: wallet.address,
    to,
    amount: amountMicroAlgo,
    suggestedParams,
  });

  const signedTxn = txn.signTxn(wallet.sk);
  wallet.spent += amountMicroAlgo;

  logger.info("Wallet: signed payment", {
    from: wallet.address,
    to,
    amountMicroAlgo,
    txId: txn.txID(),
    remaining: wallet.spendingLimit - wallet.spent,
  });

  return { signedTxn: Buffer.from(signedTxn), txId: txn.txID() };
}

/**
 * Destroy the ephemeral wallet — zero the secret key bytes.
 * After this call the wallet cannot sign anything.
 * Called in Cortex.finally() alongside tee.destroyContext().
 */
function destroyWallet(wallet) {
  if (wallet && wallet.sk) {
    wallet.sk.fill(0);
    wallet.destroyed = true;
    logger.info("Wallet: ephemeral wallet destroyed, key zeroed", {
      address: wallet.address,
      totalSpent: wallet.spent,
    });
  }
}

/**
 * Simulate funding: in real deployment the master wallet sends ALGO to
 * the ephemeral address. In dev/testnet mode we skip the on-chain funding
 * and just set the spendingLimit — the ephemeral wallet pays from its own
 * (empty) account in simulate mode.
 */
async function fundFromMaster(ephemeralAddress, spendingLimitMicroAlgo, masterClient) {
  if (!masterClient) {
    logger.warn("Wallet: no master client — running in simulate mode", {
      ephemeralAddress,
      spendingLimitMicroAlgo,
    });
    return { simulated: true };
  }
  // Real funding is done via a master wallet payment txn (Sprint 6)
  return { simulated: false, amount: spendingLimitMicroAlgo };
}

module.exports = { createEphemeralWallet, signPayment, destroyWallet, fundFromMaster };
