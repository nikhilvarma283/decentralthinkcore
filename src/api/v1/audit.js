/**
 * Audit Log API — read-only access to the blockchain-anchored audit trail.
 *
 * Returns cryptographic proof records only — no raw data, no PII.
 * Each record includes the Algorand blockchain_txid for independent verification.
 */

const { Router } = require("express");
const { requireAuth } = require("../../middleware/auth");
const db = require("../../lib/db");
const { NETWORK } = require("../../blockchain/algorand");

const router = Router();
router.use(requireAuth);

// GET /api/v1/audit?invocation_id=<uuid>&limit=50
router.get("/", async (req, res) => {
  const { invocation_id, limit = 50, offset = 0 } = req.query;

  const cap = Math.min(parseInt(limit) || 50, 200);
  const off = parseInt(offset) || 0;

  try {
    let query, params;
    if (invocation_id) {
      query = `
        SELECT id, invocation_id, cortex_session_id, event, data_hash,
               tee_attestation, payload, blockchain_txid, recorded_at
          FROM audit_log
         WHERE invocation_id = $1
         ORDER BY recorded_at DESC
         LIMIT $2 OFFSET $3`;
      params = [invocation_id, cap, off];
    } else {
      // Only return records belonging to the authenticated wallet
      query = `
        SELECT al.id, al.invocation_id, al.cortex_session_id, al.event,
               al.data_hash, al.tee_attestation, al.payload,
               al.blockchain_txid, al.recorded_at
          FROM audit_log al
          JOIN invocations i ON i.id = al.invocation_id
          JOIN cortex_sessions cs ON cs.id = al.cortex_session_id
         WHERE cs.wallet_address = $1
         ORDER BY al.recorded_at DESC
         LIMIT $2 OFFSET $3`;
      params = [req.walletAddress, cap, off];
    }

    const { rows } = await db.query(query, params);

    res.json({
      records: rows.map((r) => ({
        ...r,
        explorer_url: r.blockchain_txid
          ? `https://testnet.algoexplorer.io/tx/${r.blockchain_txid}`
          : null,
        network: NETWORK,
      })),
      count: rows.length,
      network: NETWORK,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit log" });
  }
});

// GET /api/v1/audit/:id
router.get("/:id", async (req, res) => {
  try {
    const { rows } = await db.query(
      `SELECT al.*, cs.wallet_address
         FROM audit_log al
         LEFT JOIN cortex_sessions cs ON cs.id = al.cortex_session_id
        WHERE al.id = $1`,
      [req.params.id]
    );

    if (!rows.length) return res.status(404).json({ error: "Record not found" });

    const record = rows[0];
    if (record.wallet_address && record.wallet_address !== req.walletAddress) {
      return res.status(403).json({ error: "Access denied" });
    }

    res.json({
      ...record,
      explorer_url: record.blockchain_txid
        ? `https://testnet.algoexplorer.io/tx/${record.blockchain_txid}`
        : null,
      network: NETWORK,
    });
  } catch (err) {
    res.status(500).json({ error: "Failed to fetch audit record" });
  }
});

module.exports = router;
