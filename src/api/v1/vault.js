/**
 * Vault API — blind storage endpoints.
 *
 * The server is a zero-knowledge storage layer. Clients encrypt data before
 * sending. The server stores ciphertext + iv. It cannot read any values.
 *
 * Client workflow (browser SDK / Python SDK):
 *   1. Derive master key from wallet signature (HKDF — see keyDerivation.js)
 *   2. Encrypt value with master key (AES-256-GCM)
 *   3. PUT /api/v1/vault/:key with { ciphertext, iv } (base64)
 *   4. GET /api/v1/vault/:key → receive { ciphertext, iv } → decrypt locally
 *
 * Cortex (TEE) workflow:
 *   1. User provisions a sub-key into the enclave over an attested channel
 *   2. Cortex calls getRaw() → decrypts inside TEE → data never leaves enclave
 *   3. Sub-key is revoked after task completes
 */

const { Router } = require("express");
const { requireAuth } = require("../../middleware/auth");
const vault = require("../../vault/store");

const router = Router();
router.use(requireAuth);

const KEY_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;
const validKey = (k) => typeof k === "string" && KEY_PATTERN.test(k);

// GET /api/v1/vault — list key names (no values, ever)
router.get("/", async (req, res) => {
  const entries = await vault.list(req.walletAddress);
  res.json({ entries });
});

// PUT /api/v1/vault/:key — store pre-encrypted blob
// Body: { ciphertext: "<base64>", iv: "<base64>" }
router.put("/:key", async (req, res) => {
  const { key } = req.params;
  const { ciphertext, iv } = req.body;

  if (!validKey(key)) {
    return res.status(400).json({
      error: "key must be 1–128 chars: letters, digits, _, -, :, .",
    });
  }
  if (!ciphertext || !iv) {
    return res.status(400).json({
      error: "ciphertext and iv are required (encrypt client-side before sending)",
    });
  }

  let ciphertextBuf, ivBuf;
  try {
    ciphertextBuf = Buffer.from(ciphertext, "base64");
    ivBuf = Buffer.from(iv, "base64");
  } catch {
    return res.status(400).json({ error: "ciphertext and iv must be valid base64" });
  }

  if (ciphertextBuf.length === 0 || ivBuf.length === 0) {
    return res.status(400).json({ error: "ciphertext and iv cannot be empty" });
  }
  if (ciphertextBuf.length > 65_536 + 16) { // 64 KB + GCM tag
    return res.status(400).json({ error: "ciphertext exceeds 64 KB limit" });
  }

  await vault.set(req.walletAddress, key, ciphertextBuf, ivBuf);
  res.json({ key, stored: true });
});

// GET /api/v1/vault/:key — return raw ciphertext for client decryption
router.get("/:key", async (req, res) => {
  const { key } = req.params;

  if (!validKey(key)) {
    return res.status(400).json({ error: "Invalid key name" });
  }

  const raw = await vault.getRaw(req.walletAddress, key);
  if (!raw) {
    return res.status(404).json({ error: "Key not found" });
  }

  // Return base64 — client decrypts locally with their master key
  res.json({
    key,
    ciphertext: raw.ciphertext.toString("base64"),
    iv: raw.iv.toString("base64"),
  });
});

// DELETE /api/v1/vault/:key
router.delete("/:key", async (req, res) => {
  const { key } = req.params;

  if (!validKey(key)) {
    return res.status(400).json({ error: "Invalid key name" });
  }

  const deleted = await vault.remove(req.walletAddress, key);
  if (!deleted) {
    return res.status(404).json({ error: "Key not found" });
  }

  res.json({ key, deleted: true });
});

module.exports = router;
