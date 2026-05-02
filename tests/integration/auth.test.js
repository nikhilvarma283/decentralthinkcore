jest.mock("../../src/lib/db", () => ({ query: jest.fn() }));
jest.mock("../../src/auth/siwe", () => ({ verify: jest.fn() }));
jest.mock("../../src/auth/session", () => ({
  create: jest.fn(),
  validate: jest.fn(),
  revoke: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const siwe = require("../../src/auth/siwe");
const sessionMod = require("../../src/auth/session");

const WALLET = "0xaaaa000000000000000000000000000000000001";

describe("GET /api/v1/auth/nonce", () => {
  it("returns a nonce for valid wallet", async () => {
    const res = await request(app)
      .get(`/api/v1/auth/nonce?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    expect(res.body.nonce).toBeDefined();
    expect(res.body.expiresAt).toBeDefined();
  });

  it("rejects invalid wallet address", async () => {
    const res = await request(app).get("/api/v1/auth/nonce?wallet=notawallet");
    expect(res.status).toBe(400);
  });

  it("rejects missing wallet param", async () => {
    const res = await request(app).get("/api/v1/auth/nonce");
    expect(res.status).toBe(400);
  });
});

describe("POST /api/v1/auth/verify", () => {
  it("returns token on valid SIWE signature", async () => {
    siwe.verify.mockResolvedValue({ wallet: WALLET });
    sessionMod.create.mockResolvedValue({
      token: "tok123",
      session: { id: "sess-1", expires_at: new Date() },
    });

    const res = await request(app)
      .post("/api/v1/auth/verify")
      .send({ message: "eip4361-msg", signature: "0xsig" });

    expect(res.status).toBe(200);
    expect(res.body.token).toBe("tok123");
    expect(res.body.wallet).toBe(WALLET);
  });

  it("returns 401 on bad signature", async () => {
    siwe.verify.mockRejectedValue(new Error("Signature verification failed"));

    const res = await request(app)
      .post("/api/v1/auth/verify")
      .send({ message: "msg", signature: "badsig" });

    expect(res.status).toBe(401);
  });

  it("returns 400 when fields missing", async () => {
    const res = await request(app).post("/api/v1/auth/verify").send({});
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/auth/me", () => {
  it("returns wallet for authenticated session", async () => {
    sessionMod.validate.mockResolvedValue({
      id: "sess-1",
      wallet_address: WALLET,
      expires_at: new Date(Date.now() + 3600_000),
    });

    const res = await request(app)
      .get("/api/v1/auth/me")
      .set("Authorization", "Bearer validtoken");

    expect(res.status).toBe(200);
    expect(res.body.wallet).toBe(WALLET);
  });

  it("returns 401 without token", async () => {
    const res = await request(app).get("/api/v1/auth/me");
    expect(res.status).toBe(401);
  });
});
