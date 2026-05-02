const nonceStore = require("../../src/auth/nonce");

describe("nonce store", () => {
  const wallet = "0xabcdef1234567890abcdef1234567890abcdef12";

  it("generates a nonce and can consume it once", () => {
    const { nonce } = nonceStore.generate(wallet);
    expect(nonce).toHaveLength(32);
    expect(nonceStore.consume(wallet, nonce)).toBe(true);
  });

  it("cannot consume a nonce twice (replay protection)", () => {
    const { nonce } = nonceStore.generate(wallet);
    nonceStore.consume(wallet, nonce);
    expect(nonceStore.consume(wallet, nonce)).toBe(false);
  });

  it("rejects wrong nonce", () => {
    nonceStore.generate(wallet);
    expect(nonceStore.consume(wallet, "wrongnonce")).toBe(false);
  });

  it("returns false for unknown wallet", () => {
    expect(nonceStore.consume("0x0000000000000000000000000000000000000000", "any")).toBe(false);
  });

  it("is case-insensitive on wallet address", () => {
    const lower = wallet.toLowerCase();
    const upper = wallet.toUpperCase();
    const { nonce } = nonceStore.generate(upper);
    expect(nonceStore.consume(lower, nonce)).toBe(true);
  });
});
