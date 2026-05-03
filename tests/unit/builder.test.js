const request = require("supertest");
const app = require("../../src/app");
const db = require("../../src/lib/db");
const auditLogger = require("../../src/blockchain/auditLogger");
const registry = require("../../src/marketplace/registry");
const subscriptions = require("../../src/marketplace/subscriptions");

jest.mock("../../src/lib/db");
jest.mock("../../src/blockchain/auditLogger");
jest.mock("../../src/marketplace/registry");
jest.mock("../../src/marketplace/subscriptions");

const AUTH_HEADER = { Authorization: "Bearer test-token" };
const WALLET = "0xBUILDER";

jest.mock("../../src/middleware/auth", () => ({
  requireAuth: (req, _res, next) => {
    req.walletAddress = WALLET;
    next();
  },
  optionalAuth: (req, _res, next) => {
    req.walletAddress = WALLET;
    next();
  },
}));

auditLogger.logEvent.mockResolvedValue({ blockchainTxid: null });

describe("Builder API", () => {
  describe("GET /api/v1/builder/deployments", () => {
    it("returns empty list when no deployments", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get("/api/v1/builder/deployments").set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ deployments: [], count: 0 });
    });

    it("returns deployments ordered by updated_at", async () => {
      const rows = [
        { id: "d1", name: "prod", status: "active" },
        { id: "d2", name: "staging", status: "draft" },
      ];
      db.query.mockResolvedValueOnce({ rows });
      const res = await request(app).get("/api/v1/builder/deployments").set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.deployments[0].name).toBe("prod");
    });
  });

  describe("GET /api/v1/builder/deployments/:id", () => {
    it("returns 404 when deployment not found", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app).get("/api/v1/builder/deployments/nonexistent").set(AUTH_HEADER);
      expect(res.status).toBe(404);
    });

    it("returns deployment by id", async () => {
      const row = { id: "abc", name: "my-app", blockchain_network: "testnet" };
      db.query.mockResolvedValueOnce({ rows: [row] });
      const res = await request(app).get("/api/v1/builder/deployments/abc").set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.name).toBe("my-app");
    });
  });

  describe("POST /api/v1/builder/deployments", () => {
    const validBody = {
      name: "my-deployment",
      blockchain_network: "testnet",
      spending_limit: 0.05,
      agent_ids: [],
    };

    it("creates a deployment", async () => {
      const created = { id: "new-id", ...validBody, status: "draft" };
      db.query.mockResolvedValueOnce({ rows: [created] });
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send(validBody);
      expect(res.status).toBe(201);
      expect(res.body.id).toBe("new-id");
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        "builder.deployment.create",
        expect.objectContaining({ data: expect.objectContaining({ name: "my-deployment" }) })
      );
    });

    it("rejects missing name", async () => {
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send({ blockchain_network: "testnet" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/name/);
    });

    it("rejects name longer than 64 chars", async () => {
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send({ name: "x".repeat(65) });
      expect(res.status).toBe(400);
    });

    it("rejects invalid blockchain_network", async () => {
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send({ name: "test", blockchain_network: "ethereum" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/blockchain_network/);
    });

    it("rejects non-array agent_ids", async () => {
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send({ name: "test", agent_ids: "bad" });
      expect(res.status).toBe(400);
    });

    it("returns 409 on duplicate name", async () => {
      const err = new Error("duplicate");
      err.code = "23505";
      db.query.mockRejectedValueOnce(err);
      const res = await request(app)
        .post("/api/v1/builder/deployments")
        .set(AUTH_HEADER)
        .send(validBody);
      expect(res.status).toBe(409);
    });
  });

  describe("PATCH /api/v1/builder/deployments/:id", () => {
    it("updates deployment status", async () => {
      const updated = { id: "abc", status: "active" };
      db.query.mockResolvedValueOnce({ rows: [updated] });
      const res = await request(app)
        .patch("/api/v1/builder/deployments/abc")
        .set(AUTH_HEADER)
        .send({ status: "active" });
      expect(res.status).toBe(200);
      expect(res.body.status).toBe("active");
    });

    it("rejects invalid status", async () => {
      const res = await request(app)
        .patch("/api/v1/builder/deployments/abc")
        .set(AUTH_HEADER)
        .send({ status: "running" });
      expect(res.status).toBe(400);
    });

    it("rejects invalid blockchain_network", async () => {
      const res = await request(app)
        .patch("/api/v1/builder/deployments/abc")
        .set(AUTH_HEADER)
        .send({ blockchain_network: "solana" });
      expect(res.status).toBe(400);
    });

    it("returns 400 when no updatable fields", async () => {
      const res = await request(app)
        .patch("/api/v1/builder/deployments/abc")
        .set(AUTH_HEADER)
        .send({ unknownField: "value" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/No updatable/);
    });

    it("returns 404 when not found", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .patch("/api/v1/builder/deployments/ghost")
        .set(AUTH_HEADER)
        .send({ status: "paused" });
      expect(res.status).toBe(404);
    });
  });

  describe("DELETE /api/v1/builder/deployments/:id", () => {
    it("archives (soft-deletes) a deployment", async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: "abc" }] });
      const res = await request(app)
        .delete("/api/v1/builder/deployments/abc")
        .set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ id: "abc", status: "archived" });
    });

    it("returns 404 when not found", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .delete("/api/v1/builder/deployments/ghost")
        .set(AUTH_HEADER);
      expect(res.status).toBe(404);
    });
  });

  describe("POST /api/v1/builder/deployments/:id/agents", () => {
    it("subscribes to agent and adds to deployment", async () => {
      registry.getAgent.mockResolvedValueOnce({ capabilities: ["search"] });
      subscriptions.subscribe.mockResolvedValueOnce({ id: "sub-1", active: true });
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .post("/api/v1/builder/deployments/dep-1/agents")
        .set(AUTH_HEADER)
        .send({ agent_id: "agent-search" });
      expect(res.status).toBe(201);
      expect(res.body.agent_id).toBe("agent-search");
      expect(subscriptions.subscribe).toHaveBeenCalledWith(WALLET, "agent-search", expect.any(Object));
    });

    it("returns 400 when agent_id missing", async () => {
      const res = await request(app)
        .post("/api/v1/builder/deployments/dep-1/agents")
        .set(AUTH_HEADER)
        .send({});
      expect(res.status).toBe(400);
    });

    it("returns 404 when agent not in marketplace", async () => {
      registry.getAgent.mockRejectedValueOnce(new Error("not found"));
      const res = await request(app)
        .post("/api/v1/builder/deployments/dep-1/agents")
        .set(AUTH_HEADER)
        .send({ agent_id: "nonexistent" });
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/builder/overview", () => {
    it("returns aggregate stats", async () => {
      db.query
        .mockResolvedValueOnce({ rows: [{ total: 3, active: 1 }] })
        .mockResolvedValueOnce({ rows: [{ total: 10, wiped: 8 }] })
        .mockResolvedValueOnce({ rows: [{ subscribed: 4 }] })
        .mockResolvedValueOnce({ rows: [{ total_usd: "1.25", total_credits: "125.0" }] });

      const res = await request(app).get("/api/v1/builder/overview").set(AUTH_HEADER);
      expect(res.status).toBe(200);
      expect(res.body.deployments).toEqual({ total: 3, active: 1 });
      expect(res.body.sessions).toEqual({ total: 10, wiped: 8 });
      expect(res.body.agents).toEqual({ subscribed: 4 });
      expect(res.body.costs.total_usd).toBe("1.25");
    });
  });
});
