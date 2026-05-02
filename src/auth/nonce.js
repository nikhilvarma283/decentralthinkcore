const crypto = require("crypto");

// In-memory nonce store with TTL.
// Sprint 5 hardening: replace with Redis for multi-instance deployments.
const TTL_MS = 5 * 60 * 1000; // 5 minutes

const store = new Map(); // wallet → { nonce, expiresAt }

function generate(wallet) {
  const nonce = crypto.randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + TTL_MS);
  store.set(wallet.toLowerCase(), { nonce, expiresAt });
  return { nonce, expiresAt };
}

function consume(wallet, nonce) {
  const key = wallet.toLowerCase();
  const entry = store.get(key);
  if (!entry) return false;
  store.delete(key); // one-time use
  if (new Date() > entry.expiresAt) return false;
  return entry.nonce === nonce;
}

// Prune expired entries periodically
setInterval(() => {
  const now = new Date();
  for (const [key, entry] of store) {
    if (now > entry.expiresAt) store.delete(key);
  }
}, TTL_MS);

module.exports = { generate, consume };
