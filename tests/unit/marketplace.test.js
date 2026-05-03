jest.mock("../../src/lib/db", () => ({
  query: jest.fn(),
}));
jest.mock("../../src/blockchain/auditLogger", () => ({
  logEvent: jest.fn().mockResolvedValue({}),
}));

const db = require("../../src/lib/db");
const { commitCapability, register, listAgents } = require("../../src/marketplace/registry");
const { subscribe, listSubscriptions } = require("../../src/marketplace/subscriptions");
const { routeTask, DEFAULT_AGENT } = require("../../src/marketplace/discovery");

describe("commitCapability", () => {
  it("returns a 64-char hex SHA-256", () => {
    const hash = commitCapability("agent-1", "web-search", "secret123");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("same inputs always produce same hash", () => {
    const a = commitCapability("agent-1", "code", "secret");
    const b = commitCapability("agent-1", "code", "secret");
    expect(a).toBe(b);
  });

  it("different secrets produce different hashes", () => {
    const a = commitCapability("agent-1", "code", "secret-a");
    const b = commitCapability("agent-1", "code", "secret-b");
    expect(a).not.toBe(b);
  });
});

describe("registry.register", () => {
  it("upserts agent and returns record", async () => {
    const fakeAgent = {
      agent_id: "test-agent",
      name: "Test Agent",
      capabilities: ["code"],
    };
    db.query.mockResolvedValue({ rows: [fakeAgent] });

    const result = await register({
      agentId: "test-agent",
      name: "Test Agent",
      capabilities: ["code"],
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO marketplace_agents"),
      expect.arrayContaining(["test-agent", "Test Agent"])
    );
    expect(result.agent_id).toBe("test-agent");
  });
});

describe("subscriptions.subscribe", () => {
  it("creates subscription with commitment hash", async () => {
    const fakeSub = {
      subscriber_address: "0xabc",
      agent_id: "agent-1",
      commitment_hash: "abc123",
    };
    db.query.mockResolvedValue({ rows: [fakeSub] });

    const result = await subscribe("0xabc", "agent-1", { capabilities: ["code"] });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO agent_subscriptions"),
      expect.arrayContaining(["0xabc", "agent-1"])
    );
    expect(result.subscriber_address).toBe("0xabc");
  });
});

describe("discovery.routeTask", () => {
  it("returns default agent when no subscriptions match", async () => {
    db.query.mockResolvedValue({ rows: [] }); // no subscribed agents

    const route = await routeTask("What is the capital of France?", "0xwallet");
    expect(route.agentId).toBe(DEFAULT_AGENT.agent_id);
    expect(route.isDefault).toBe(true);
  });

  it("routes to specialist agent when subscription exists", async () => {
    db.query.mockResolvedValueOnce({
      rows: [{
        agent_id: "code-specialist",
        name: "Code Agent",
        endpoint_url: "http://code-agent:8080",
        reputation_score: 95,
      }],
    });

    const route = await routeTask("Write a Python function to sort a list", "0xwallet");
    expect(route.agentId).toBe("code-specialist");
    expect(route.isDefault).toBe(false);
  });

  it("falls back to default on DB error", async () => {
    db.query.mockRejectedValue(new Error("DB down"));

    const route = await routeTask("Search the web for AI news", "0xwallet");
    expect(route.agentId).toBe(DEFAULT_AGENT.agent_id);
    expect(route.isDefault).toBe(true);
  });
});
