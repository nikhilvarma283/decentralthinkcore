// Set a valid 32-byte hex key before requiring the module
process.env.VAULT_ENCRYPTION_KEY = "a".repeat(64);

const { encrypt, decrypt } = require("../../src/vault/crypto");

describe("vault crypto (AES-256-GCM)", () => {
  it("encrypts and decrypts a string round-trip", () => {
    const plaintext = "super secret API key";
    const { ciphertext, iv } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv)).toBe(plaintext);
  });

  it("produces different ciphertext for same plaintext (random IV)", () => {
    const plaintext = "same value";
    const a = encrypt(plaintext);
    const b = encrypt(plaintext);
    expect(a.ciphertext.toString("hex")).not.toBe(b.ciphertext.toString("hex"));
    expect(a.iv.toString("hex")).not.toBe(b.iv.toString("hex"));
  });

  it("throws on tampered ciphertext (auth tag mismatch)", () => {
    const { ciphertext, iv } = encrypt("original");
    // Flip a byte in the ciphertext body
    ciphertext[0] ^= 0xff;
    expect(() => decrypt(ciphertext, iv)).toThrow();
  });

  it("throws on wrong key length", () => {
    const saved = process.env.VAULT_ENCRYPTION_KEY;
    process.env.VAULT_ENCRYPTION_KEY = "tooshort";
    expect(() => encrypt("x")).toThrow("VAULT_ENCRYPTION_KEY");
    process.env.VAULT_ENCRYPTION_KEY = saved;
  });

  it("encrypts unicode content correctly", () => {
    const plaintext = "こんにちは 🔐 émojis & unicode";
    const { ciphertext, iv } = encrypt(plaintext);
    expect(decrypt(ciphertext, iv)).toBe(plaintext);
  });
});
