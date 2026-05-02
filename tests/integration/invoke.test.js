/**
 * Integration tests for POST /api/v1/invoke and GET /api/v1/invocations/:id.
 * Mocks DB and Anthropic so no live services are needed.
 */

jest.mock("../../src/lib/db", () => ({
  query: jest.fn(),
}));

jest.mock("@anthropic-ai/sdk", () => {
  return jest.fn().mockImplementation(() => ({
    messages: {
      create: jest.fn().mockResolvedValue({
        content: [{ type: "text", text: "42" }],
        usage: { input_tokens: 10, output_tokens: 5 },
      }),
    },
  }));
});

const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/lib/db");

// Stub DB responses by default
beforeEach(() => {
  db.query.mockImplementation((sql) => {
    if (sql.startsWith("INSERT INTO invocations")) return Promise.resolve({ rows: [] });
    if (sql.startsWith("UPDATE invocations")) return Promise.resolve({ rows: [] });
    if (sql.startsWith("INSERT INTO cost_ledger")) return Promise.resolve({ rows: [] });
    if (sql.startsWith("SELECT") && sql.includes("FROM invocations WHERE id")) {
      return Promise.resolve({
        rows: [{
          id: "test-uuid-1234-5678-abcd-ef0123456789",
          agent_id: "hermes-default",
          task: "What is 2+2?",
          status: "completed",
          result: "42",
          cost_credits: "0.000050",
          policy_decision: null,
          blockchain_txid: null,
          started_at: new Date(),
          completed_at: new Date(),
          error: null,
        }],
      });
    }
    if (sql.startsWith("SELECT 1")) return Promise.resolve({ rows: [{}] });
    return Promise.resolve({ rows: [] });
  });
});

describe("POST /api/v1/invoke", () => {
  it("returns 202 with invocation_id for valid task", async () => {
    const res = await request(app)
      .post("/api/v1/invoke")
      .send({ task: "What is 2+2?" });

    expect(res.status).toBe(202);
    expect(res.body.invocation_id).toBeDefined();
    expect(res.body.status).toBe("pending");
  });

  it("returns 400 when task is missing", async () => {
    const res = await request(app)
      .post("/api/v1/invoke")
      .send({});

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("Validation failed");
  });

  it("returns 400 when task is empty string", async () => {
    const res = await request(app)
      .post("/api/v1/invoke")
      .send({ task: "   " });

    expect(res.status).toBe(400);
  });

  it("returns 400 when task exceeds 10k chars", async () => {
    const res = await request(app)
      .post("/api/v1/invoke")
      .send({ task: "x".repeat(10_001) });

    expect(res.status).toBe(400);
  });

  it("accepts optional agent_id and session_id", async () => {
    const res = await request(app)
      .post("/api/v1/invoke")
      .send({
        task: "Summarize this",
        agent_id: "custom-agent",
        session_id: "550e8400-e29b-41d4-a716-446655440000",
      });

    expect(res.status).toBe(202);
  });
});

describe("GET /api/v1/invocations/:id", () => {
  it("returns 400 for malformed ID", async () => {
    const res = await request(app).get("/api/v1/invocations/not-a-uuid");
    expect(res.status).toBe(400);
  });

  it("returns invocation record when found", async () => {
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const res = await request(app).get(`/api/v1/invocations/${id}`);
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("completed");
    expect(res.body.result).toBe("42");
  });

  it("returns 404 when not found", async () => {
    db.query.mockResolvedValueOnce({ rows: [] });
    const id = "550e8400-e29b-41d4-a716-446655440000";
    const res = await request(app).get(`/api/v1/invocations/${id}`);
    expect(res.status).toBe(404);
  });
});
