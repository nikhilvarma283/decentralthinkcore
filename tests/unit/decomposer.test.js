// Mock the Ollama LLM client so tests don't need a running Ollama instance
const mockChat = jest.fn();
jest.mock("../../src/lib/llm", () => ({ chat: mockChat }));

const { decompose } = require("../../src/cortex/decomposer");

describe("decomposer", () => {
  beforeEach(() => {
    mockChat.mockReset();
  });

  it("returns single step for short tasks without calling Hermes", async () => {
    const task = "What is 2+2?";
    const steps = await decompose(task);
    expect(steps).toEqual([task]);
    expect(mockChat).not.toHaveBeenCalled();
  });

  it("returns Hermes-decomposed steps for long tasks", async () => {
    mockChat.mockResolvedValue({
      content: '["Step 1","Step 2","Step 3"]',
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask);
    expect(steps).toHaveLength(3);
    expect(steps[0]).toBe("Step 1");
  });

  it("falls back to single step when Hermes returns invalid JSON", async () => {
    mockChat.mockResolvedValue({
      content: "not valid json at all",
      usage: { input_tokens: 50, output_tokens: 10 },
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask);
    expect(steps).toEqual([longTask]);
  });

  it("respects maxSteps cap", async () => {
    mockChat.mockResolvedValue({
      content: '["1","2","3","4","5","6","7"]',
      usage: { input_tokens: 50, output_tokens: 20 },
    });

    const longTask = "A".repeat(130);
    const steps = await decompose(longTask, { maxSteps: 3 });
    expect(steps).toHaveLength(3);
  });
});
