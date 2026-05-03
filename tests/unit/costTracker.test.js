jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const { computeCost, record } = require("../../src/payments/costTracker");
const db = require("../../src/lib/db");

describe("computeCost", () => {
  it("calculates infrastructure cost from token count", () => {
    process.env.INFRA_COST_PER_1K_TOKENS = "0.0003";
    process.env.CREDITS_PER_USD = "100";
    const cost = computeCost("nous-hermes2", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    // 2M tokens * $0.0003/1K = $0.60 * 100 = 60 credits
    expect(cost.usd).toBeCloseTo(0.6, 4);
    expect(cost.credits).toBeCloseTo(60, 2);
    expect(cost.tokens).toBe(2_000_000);
  });

  it("model name does not affect pricing — infra cost is model-agnostic", () => {
    process.env.INFRA_COST_PER_1K_TOKENS = "0.0003";
    const costA = computeCost("nous-hermes2", { input_tokens: 1000, output_tokens: 0 });
    const costB = computeCost("any-other-model", { input_tokens: 1000, output_tokens: 0 });
    expect(costA.usd).toBe(costB.usd);
  });

  it("converts USD to credits at configured rate", () => {
    process.env.INFRA_COST_PER_1K_TOKENS = "0.001";
    process.env.CREDITS_PER_USD = "200";
    const cost = computeCost("nous-hermes2", {
      input_tokens: 1000,
      output_tokens: 0,
    });
    // 1K tokens * $0.001/1K = $0.001 * 200 = 0.2 credits
    expect(cost.credits).toBeCloseTo(0.2, 4);
  });

  it("returns zero cost for zero tokens", () => {
    const cost = computeCost("nous-hermes2", { input_tokens: 0, output_tokens: 0 });
    expect(cost.usd).toBe(0);
    expect(cost.credits).toBe(0);
    expect(cost.tokens).toBe(0);
  });
});

describe("record", () => {
  it("inserts a row and returns cost", async () => {
    const cost = await record({
      invocationId: "test-id",
      walletAddress: "0xabc",
      model: "nous-hermes2",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(cost.usd).toBeDefined();
    expect(cost.credits).toBeDefined();
    expect(cost.tokens).toBe(150);
  });

  it("does not throw when DB insert fails", async () => {
    db.query.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      record({
        invocationId: "test-id",
        walletAddress: "0xabc",
        model: "nous-hermes2",
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    ).resolves.toBeDefined();
  });
});
