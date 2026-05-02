const tee = require("../../src/tee/simulator");

describe("TEE simulator", () => {
  it("creates a context with the invocation ID", () => {
    const ctx = tee.createContext("inv-123");
    expect(ctx.invocationId).toBe("inv-123");
    expect(ctx.destroyed).toBe(false);
    expect(ctx.id).toBeDefined();
  });

  it("runs a function and returns its result", async () => {
    const ctx = tee.createContext("inv-run");
    const result = await tee.run(ctx, async () => ({ result: "ok", usage: {} }));
    expect(result).toEqual({ result: "ok", usage: {} });
    tee.destroyContext(ctx);
  });

  it("rejects on timeout", async () => {
    process.env.TEE_TIMEOUT_MS = "50";
    const ctx = tee.createContext("inv-timeout");
    await expect(
      tee.run(ctx, () => new Promise((r) => setTimeout(r, 200)))
    ).rejects.toThrow("timed out");
    tee.destroyContext(ctx);
    delete process.env.TEE_TIMEOUT_MS;
  });

  it("destroys context and prevents re-use", async () => {
    const ctx = tee.createContext("inv-destroy");
    tee.destroyContext(ctx);
    expect(ctx.destroyed).toBe(true);
    await expect(tee.run(ctx, async () => {})).rejects.toThrow("destroyed");
  });

  it("generates an attestation report", () => {
    const ctx = tee.createContext("inv-attest");
    const report = tee.attest(ctx);
    expect(report.teeType).toBe("gramine-simulated");
    expect(report.invocationId).toBe("inv-attest");
  });
});
