jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
}));

const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/lib/db");

beforeEach(() => {
  // Mock Node 20 global fetch
  global.fetch = jest.fn().mockResolvedValue({ ok: true });
});

afterEach(() => {
  delete global.fetch;
});

describe("GET /health", () => {
  it("returns 200 with status ok when all checks pass", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.api).toBe("ok");
    expect(res.body.checks.database).toBe("ok");
    expect(res.body.checks.opa).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    db.query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("unreachable");
  });

  it("returns 503 when OPA is unreachable", async () => {
    global.fetch = jest.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.opa).toBe("unreachable");
  });
});
