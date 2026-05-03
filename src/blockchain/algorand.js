/**
 * Algorand client — anchors audit records to testnet.
 *
 * Each record is a zero-value payment transaction from the platform account
 * to itself. The note field carries: dtcore|<event>|<sha256-hash>
 * This puts an immutable, timestamped cryptographic proof on-chain.
 * Raw data and PII never leave the platform.
 *
 * ALGORAND_MNEMONIC is required to submit transactions.
 * If unset the module logs a warning and returns null txids (dev mode).
 */

const algosdk = require("algosdk");
const crypto = require("crypto");
const logger = require("../lib/logger");

const SERVER  = process.env.ALGORAND_SERVER  || "https://testnet-api.algonode.cloud";
const PORT    = parseInt(process.env.ALGORAND_PORT || "443");
const TOKEN   = process.env.ALGORAND_TOKEN   || "";
const NETWORK = process.env.ALGORAND_NETWORK || "testnet";

// Max note payload in Algorand transactions (bytes)
const MAX_NOTE_BYTES = 1024;

let _client = null;
let _account = null;

function getClient() {
  if (!_client) {
    _client = new algosdk.Algodv2(TOKEN, SERVER, PORT);
  }
  return _client;
}

function getAccount() {
  if (_account) return _account;
  const mnemonic = process.env.ALGORAND_MNEMONIC;
  if (!mnemonic) return null;
  try {
    _account = algosdk.mnemonicToSecretKey(mnemonic);
    return _account;
  } catch (err) {
    logger.error("Algorand: invalid mnemonic", { error: err.message });
    return null;
  }
}

/**
 * SHA-256 hash of arbitrary data — what gets anchored on-chain.
 * Input may be string or Buffer.
 */
function hashData(data) {
  const input = typeof data === "string" ? data : JSON.stringify(data);
  return crypto.createHash("sha256").update(input).digest("hex");
}

/**
 * Submit an audit record to Algorand testnet.
 * Returns the transaction ID string, or null if Algorand is not configured.
 *
 * @param {string} event   - Event type e.g. "cortex.start"
 * @param {string} dataHash - SHA-256 hex of the data involved
 * @param {object} [meta]  - Optional small metadata (added to note if it fits)
 */
async function submitAuditRecord(event, dataHash, meta = {}) {
  const account = getAccount();
  if (!account) {
    logger.warn("Algorand: ALGORAND_MNEMONIC not set — audit record not anchored", { event });
    return null;
  }

  const client = getClient();

  try {
    const suggestedParams = await client.getTransactionParams().do();

    // Build note: dtcore|<event>|<hash>[|<json-meta>]
    let note = `dtcore|${event}|${dataHash}`;
    const metaStr = Object.keys(meta).length ? `|${JSON.stringify(meta)}` : "";
    if (Buffer.byteLength(note + metaStr, "utf8") <= MAX_NOTE_BYTES) {
      note += metaStr;
    }

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from:            account.addr,
      to:              account.addr,
      amount:          0,                                        // zero-value — just anchoring
      note:            new TextEncoder().encode(note),
      suggestedParams,
    });

    const signedTxn = txn.signTxn(account.sk);
    const { txId } = await client.sendRawTransaction(signedTxn).do();

    logger.info("Algorand: audit record anchored", { event, txId, network: NETWORK });
    return txId;
  } catch (err) {
    logger.error("Algorand: failed to submit audit record", {
      event,
      error: err.message,
    });
    return null;
  }
}

/**
 * Check connectivity to the Algorand node.
 */
async function healthCheck() {
  try {
    const status = await getClient().status().do();
    return { ok: true, lastRound: status["last-round"] };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

module.exports = { submitAuditRecord, hashData, healthCheck, NETWORK };
