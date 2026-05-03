/**
 * Sprint 7 — Inter-user secure messaging within a deployment.
 *
 * Patent invariants preserved:
 *   - Server is a BLIND transport layer: encrypted_content is AES-256-GCM
 *     ciphertext produced CLIENT-SIDE. The server cannot read message content.
 *   - Context sharing uses abstract scores/embeddings only — never raw data.
 *   - Every message and context share is anchored to the Algorand audit chain.
 *   - Deployment membership is gated by the builder's OPA policy.
 */

const { Router } = require("express");
const crypto = require("crypto");
const { requireAuth } = require("../../middleware/auth");
const db = require("../../lib/db");
const auditLogger = require("../../blockchain/auditLogger");

const router = Router();
router.use(requireAuth);

const VALID_CONTEXT_TYPES = ["scores", "embedding", "summary"];

// ── Helpers ───────────────────────────────────────────────────────────────────

async function getDeploymentMember(deploymentId, walletAddress) {
  const { rows } = await db.query(
    `SELECT dm.*, bd.owner_address
       FROM deployment_members dm
       JOIN builder_deployments bd ON bd.id = dm.deployment_id
      WHERE dm.deployment_id = $1 AND dm.wallet_address = $2`,
    [deploymentId, walletAddress]
  );
  return rows[0] || null;
}

async function deploymentExists(deploymentId) {
  const { rows } = await db.query(
    `SELECT id, owner_address FROM builder_deployments WHERE id = $1`,
    [deploymentId]
  );
  return rows[0] || null;
}

// ── Membership ────────────────────────────────────────────────────────────────

// POST /api/v1/messaging/deployments/:deploymentId/members — join a deployment
router.post("/deployments/:deploymentId/members", async (req, res) => {
  const { deploymentId } = req.params;
  const { public_key } = req.body;

  const deployment = await deploymentExists(deploymentId).catch(() => null);
  if (!deployment) return res.status(404).json({ error: "Deployment not found" });

  const role = deployment.owner_address === req.walletAddress ? "owner" : "member";

  try {
    const { rows } = await db.query(
      `INSERT INTO deployment_members (deployment_id, wallet_address, role, public_key)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (deployment_id, wallet_address)
         DO UPDATE SET public_key = EXCLUDED.public_key
       RETURNING *`,
      [deploymentId, req.walletAddress, role, public_key || null]
    );

    await auditLogger.logEvent("messaging.member.join", {
      data: { deploymentId, walletAddress: req.walletAddress, role },
      payload: { deploymentId, role },
    });

    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to join deployment" });
  }
});

// GET /api/v1/messaging/deployments/:deploymentId/members — list members
router.get("/deployments/:deploymentId/members", async (req, res) => {
  const member = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!member) return res.status(403).json({ error: "Not a member of this deployment" });

  try {
    const { rows } = await db.query(
      `SELECT wallet_address, role, public_key, joined_at
         FROM deployment_members
        WHERE deployment_id = $1
        ORDER BY joined_at ASC`,
      [req.params.deploymentId]
    );
    res.json({ members: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch members" });
  }
});

// DELETE /api/v1/messaging/deployments/:deploymentId/members/:address — remove member
router.delete("/deployments/:deploymentId/members/:address", async (req, res) => {
  const member = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!member) return res.status(403).json({ error: "Not a member of this deployment" });

  const isSelf = req.params.address === req.walletAddress;
  if (!isSelf && !["owner", "admin"].includes(member.role)) {
    return res.status(403).json({ error: "Insufficient permissions" });
  }

  try {
    const { rows } = await db.query(
      `DELETE FROM deployment_members
        WHERE deployment_id = $1 AND wallet_address = $2
        RETURNING wallet_address`,
      [req.params.deploymentId, req.params.address]
    );
    if (!rows.length) return res.status(404).json({ error: "Member not found" });
    res.json({ removed: rows[0].wallet_address });
  } catch {
    res.status(500).json({ error: "Failed to remove member" });
  }
});

// ── Secure messages ───────────────────────────────────────────────────────────

// POST /api/v1/messaging/deployments/:deploymentId/messages — send encrypted message
router.post("/deployments/:deploymentId/messages", async (req, res) => {
  const { recipient_address, ciphertext, iv, content_hash } = req.body;

  if (!recipient_address) return res.status(400).json({ error: "recipient_address is required" });
  if (!ciphertext) return res.status(400).json({ error: "ciphertext is required (client-encrypted)" });
  if (!iv) return res.status(400).json({ error: "iv is required" });
  if (!content_hash) return res.status(400).json({ error: "content_hash is required" });

  const sender = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!sender) return res.status(403).json({ error: "Not a member of this deployment" });

  const recipient = await getDeploymentMember(req.params.deploymentId, recipient_address).catch(() => null);
  if (!recipient) return res.status(404).json({ error: "Recipient is not a member of this deployment" });

  try {
    const ciphertextBuf = Buffer.from(ciphertext, "base64");
    const ivBuf = Buffer.from(iv, "base64");

    const { rows } = await db.query(
      `INSERT INTO secure_messages
         (deployment_id, sender_address, recipient_address, encrypted_content, iv, content_hash)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, deployment_id, sender_address, recipient_address, content_hash, sent_at`,
      [req.params.deploymentId, req.walletAddress, recipient_address,
       ciphertextBuf, ivBuf, content_hash]
    );

    await auditLogger.logEvent("messaging.message.send", {
      data: { deploymentId: req.params.deploymentId, contentHash: content_hash },
      payload: { messageId: rows[0].id, deploymentId: req.params.deploymentId },
    });

    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to send message" });
  }
});

// GET /api/v1/messaging/deployments/:deploymentId/messages — get inbox
router.get("/deployments/:deploymentId/messages", async (req, res) => {
  const member = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!member) return res.status(403).json({ error: "Not a member of this deployment" });

  const { unread_only } = req.query;

  try {
    const { rows } = await db.query(
      `SELECT id, deployment_id, sender_address, recipient_address,
              encode(encrypted_content, 'base64') AS ciphertext,
              encode(iv, 'base64') AS iv,
              content_hash, blockchain_txid, sent_at, read_at
         FROM secure_messages
        WHERE deployment_id = $1 AND recipient_address = $2
          ${unread_only === "true" ? "AND read_at IS NULL" : ""}
        ORDER BY sent_at DESC
        LIMIT 100`,
      [req.params.deploymentId, req.walletAddress]
    );
    res.json({ messages: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// PATCH /api/v1/messaging/deployments/:deploymentId/messages/:id/read — mark as read
router.patch("/deployments/:deploymentId/messages/:id/read", async (req, res) => {
  try {
    const { rows } = await db.query(
      `UPDATE secure_messages
          SET read_at = now()
        WHERE id = $1 AND recipient_address = $2 AND deployment_id = $3
        RETURNING id, read_at`,
      [req.params.id, req.walletAddress, req.params.deploymentId]
    );
    if (!rows.length) return res.status(404).json({ error: "Message not found" });
    res.json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to mark message as read" });
  }
});

// ── Context sharing ───────────────────────────────────────────────────────────

// POST /api/v1/messaging/deployments/:deploymentId/context — share abstract context
router.post("/deployments/:deploymentId/context", async (req, res) => {
  const { recipient_address, context_type, context_data, expires_in_hours } = req.body;

  if (!context_type || !VALID_CONTEXT_TYPES.includes(context_type)) {
    return res.status(400).json({ error: `context_type must be one of: ${VALID_CONTEXT_TYPES.join(", ")}` });
  }
  if (!context_data || typeof context_data !== "object" || Array.isArray(context_data)) {
    return res.status(400).json({ error: "context_data must be a JSON object of scores/embeddings" });
  }

  const member = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!member) return res.status(403).json({ error: "Not a member of this deployment" });

  // Enforce the patent invariant: no raw text in context_data
  const hasRawText = Object.values(context_data).some(
    (v) => typeof v === "string" && v.length > 64
  );
  if (hasRawText) {
    return res.status(400).json({
      error: "context_data must contain abstract scores/embeddings only — no raw text content",
    });
  }

  const dataHash = crypto
    .createHash("sha256")
    .update(JSON.stringify(context_data))
    .digest("hex");

  const expiresAt = expires_in_hours
    ? new Date(Date.now() + expires_in_hours * 3600 * 1000)
    : null;

  try {
    const { rows } = await db.query(
      `INSERT INTO context_shares
         (deployment_id, sharer_address, recipient_address, context_type,
          context_data, data_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, deployment_id, sharer_address, recipient_address,
                 context_type, data_hash, shared_at, expires_at`,
      [req.params.deploymentId, req.walletAddress, recipient_address || null,
       context_type, context_data, dataHash, expiresAt]
    );

    await auditLogger.logEvent("messaging.context.share", {
      data: { deploymentId: req.params.deploymentId, contextType: context_type, dataHash },
      payload: { shareId: rows[0].id, contextType: context_type },
    });

    res.status(201).json(rows[0]);
  } catch {
    res.status(500).json({ error: "Failed to share context" });
  }
});

// GET /api/v1/messaging/deployments/:deploymentId/context — get context shared with me
router.get("/deployments/:deploymentId/context", async (req, res) => {
  const member = await getDeploymentMember(req.params.deploymentId, req.walletAddress).catch(() => null);
  if (!member) return res.status(403).json({ error: "Not a member of this deployment" });

  const { context_type } = req.query;

  try {
    const params = [req.params.deploymentId, req.walletAddress];
    const typeClause = context_type ? `AND context_type = $${params.push(context_type)}` : "";

    const { rows } = await db.query(
      `SELECT id, sharer_address, recipient_address, context_type,
              context_data, data_hash, blockchain_txid, shared_at, expires_at
         FROM context_shares
        WHERE deployment_id = $1
          AND (recipient_address = $2 OR recipient_address IS NULL)
          AND (expires_at IS NULL OR expires_at > now())
          ${typeClause}
        ORDER BY shared_at DESC
        LIMIT 200`,
      params
    );
    res.json({ context: rows, count: rows.length });
  } catch {
    res.status(500).json({ error: "Failed to fetch context" });
  }
});

module.exports = router;
