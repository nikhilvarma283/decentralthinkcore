jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
}));

jest.mock("../../src/lib/llm", () => ({
  healthCheck: jest.fn().mockResolvedValue({ ok: true, reason: null }),
}));

jest.mock("../../src/blockchain/algorand", () => ({
  healthCheck: jest.fn().mockResolvedValue({ ok: true, lastRound: 1000 }),
  NETWORK: "testnet",
}));

const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/lib/db");
const llm = require("../../src/lib/llm");
const algorand = require("../../src/blockchain/algorand");

beforeEach(() => {
  delete process.env.OPA_URL;
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
  llm.healthCheck.mockResolvedValue({ ok: true, reason: null });
  algorand.healthCheck.mockResolvedValue({ ok: true, lastRound: 1000 });
  db.query.mockResolvedValue({ rows: [{ "?column?": 1 }] });
});

afterEach(() => {
  delete global.fetch;
});

describe("GET /health", () => {
  it("returns 200 when all checks pass (no OPA configured)", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.api).toBe("ok");
    expect(res.body.checks.hermes).toBe("ok");
    expect(res.body.checks.database).toBe("ok");
    expect(res.body.checks.algorand).toBe("ok");
    expect(res.body.checks.opa).toBe("not-configured");
    expect(res.body.model).toBeDefined();
  });

  it("returns 200 when OPA is also ok", async () => {
    process.env.OPA_URL = "http://opa:8181";
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.checks.opa).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    db.query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("unreachable");
  });

  it("returns 503 when Hermes/Ollama is unreachable", async () => {
    llm.healthCheck.mockRejectedValueOnce(new Error("ECONNREFUSED"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.hermes).toBe("unreachable");
  });

  it("returns 503 when OPA is unreachable", async () => {
    process.env.OPA_URL = "http://opa:8181";
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.opa).toBe("unreachable");
  });
});
