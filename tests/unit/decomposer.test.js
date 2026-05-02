// Shared mock so the decomposer module and test reference the same fn
const mockCreate = jest.fn();

jest.mock("@anthropic-ai/sdk", () =>
  jest.fn().mockImplementation(() => ({ messages: { create: mockCreate } }))
);

const { decompose } = require("../../src/orchestrator/decomposer");

describe("decomposer", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns single step for short tasks without calling Claude", async () => {
    const task = "What is 2+2?";
    const steps = await decompose(task);
    expect(steps).toEqual([task]);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it("returns Claude-decomposed steps for long tasks", async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '["Step 1","Step 2","Step 3"]' }],
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe("Step 1");
  });

  it("falls back to single step when Claude returns invalid JSON", async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: "not valid json at all" }],
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask);
    expect(steps).toEqual([longTask]);
  });

  it("respects maxSteps cap", async () => {
    mockCreate.mockResolvedValue({
      content: [{ text: '["1","2","3","4","5","6","7"]' }],
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask, { maxSteps: 3 });
    expect(steps).toHaveLength(3);
  });
});
