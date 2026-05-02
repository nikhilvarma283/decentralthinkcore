const crypto = require("crypto");
const db = require("../lib/db");
const logger = require("../lib/logger");

const TTL_SECONDS = parseInt(process.env.SESSION_TTL_SECONDS || "3600");

function generateToken() {
  return crypto.randomBytes(32).toString("hex");
}

async function create(wallet) {
  const token = generateToken();
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000);

  const { rows } = await db.query(
    `INSERT INTO sessions (id, wallet_address, expires_at, metadata)
     VALUES (gen_random_uuid(), $1, $2, $3)
     RETURNING id, wallet_address, expires_at`,
    [wallet, expiresAt, JSON.stringify({ token_hash: hash(token) })]
  );

  const session = rows[0];
  logger.info("Session created", { sessionId: session.id, wallet });
  return { token, session };
}

/**
 * Validate a bearer token.
 * Returns the session row or null.
 */
async function validate(token) {
  if (!token) return null;

  const tokenHash = hash(token);

  const { rows } = await db.query(
    `SELECT id, wallet_address, expires_at, revoked_at
     FROM sessions
     WHERE metadata->>'token_hash' = $1
       AND revoked_at IS NULL
       AND expires_at > now()`,
    [tokenHash]
  );

  return rows[0] || null;
}

async function revoke(token) {
  const tokenHash = hash(token);
  const { rowCount } = await db.query(
    `UPDATE sessions SET revoked_at = now()
     WHERE metadata->>'token_hash' = $1 AND revoked_at IS NULL`,
    [tokenHash]
  );
  return rowCount > 0;
}

function hash(token) {
  return crypto.createHash("sha256").update(token).digest("hex");
}

module.exports = { create, validate, revoke };
