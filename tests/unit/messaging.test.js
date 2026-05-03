const request = require("supertest");
const crypto = require("crypto");

jest.mock("../../src/lib/db");
jest.mock("../../src/blockchain/auditLogger");

const WALLET = "0xALICE";
const OTHER = "0xBOB";
const DEPLOY_ID = "deploy-uuid-1";

jest.mock("../../src/middleware/auth", () => ({
  requireAuth: (req, _res, next) => { req.walletAddress = WALLET; next(); },
  optionalAuth: (req, _res, next) => { req.walletAddress = WALLET; next(); },
}));

const app = require("../../src/app");
const db = require("../../src/lib/db");
const auditLogger = require("../../src/blockchain/auditLogger");

auditLogger.logEvent.mockResolvedValue({ blockchainTxid: null });

// Helper: mock deployment exists
const mockDeployment = (ownerAddress = OTHER) =>
  db.query.mockResolvedValueOnce({ rows: [{ id: DEPLOY_ID, owner_address: ownerAddress }] });

// Helper: mock member exists
const mockMember = (walletAddress = WALLET, role = "member") =>
  db.query.mockResolvedValueOnce({
    rows: [{ wallet_address: walletAddress, role, deployment_id: DEPLOY_ID, owner_address: OTHER }],
  });

// Helper: mock no member
const mockNoMember = () => db.query.mockResolvedValueOnce({ rows: [] });

describe("Messaging API — Membership", () => {
  describe("POST /api/v1/messaging/deployments/:id/members", () => {
    it("joins as member when not the owner", async () => {
      mockDeployment(OTHER); // owner is OTHER, not WALLET
      db.query.mockResolvedValueOnce({ rows: [{ id: "m1", wallet_address: WALLET, role: "member" }] });

      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/members`)
        .send({ public_key: "base64pubkey==" });

      expect(res.status).toBe(201);
      expect(res.body.wallet_address).toBe(WALLET);
    });

    it("joins as owner when wallet is deployment owner", async () => {
      mockDeployment(WALLET); // WALLET is the owner
      db.query.mockResolvedValueOnce({ rows: [{ id: "m2", wallet_address: WALLET, role: "owner" }] });

      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/members`)
        .send({});

      expect(res.status).toBe(201);
    });

    it("returns 404 when deployment not found", async () => {
      db.query.mockResolvedValueOnce({ rows: [] }); // no deployment

      const res = await request(app)
        .post(`/api/v1/messaging/deployments/bad-id/members`)
        .send({});

      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/messaging/deployments/:id/members", () => {
    it("returns member list to members", async () => {
      mockMember();
      db.query.mockResolvedValueOnce({
        rows: [
          { wallet_address: WALLET, role: "member" },
          { wallet_address: OTHER, role: "owner" },
        ],
      });

      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/members`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
    });

    it("returns 403 to non-members", async () => {
      mockNoMember();
      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/members`);
      expect(res.status).toBe(403);
    });
  });

  describe("DELETE /api/v1/messaging/deployments/:id/members/:address", () => {
    it("allows member to remove themselves", async () => {
      mockMember(WALLET, "member");
      db.query.mockResolvedValueOnce({ rows: [{ wallet_address: WALLET }] });

      const res = await request(app)
        .delete(`/api/v1/messaging/deployments/${DEPLOY_ID}/members/${WALLET}`);
      expect(res.status).toBe(200);
      expect(res.body.removed).toBe(WALLET);
    });

    it("rejects non-admin removing another user", async () => {
      mockMember(WALLET, "member"); // WALLET is just a member, not admin
      const res = await request(app)
        .delete(`/api/v1/messaging/deployments/${DEPLOY_ID}/members/${OTHER}`);
      expect(res.status).toBe(403);
    });

    it("allows admin to remove another member", async () => {
      mockMember(WALLET, "admin");
      db.query.mockResolvedValueOnce({ rows: [{ wallet_address: OTHER }] });

      const res = await request(app)
        .delete(`/api/v1/messaging/deployments/${DEPLOY_ID}/members/${OTHER}`);
      expect(res.status).toBe(200);
    });
  });
});

describe("Messaging API — Secure Messages", () => {
  const validPayload = {
    recipient_address: OTHER,
    ciphertext: Buffer.from("encrypted-blob").toString("base64"),
    iv: Buffer.from("123456789012").toString("base64"),
    content_hash: crypto.createHash("sha256").update("hello").digest("hex"),
  };

  describe("POST /api/v1/messaging/deployments/:id/messages", () => {
    it("sends an encrypted message", async () => {
      mockMember(WALLET, "member");                 // sender check
      mockMember(OTHER, "member");                  // recipient check
      db.query.mockResolvedValueOnce({
        rows: [{ id: "msg-1", sender_address: WALLET, recipient_address: OTHER,
                 content_hash: validPayload.content_hash, sent_at: new Date() }],
      });

      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`)
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.sender_address).toBe(WALLET);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        "messaging.message.send", expect.any(Object)
      );
    });

    it("rejects missing ciphertext", async () => {
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`)
        .send({ recipient_address: OTHER, iv: "abc", content_hash: "def" });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/ciphertext/);
    });

    it("returns 403 when sender is not a member", async () => {
      mockNoMember(); // sender not found
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`)
        .send(validPayload);
      expect(res.status).toBe(403);
    });

    it("returns 404 when recipient is not a member", async () => {
      mockMember(WALLET, "member"); // sender ok
      mockNoMember();               // recipient not found
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`)
        .send(validPayload);
      expect(res.status).toBe(404);
    });
  });

  describe("GET /api/v1/messaging/deployments/:id/messages", () => {
    it("returns inbox for a member", async () => {
      mockMember();
      db.query.mockResolvedValueOnce({
        rows: [{ id: "m1", sender_address: OTHER, ciphertext: "abc", sent_at: new Date() }],
      });
      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it("returns 403 to non-members", async () => {
      mockNoMember();
      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages`);
      expect(res.status).toBe(403);
    });
  });

  describe("PATCH /api/v1/messaging/deployments/:id/messages/:msgId/read", () => {
    it("marks a message as read", async () => {
      db.query.mockResolvedValueOnce({ rows: [{ id: "msg-1", read_at: new Date() }] });
      const res = await request(app)
        .patch(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages/msg-1/read`);
      expect(res.status).toBe(200);
      expect(res.body.read_at).toBeTruthy();
    });

    it("returns 404 when message not found or not recipient", async () => {
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .patch(`/api/v1/messaging/deployments/${DEPLOY_ID}/messages/ghost/read`);
      expect(res.status).toBe(404);
    });
  });
});

describe("Messaging API — Context Sharing", () => {
  const validContext = {
    context_type: "scores",
    context_data: { relevance: 0.87, confidence: 0.92, sentiment: 0.65 },
  };

  describe("POST /api/v1/messaging/deployments/:id/context", () => {
    it("shares abstract context scores", async () => {
      mockMember();
      db.query.mockResolvedValueOnce({
        rows: [{ id: "ctx-1", context_type: "scores", data_hash: "abc123", shared_at: new Date() }],
      });

      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`)
        .send(validContext);

      expect(res.status).toBe(201);
      expect(auditLogger.logEvent).toHaveBeenCalledWith(
        "messaging.context.share", expect.any(Object)
      );
    });

    it("rejects invalid context_type", async () => {
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`)
        .send({ context_type: "raw_text", context_data: { a: 1 } });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/context_type/);
    });

    it("rejects raw text content in context_data (patent invariant)", async () => {
      mockMember();
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`)
        .send({
          context_type: "scores",
          context_data: { raw: "This is a long raw text string that exceeds 64 characters and should be rejected by the API" },
        });
      expect(res.status).toBe(400);
      expect(res.body.error).toMatch(/abstract scores/);
    });

    it("rejects non-object context_data", async () => {
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`)
        .send({ context_type: "scores", context_data: [1, 2, 3] });
      expect(res.status).toBe(400);
    });

    it("returns 403 to non-members", async () => {
      mockNoMember();
      const res = await request(app)
        .post(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`)
        .send(validContext);
      expect(res.status).toBe(403);
    });
  });

  describe("GET /api/v1/messaging/deployments/:id/context", () => {
    it("returns context shared with the caller", async () => {
      mockMember();
      db.query.mockResolvedValueOnce({
        rows: [{ id: "ctx-1", context_type: "scores", context_data: { score: 0.9 } }],
      });
      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`);
      expect(res.status).toBe(200);
      expect(res.body.count).toBe(1);
    });

    it("filters by context_type when provided", async () => {
      mockMember();
      db.query.mockResolvedValueOnce({ rows: [] });
      const res = await request(app)
        .get(`/api/v1/messaging/deployments/${DEPLOY_ID}/context?context_type=embedding`);
      expect(res.status).toBe(200);
    });

    it("returns 403 to non-members", async () => {
      mockNoMember();
      const res = await request(app).get(`/api/v1/messaging/deployments/${DEPLOY_ID}/context`);
      expect(res.status).toBe(403);
    });
  });
});
