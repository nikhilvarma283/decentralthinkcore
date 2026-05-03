/**
 * x402 Payment System Tests
 * Tests wallet lifecycle, middleware 402 flow, client pay-and-retry, verifier.
 */

// ── Wallet ────────────────────────────────────────────────────────────────────
describe("wallet", () => {
  const { createEphemeralWallet, destroyWallet } = require("../../src/payments/wallet");

  it("creates a fresh Algorand account with spending limit", () => {
    const wallet = createEphemeralWallet(10_000);
    expect(wallet.address).toBeTruthy();
    expect(wallet.address).toMatch(/^[A-Z2-7]{58}$/); // Algorand base32 address
    expect(wallet.sk).toBeInstanceOf(Uint8Array);
    expect(wallet.sk.length).toBe(64);
    expect(wallet.spendingLimit).toBe(10_000);
    expect(wallet.spent).toBe(0);
    expect(wallet.destroyed).toBeUndefined();
    destroyWallet(wallet);
  });

  it("each call creates a different address", () => {
    const a = createEphemeralWallet(1000);
    const b = createEphemeralWallet(1000);
    expect(a.address).not.toBe(b.address);
    destroyWallet(a);
    destroyWallet(b);
  });

  it("destroyWallet zeroes the secret key", () => {
    const wallet = createEphemeralWallet(5_000);
    destroyWallet(wallet);
    expect(wallet.destroyed).toBe(true);
    expect(wallet.sk.every((b) => b === 0)).toBe(true);
  });

  it("destroyed wallet cannot sign (throws)", async () => {
    const { signPayment } = require("../../src/payments/wallet");
    const wallet = createEphemeralWallet(5_000);
    destroyWallet(wallet);
    await expect(
      signPayment(wallet, { to: "AAAA", amountMicroAlgo: 100, suggestedParams: {} })
    ).rejects.toThrow("already destroyed");
  });
});

// ── x402 Middleware ───────────────────────────────────────────────────────────
jest.mock("../../src/payments/x402Verifier", () => ({
  verify: jest.fn(),
  VERIFY_MODE: "simulate",
}));

const request = require("supertest");
const express = require("express");
const { requirePayment } = require("../../src/payments/x402Middleware");
const verifier = require("../../src/payments/x402Verifier");

function buildTestApp(opts = {}) {
  const app = express();
  app.use(express.json());
  app.post("/pay-me", requirePayment({ amountMicroAlgo: 1000, agentId: "test", ...opts }),
    (req, res) => res.json({ ok: true, payment: req.payment })
  );
  return app;
}

describe("x402Middleware", () => {
  it("returns 402 with X-Payment-Required when no payment header", async () => {
    const app = buildTestApp();
    const res = await request(app).post("/pay-me").send({});
    expect(res.status).toBe(402);
    expect(res.headers["x-payment-required"]).toBeTruthy();

    const decoded = JSON.parse(
      Buffer.from(res.headers["x-payment-required"], "base64").toString()
    );
    expect(decoded.accepts[0].maxAmountRequired).toBe("1000");
    expect(decoded.accepts[0].scheme).toBe("exact");
  });

  it("accepts valid payment and calls next()", async () => {
    verifier.verify.mockResolvedValue({ valid: true, txId: "TX123", mode: "simulate" });

    const paymentPayload = Buffer.from(JSON.stringify({
      x402Version: 1,
      scheme: "exact",
      network: "testnet",
      payload: { signedTxn: "fakesigned", txId: "TX123", payer: "WALLETADDR" },
    })).toString("base64");

    const app = buildTestApp();
    const res = await request(app)
      .post("/pay-me")
      .set("X-Payment", paymentPayload)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.payment.txId).toBe("TX123");
    expect(res.headers["x-payment-response"]).toBeTruthy();
  });

  it("rejects invalid payment with 402", async () => {
    verifier.verify.mockResolvedValue({ valid: false, reason: "amount too low" });

    const paymentPayload = Buffer.from(JSON.stringify({
      x402Version: 1, scheme: "exact", network: "testnet",
      payload: { signedTxn: "bad", txId: "TX_BAD", payer: "WALLET" },
    })).toString("base64");

    const app = buildTestApp();
    const res = await request(app)
      .post("/pay-me")
      .set("X-Payment", paymentPayload)
      .send({});

    expect(res.status).toBe(402);
    expect(res.body.reason).toBe("amount too low");
  });

  it("returns 400 for malformed X-Payment header", async () => {
    const app = buildTestApp();
    const res = await request(app)
      .post("/pay-me")
      .set("X-Payment", "not-valid-base64!!!")
      .send({});
    expect(res.status).toBe(400);
  });
});

// ── x402Client simulate mode ──────────────────────────────────────────────────
describe("x402Client simulate payment", () => {
  beforeEach(() => {
    verifier.verify.mockResolvedValue({ valid: true, txId: "SIM_TX", mode: "simulate" });
  });

  it("builds a simulated payment payload when no wallet provided", async () => {
    const { fetchWithPayment } = require("../../src/payments/x402Client");

    const requirement = {
      x402Version: 1,
      accepts: [{
        scheme: "exact", network: "testnet",
        maxAmountRequired: "1000", payTo: "PLATFORM_ADDR",
        resource: "/execute", description: "test",
      }],
    };

    const requirementHeader = Buffer.from(JSON.stringify(requirement)).toString("base64");

    global.fetch = jest.fn()
      .mockResolvedValueOnce({
        status: 402,
        headers: { get: (h) => h === "x-payment-required" ? requirementHeader : null },
        json: async () => ({ error: "Payment required" }),
      })
      .mockResolvedValueOnce({
        status: 200,
        headers: { get: () => null },
        json: async () => ({ result: "done", usage: { input_tokens: 10, output_tokens: 5 } }),
      });

    const { body } = await fetchWithPayment("http://agent/execute", { method: "POST" }, null);
    expect(body.result).toBe("done");
    expect(global.fetch).toHaveBeenCalledTimes(2);

    const secondCall = global.fetch.mock.calls[1];
    const paymentHeader = secondCall[1].headers["X-Payment"];
    expect(paymentHeader).toBeTruthy();
    const decoded = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    expect(decoded.payload.payer).toBe("SIMULATED_WALLET");
  });
});
