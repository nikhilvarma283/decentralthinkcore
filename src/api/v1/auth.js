const { Router } = require("express");
const nonceStore = require("../../auth/nonce");
const siwe = require("../../auth/siwe");
const session = require("../../auth/session");
const { requireAuth } = require("../../middleware/auth");
const logger = require("../../lib/logger");

const router = Router();

// GET /api/v1/auth/nonce?wallet=0x...
// Generate a one-time nonce for the wallet to sign.
router.get("/nonce", (req, res) => {
  const wallet = req.query.wallet;
  if (!wallet || !/^0x[0-9a-fA-F]{40}$/.test(wallet)) {
    return res.status(400).json({ error: "wallet query param must be a valid Ethereum address" });
  }

  const { nonce, expiresAt } = nonceStore.generate(wallet);
  res.json({ nonce, expiresAt });
});

// POST /api/v1/auth/verify
// Verify a SIWE signature and issue a session token.
router.post("/verify", async (req, res) => {
  const { message, signature } = req.body;

  if (!message || !signature) {
    return res.status(400).json({ error: "message and signature are required" });
  }

  try {
    const { wallet } = await siwe.verify(message, signature);
    const { token, session: sess } = await session.create(wallet);

    res.json({
      token,
      wallet,
      session_id: sess.id,
      expires_at: sess.expires_at,
    });
  } catch (err) {
    logger.warn("Auth verify failed", { error: err.message });
    res.status(401).json({ error: err.message });
  }
});

// POST /api/v1/auth/logout
// Revoke the current session token.
router.post("/logout", requireAuth, async (req, res) => {
  const header = req.headers.authorization || "";
  const token = header.slice(7); // strip "Bearer "

  const revoked = await session.revoke(token);
  if (!revoked) {
    return res.status(404).json({ error: "Session not found" });
  }

  res.json({ message: "Logged out successfully" });
});

// GET /api/v1/auth/me
// Return the current session's wallet address.
router.get("/me", requireAuth, (req, res) => {
  res.json({
    wallet: req.walletAddress,
    session_id: req.session.id,
    expires_at: req.session.expires_at,
  });
});

module.exports = router;
