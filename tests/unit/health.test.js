const request = require("supertest");

// Mock DB and fetch before requiring app
jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [{ "?column?": 1 }] }),
}));

global.fetch = jest.fn().mockResolvedValue({ ok: true });

const app = require("../../src/app");

describe("GET /health", () => {
  it("returns 200 with status ok when all checks pass", async () => {
    const res = await request(app).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.checks.api).toBe("ok");
    expect(res.body.checks.database).toBe("ok");
  });

  it("returns 503 when database is unreachable", async () => {
    const db = require("../../src/lib/db");
    db.query.mockRejectedValueOnce(new Error("connection refused"));
    const res = await request(app).get("/health");
    expect(res.status).toBe(503);
    expect(res.body.checks.database).toBe("unreachable");
  });
});
