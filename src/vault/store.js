/**
 * Sovereign Vault store — server-side (per patent Component 1).
 *
 * The server is a BLIND storage layer. It stores ciphertext blobs provided
 * by the client. It has NO decryption capability and NO access to keys.
 *
 * Encryption/decryption happens either:
 *   (a) Client-side (browser/SDK) — for user-controlled data
 *   (b) Inside Cortex TEE — using a sub-key the user provisioned into the enclave
 *
 * The server only ever sees: owner_address, key_name, ciphertext (bytes), iv (bytes).
 */

const db = require("../lib/db");

/**
 * Store a pre-encrypted vault entry.
 * ciphertext and iv are Buffers or base64 strings coming from the client.
 */
async function set(ownerAddress, keyName, ciphertext, iv) {
  const ciphertextBuf = Buffer.isBuffer(ciphertext)
    ? ciphertext
    : Buffer.from(ciphertext, "base64");
  const ivBuf = Buffer.isBuffer(iv) ? iv : Buffer.from(iv, "base64");

  await db.query(
    `INSERT INTO vault_entries (owner_address, key_name, encrypted_value, iv)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_address, key_name)
     DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                   iv              = EXCLUDED.iv,
                   updated_at      = now()`,
    [ownerAddress, keyName, ciphertextBuf, ivBuf]
  );
}

/**
 * Retrieve the raw ciphertext for a vault entry.
 * Returns { ciphertext: Buffer, iv: Buffer } or null.
 * Decryption is the caller's responsibility (client or Cortex TEE).
 */
async function getRaw(ownerAddress, keyName) {
  const { rows } = await db.query(
    `SELECT encrypted_value, iv FROM vault_entries
     WHERE owner_address = $1 AND key_name = $2`,
    [ownerAddress, keyName]
  );

  if (rows.length === 0) return null;

  return {
    ciphertext: rows[0].encrypted_value,
    iv: rows[0].iv,
  };
}

async function remove(ownerAddress, keyName) {
  const { rowCount } = await db.query(
    `DELETE FROM vault_entries WHERE owner_address = $1 AND key_name = $2`,
    [ownerAddress, keyName]
  );
  return rowCount > 0;
}

async function list(ownerAddress) {
  const { rows } = await db.query(
    `SELECT key_name, created_at, updated_at
     FROM vault_entries WHERE owner_address = $1
     ORDER BY key_name`,
    [ownerAddress]
  );
  return rows;
}

module.exports = { set, getRaw, remove, list };
