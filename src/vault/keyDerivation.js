/**
 * Hierarchical key derivation — user-sovereign model (per patent Component 1).
 *
 * The master key is controlled EXCLUSIVELY by the user and never sent to this
 * server. The server stores only ciphertext. This file runs inside the TEE
 * (Cortex) where it derives temporary task sub-keys from a master key that
 * the user's client sends—encrypted—directly into the enclave.
 *
 * Key hierarchy:
 *   masterKey  (user device / HSM — never on server)
 *       └─ taskSubKey = HKDF(masterKey, salt, "dtcore:vault:" + keyName + ":" + sessionId)
 *             └─ used once, revoked after task completes
 *
 * HKDF is RFC 5869 (HMAC-based Key Derivation Function).
 * Node's built-in crypto module implements it natively in Node 15+.
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const KEY_LEN = 32;    // 256-bit
const IV_LEN = 12;     // 96-bit GCM IV
const TAG_LEN = 16;    // 128-bit auth tag

/**
 * Derive a task-scoped sub-key from the master key.
 * The sub-key is scoped to a specific vault entry + session so it cannot
 * be reused across sessions or for different data.
 *
 * @param {Buffer} masterKey - 32-byte master key (held by user, sent into TEE)
 * @param {string} keyName   - vault entry key name
 * @param {string} sessionId - current Cortex session ID
 * @returns {Buffer} 32-byte derived sub-key
 */
function deriveSubKey(masterKey, keyName, sessionId) {
  if (!Buffer.isBuffer(masterKey) || masterKey.length !== KEY_LEN) {
    throw new Error("masterKey must be a 32-byte Buffer");
  }

  const info = Buffer.from(`dtcore:vault:${keyName}:${sessionId}`, "utf8");
  const salt = crypto.randomBytes(16); // per-derivation salt stored alongside ciphertext

  // HKDF-Extract then HKDF-Expand
  const prk = crypto.createHmac("sha256", salt).update(masterKey).digest();
  const subKey = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), info, KEY_LEN);

  return { subKey: Buffer.from(subKey), salt };
}

/**
 * Encrypt plaintext with a derived sub-key.
 * Returns { ciphertext, iv, salt } — all safe to store server-side.
 * The server never needs the sub-key or master key to store this.
 */
function encryptWithSubKey(subKey, plaintext) {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, subKey, iv, { authTagLength: TAG_LEN });

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return { ciphertext: encrypted, iv };
}

/**
 * Decrypt ciphertext with a derived sub-key.
 * Throws if auth tag doesn't match (tamper detection).
 */
function decryptWithSubKey(subKey, ciphertext, iv) {
  const tag = ciphertext.slice(ciphertext.length - TAG_LEN);
  const data = ciphertext.slice(0, ciphertext.length - TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGORITHM, subKey, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

/**
 * Derive a master key from a wallet signature (deterministic).
 * Used client-side (browser SDK / Python SDK) — never called server-side.
 *
 * masterKey = HKDF(walletSignature, appSalt, "dtcore:master-key")
 *
 * The user's wallet signs a deterministic message. The signature becomes
 * the key material. Same wallet + same message = same master key every time.
 * No key storage needed — the wallet IS the key.
 */
function deriveMasterKeyFromSignature(walletSignature, appSalt = "decentralthink-sovereign-vault-v1") {
  const sigBuffer = Buffer.from(walletSignature.startsWith("0x") ? walletSignature.slice(2) : walletSignature, "hex");
  const saltBuffer = Buffer.from(appSalt, "utf8");
  const info = Buffer.from("dtcore:master-key", "utf8");

  const prk = crypto.createHmac("sha256", saltBuffer).update(sigBuffer).digest();
  const masterKey = crypto.hkdfSync("sha256", prk, Buffer.alloc(0), info, KEY_LEN);
  return Buffer.from(masterKey);
}

module.exports = { deriveSubKey, encryptWithSubKey, decryptWithSubKey, deriveMasterKeyFromSignature };
