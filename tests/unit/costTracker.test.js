jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [] }),
}));

const { computeCost, record } = require("../../src/payments/costTracker");
const db = require("../../src/lib/db");

describe("computeCost", () => {
  it("calculates correct USD for sonnet", () => {
    const cost = computeCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 1_000_000,
    });
    expect(cost.usd).toBeCloseTo(18.0, 4); // 3 + 15
  });

  it("uses default pricing for unknown model", () => {
    const cost = computeCost("unknown-model", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(cost.usd).toBeCloseTo(3.0, 4);
  });

  it("converts USD to credits at configured rate", () => {
    process.env.CREDITS_PER_USD = "100";
    const cost = computeCost("claude-sonnet-4-6", {
      input_tokens: 1_000_000,
      output_tokens: 0,
    });
    expect(cost.credits).toBeCloseTo(300, 2); // 3 USD * 100
  });
});

describe("record", () => {
  it("inserts a row and returns cost", async () => {
    const cost = await record({
      invocationId: "test-id",
      walletAddress: "0xabc",
      model: "claude-sonnet-4-6",
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    expect(db.query).toHaveBeenCalledTimes(1);
    expect(cost.usd).toBeDefined();
    expect(cost.credits).toBeDefined();
  });

  it("does not throw when DB insert fails", async () => {
    db.query.mockRejectedValueOnce(new Error("DB down"));
    await expect(
      record({
        invocationId: "test-id",
        walletAddress: "0xabc",
        model: "claude-sonnet-4-6",
        usage: { input_tokens: 10, output_tokens: 5 },
      })
    ).resolves.toBeDefined();
  });
});
