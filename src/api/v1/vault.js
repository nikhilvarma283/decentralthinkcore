const { Router } = require("express");
const { requireAuth } = require("../../middleware/auth");
const vault = require("../../vault/store");

const router = Router();

// All vault routes require authentication
router.use(requireAuth);

const KEY_PATTERN = /^[a-zA-Z0-9_\-:.]{1,128}$/;

function validKey(k) {
  return typeof k === "string" && KEY_PATTERN.test(k);
}

// GET /api/v1/vault — list keys for this wallet (values never returned in list)
router.get("/", async (req, res) => {
  const entries = await vault.list(req.walletAddress);
  res.json({ entries });
});

// PUT /api/v1/vault/:key — store or overwrite a secret
router.put("/:key", async (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (!validKey(key)) {
    return res.status(400).json({
      error: "key must be 1–128 characters: letters, digits, _, -, :, .",
    });
  }
  if (typeof value !== "string" || value.length === 0) {
    return res.status(400).json({ error: "value must be a non-empty string" });
  }
  if (value.length > 65536) {
    return res.status(400).json({ error: "value must be at most 64 KB" });
  }

  await vault.set(req.walletAddress, key, value);
  res.json({ key, message: "Stored successfully" });
});

// GET /api/v1/vault/:key — retrieve and decrypt a secret
router.get("/:key", async (req, res) => {
  const { key } = req.params;

  if (!validKey(key)) {
    return res.status(400).json({ error: "Invalid key name" });
  }

  const value = await vault.get(req.walletAddress, key);
  if (value === null) {
    return res.status(404).json({ error: "Key not found" });
  }

  res.json({ key, value });
});

// DELETE /api/v1/vault/:key — remove a secret
router.delete("/:key", async (req, res) => {
  const { key } = req.params;

  if (!validKey(key)) {
    return res.status(400).json({ error: "Invalid key name" });
  }

  const deleted = await vault.remove(req.walletAddress, key);
  if (!deleted) {
    return res.status(404).json({ error: "Key not found" });
  }

  res.json({ key, message: "Deleted successfully" });
});

module.exports = router;
