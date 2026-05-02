process.env.VAULT_ENCRYPTION_KEY = "b".repeat(64);

jest.mock("../../src/lib/db", () => ({ query: jest.fn() }));
jest.mock("../../src/auth/session", () => ({
  validate: jest.fn(),
  create: jest.fn(),
  revoke: jest.fn(),
}));

const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/lib/db");
const sessionMod = require("../../src/auth/session");

const WALLET = "0xdeadbeef00000000000000000000000000000001";
const TOKEN = "validtoken123";

beforeEach(() => {
  sessionMod.validate.mockResolvedValue({
    id: "sess-id",
    wallet_address: WALLET,
    expires_at: new Date(Date.now() + 3600_000),
  });
  db.query.mockResolvedValue({ rows: [], rowCount: 0 });
});

const authHeader = { Authorization: `Bearer ${TOKEN}` };

describe("PUT /api/v1/vault/:key", () => {
  it("stores a secret and returns 200", async () => {
    const res = await request(app)
      .put("/api/v1/vault/my-api-key")
      .set(authHeader)
      .send({ value: "secret123" });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("my-api-key");
    expect(db.query).toHaveBeenCalled();
  });

  it("returns 401 without auth token", async () => {
    sessionMod.validate.mockResolvedValue(null);
    const res = await request(app)
      .put("/api/v1/vault/my-key")
      .send({ value: "x" });
    expect(res.status).toBe(401);
  });

  it("rejects invalid key names", async () => {
    const res = await request(app)
      .put("/api/v1/vault/bad key!")
      .set(authHeader)
      .send({ value: "x" });
    expect(res.status).toBe(400);
  });

  it("rejects empty value", async () => {
    const res = await request(app)
      .put("/api/v1/vault/k")
      .set(authHeader)
      .send({ value: "" });
    expect(res.status).toBe(400);
  });
});

describe("GET /api/v1/vault/:key", () => {
  it("returns decrypted value for existing key", async () => {
    const { encrypt } = require("../../src/vault/crypto");
    const { ciphertext, iv } = encrypt("my-secret");

    db.query.mockResolvedValue({
      rows: [{ encrypted_value: ciphertext, iv }],
      rowCount: 1,
    });

    const res = await request(app)
      .get("/api/v1/vault/my-api-key")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.value).toBe("my-secret");
  });

  it("returns 404 for missing key", async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .get("/api/v1/vault/missing")
      .set(authHeader);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /api/v1/vault/:key", () => {
  it("deletes existing key and returns 200", async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 1 });
    const res = await request(app)
      .delete("/api/v1/vault/my-key")
      .set(authHeader);
    expect(res.status).toBe(200);
  });

  it("returns 404 when key does not exist", async () => {
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
    const res = await request(app)
      .delete("/api/v1/vault/ghost")
      .set(authHeader);
    expect(res.status).toBe(404);
  });
});

describe("GET /api/v1/vault", () => {
  it("lists keys without values", async () => {
    db.query.mockResolvedValue({
      rows: [
        { key_name: "key-a", created_at: new Date(), updated_at: new Date() },
        { key_name: "key-b", created_at: new Date(), updated_at: new Date() },
      ],
      rowCount: 2,
    });

    const res = await request(app).get("/api/v1/vault").set(authHeader);
    expect(res.status).toBe(200);
    expect(res.body.entries).toHaveLength(2);
    expect(res.body.entries[0].key_name).toBe("key-a");
    // Values must NOT appear in list response
    expect(res.body.entries[0].value).toBeUndefined();
  });
});
