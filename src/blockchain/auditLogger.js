/**
 * Audit Logger — records every significant event to the audit_log table
 * and anchors a cryptographic proof to Algorand.
 *
 * What gets stored on-chain: SHA-256(event + data_hash + timestamp)
 * What gets stored in DB: event type, data_hash, tee_attestation, payload metadata
 * What NEVER gets stored anywhere: raw task content, vault values, PII
 */

const db = require("../lib/db");
const logger = require("../lib/logger");
const { submitAuditRecord, hashData } = require("./algorand");

/**
 * Log an audit event.
 *
 * @param {string} event               - e.g. "cortex.start" | "agent.execute" | "vault.access"
 * @param {object} options
 * @param {string} [options.invocationId]
 * @param {string} [options.cortexSessionId]
 * @param {object} [options.data]      - Data to hash (never stored raw)
 * @param {string} [options.teeAttestation]
 * @param {object} [options.payload]   - Non-sensitive metadata stored in DB
 */
async function logEvent(event, options = {}) {
  const {
    invocationId = null,
    cortexSessionId = null,
    data = null,
    teeAttestation = null,
    payload = {},
  } = options;

  const dataHash = data ? hashData(data) : null;

  // 1. Submit to Algorand (non-blocking — failure must not crash the pipeline)
  let blockchainTxid = null;
  try {
    blockchainTxid = await submitAuditRecord(event, dataHash || "no-data", {
      inv: invocationId,
      ctx: cortexSessionId,
    });
  } catch (err) {
    logger.error("auditLogger: Algorand submission failed", { event, error: err.message });
  }

  // 2. Persist to DB
  try {
    await db.query(
      `INSERT INTO audit_log
         (invocation_id, cortex_session_id, event, data_hash, tee_attestation, payload, blockchain_txid)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [invocationId, cortexSessionId, event, dataHash, teeAttestation, payload, blockchainTxid]
    );
  } catch (err) {
    logger.error("auditLogger: DB insert failed", { event, error: err.message });
  }

  return { event, dataHash, blockchainTxid };
}

module.exports = { logEvent };
