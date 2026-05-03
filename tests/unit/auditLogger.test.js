jest.mock("../../src/lib/db", () => ({
  query: jest.fn().mockResolvedValue({ rows: [], rowCount: 0 }),
}));

const mockSubmit = jest.fn();
jest.mock("../../src/blockchain/algorand", () => ({
  submitAuditRecord: mockSubmit,
  hashData: jest.requireActual("../../src/blockchain/algorand").hashData,
  NETWORK: "testnet",
}));

const { logEvent } = require("../../src/blockchain/auditLogger");
const db = require("../../src/lib/db");

describe("auditLogger.logEvent", () => {
  beforeEach(() => {
    mockSubmit.mockResolvedValue("FAKE_TX_ID_123");
    db.query.mockResolvedValue({ rows: [], rowCount: 0 });
  });

  it("calls submitAuditRecord with event and a data hash", async () => {
    await logEvent("cortex.start", {
      invocationId: "inv-1",
      cortexSessionId: "ctx-1",
      data: { invocationId: "inv-1" },
    });

    expect(mockSubmit).toHaveBeenCalledTimes(1);
    const [event, dataHash] = mockSubmit.mock.calls[0];
    expect(event).toBe("cortex.start");
    expect(dataHash).toMatch(/^[0-9a-f]{64}$/); // SHA-256 hex
  });

  it("inserts an audit_log row with blockchain_txid", async () => {
    const result = await logEvent("agent.execute", {
      invocationId: "inv-2",
      cortexSessionId: "ctx-2",
      data: { step: "do something" },
      payload: { stepIndex: 0 },
    });

    expect(db.query).toHaveBeenCalledWith(
      expect.stringContaining("INSERT INTO audit_log"),
      expect.arrayContaining(["inv-2", "ctx-2", "agent.execute"])
    );
    expect(result.blockchainTxid).toBe("FAKE_TX_ID_123");
  });

  it("does not throw when Algorand submission fails", async () => {
    mockSubmit.mockRejectedValueOnce(new Error("Algorand unavailable"));

    await expect(
      logEvent("cortex.fail", { invocationId: "inv-3", data: { error: "oops" } })
    ).resolves.not.toThrow();

    // DB insert still happens even if blockchain fails
    expect(db.query).toHaveBeenCalled();
  });

  it("does not throw when DB insert fails", async () => {
    db.query.mockRejectedValueOnce(new Error("DB down"));

    await expect(
      logEvent("cortex.start", { invocationId: "inv-4" })
    ).resolves.not.toThrow();
  });

  it("records null blockchainTxid when Algorand returns null", async () => {
    mockSubmit.mockResolvedValueOnce(null);

    const result = await logEvent("vault.access", {
      invocationId: "inv-5",
      data: { keyName: "api-key" },
    });

    expect(result.blockchainTxid).toBeNull();
  });
});
