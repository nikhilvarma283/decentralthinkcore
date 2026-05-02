const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LEN = 12;   // 96-bit IV recommended for GCM
const TAG_LEN = 16;  // 128-bit auth tag

function getKey() {
  const hex = process.env.VAULT_ENCRYPTION_KEY;
  if (!hex || hex.length !== 64) {
    throw new Error(
      "VAULT_ENCRYPTION_KEY must be a 64-character hex string (32 bytes). " +
        "Generate with: openssl rand -hex 32"
    );
  }
  return Buffer.from(hex, "hex");
}

/**
 * Encrypt plaintext string → { ciphertext: Buffer, iv: Buffer }.
 * The auth tag is appended to ciphertext: [ ciphertext | tag (16 bytes) ].
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });

  const encrypted = Buffer.concat([
    cipher.update(Buffer.from(plaintext, "utf8")),
    cipher.final(),
    cipher.getAuthTag(),
  ]);

  return { ciphertext: encrypted, iv };
}

/**
 * Decrypt { ciphertext: Buffer, iv: Buffer } → plaintext string.
 * Throws if the auth tag doesn't match (tamper detection).
 */
function decrypt(ciphertext, iv) {
  const key = getKey();
  const tag = ciphertext.slice(ciphertext.length - TAG_LEN);
  const data = ciphertext.slice(0, ciphertext.length - TAG_LEN);

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LEN });
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
}

module.exports = { encrypt, decrypt };
