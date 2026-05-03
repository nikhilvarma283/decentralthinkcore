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
const crypto = require("crypto");

const WALLET = "0xdeadbeef00000000000000000000000000000001";
const TOKEN = "validtoken123";

// Generate valid base64 ciphertext and iv for tests
const iv = crypto.randomBytes(12);
const key = crypto.randomBytes(32);
const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
const ct = Buffer.concat([cipher.update("secret"), cipher.final(), cipher.getAuthTag()]);
const VALID_CIPHERTEXT = ct.toString("base64");
const VALID_IV = iv.toString("base64");

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
  it("stores a pre-encrypted blob and returns 200", async () => {
    const res = await request(app)
      .put("/api/v1/vault/my-api-key")
      .set(authHeader)
      .send({ ciphertext: VALID_CIPHERTEXT, iv: VALID_IV });

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("my-api-key");
    expect(res.body.stored).toBe(true);
    expect(db.query).toHaveBeenCalled();
  });

  it("returns 401 without auth token", async () => {
    sessionMod.validate.mockResolvedValue(null);
    const res = await request(app)
      .put("/api/v1/vault/my-key")
      .send({ ciphertext: VALID_CIPHERTEXT, iv: VALID_IV });
    expect(res.status).toBe(401);
  });

  it("rejects invalid key names", async () => {
    const res = await request(app)
      .put("/api/v1/vault/bad key!")
      .set(authHeader)
      .send({ ciphertext: VALID_CIPHERTEXT, iv: VALID_IV });
    expect(res.status).toBe(400);
  });

  it("rejects missing ciphertext", async () => {
    const res = await request(app)
      .put("/api/v1/vault/k")
      .set(authHeader)
      .send({ iv: VALID_IV });
    expect(res.status).toBe(400);
  });

  it("rejects missing iv", async () => {
    const res = await request(app)
      .put("/api/v1/vault/k")
      .set(authHeader)
      .send({ ciphertext: VALID_CIPHERTEXT });
    expect(res.status).toBe(400);
  });

});

describe("GET /api/v1/vault/:key", () => {
  it("returns ciphertext blob for client decryption", async () => {
    db.query.mockResolvedValue({
      rows: [{ encrypted_value: ct, iv }],
      rowCount: 1,
    });

    const res = await request(app)
      .get("/api/v1/vault/my-api-key")
      .set(authHeader);

    expect(res.status).toBe(200);
    expect(res.body.key).toBe("my-api-key");
    expect(res.body.ciphertext).toBe(VALID_CIPHERTEXT);
    expect(res.body.iv).toBe(VALID_IV);
    // Server must never return decrypted value
    expect(res.body.value).toBeUndefined();
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
    expect(res.body.deleted).toBe(true);
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
  it("lists keys without values or ciphertext", async () => {
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
    expect(res.body.entries[0].value).toBeUndefined();
    expect(res.body.entries[0].ciphertext).toBeUndefined();
  });
});
