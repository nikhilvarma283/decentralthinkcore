const db = require("../lib/db");
const { encrypt, decrypt } = require("./crypto");

async function set(ownerAddress, keyName, plaintext) {
  const { ciphertext, iv } = encrypt(plaintext);

  await db.query(
    `INSERT INTO vault_entries (owner_address, key_name, encrypted_value, iv)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (owner_address, key_name)
     DO UPDATE SET encrypted_value = EXCLUDED.encrypted_value,
                   iv              = EXCLUDED.iv,
                   updated_at      = now()`,
    [ownerAddress, keyName, ciphertext, iv]
  );
}

async function get(ownerAddress, keyName) {
  const { rows } = await db.query(
    `SELECT encrypted_value, iv FROM vault_entries
     WHERE owner_address = $1 AND key_name = $2`,
    [ownerAddress, keyName]
  );

  if (rows.length === 0) return null;

  const { encrypted_value, iv } = rows[0];
  return decrypt(encrypted_value, iv);
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

module.exports = { set, get, remove, list };
