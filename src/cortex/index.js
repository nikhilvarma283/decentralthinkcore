/**
 * Cortex — Ephemeral Orchestration Agent (per patent Component 3).
 *
 * Cortex is born at the start of a user session inside a TEE and completely
 * destroyed at session end. It:
 *   - Decomposes user tasks into subtasks
 *   - Queries the ZK Marketplace for capable agents
 *   - Provisions task-scoped sub-keys to agents inside their TEEs
 *   - Enforces data minimization and privacy policies
 *   - Manages an ephemeral wallet with user-defined spending limit
 *   - Pays external agents via x402 (HTTP 402) from the ephemeral wallet
 *   - Aggregates results and returns them to the user
 *   - Wipes all memory, zeroes wallet keys, revokes all sub-keys on termination
 *
 * Hermes (Nous Research LLM via Ollama) is the intelligence engine that
 * powers Cortex's reasoning. Cortex is the orchestration wrapper;
 * Hermes is the model running inside it.
 */

const { v4: uuidv4 } = require("uuid");
const db = require("../lib/db");
const logger = require("../lib/logger");
const decomposer = require("./decomposer");
const executor = require("./executor");
const costTracker = require("../payments/costTracker");
const tee = require("../tee/simulator");
const auditLogger = require("../blockchain/auditLogger");
const discovery = require("../marketplace/discovery");
const walletLib = require("../payments/wallet");

// Default spending limit: 10,000 microALGO (0.01 ALGO) per session
const DEFAULT_SPENDING_LIMIT = parseInt(
  process.env.DEFAULT_SPENDING_LIMIT_MICROALGO || "10000"
);

class Cortex {
  /**
   * Run a task end-to-end inside an ephemeral session:
   *   decompose → route → execute (via TEE + x402) → aggregate → persist → wipe
   */
  async run(invocationId, task, options = {}) {
    const {
      sessionId,
      agentId = "cortex-default",
      walletAddress = "anonymous",
      model,
      maxSteps = 5,
      spendingLimitMicroAlgo = DEFAULT_SPENDING_LIMIT,
    } = options;

    logger.info("Cortex: session starting", { invocationId, agentId, walletAddress });

    // ── 1. Create ephemeral Cortex wallet inside TEE ───────────────────────
    const ephemeralWallet = walletLib.createEphemeralWallet(spendingLimitMicroAlgo);
    await walletLib.fundFromMaster(ephemeralWallet.address, spendingLimitMicroAlgo, null);

    // ── 2. Record Cortex session in DB ────────────────────────────────────
    const cortexSessionId = uuidv4();
    await this._createCortexSession(
      cortexSessionId, invocationId, sessionId, walletAddress,
      ephemeralWallet.address, spendingLimitMicroAlgo
    );

    await this._updateStatus(invocationId, "running");

    // ── 3. Audit session start on Algorand ────────────────────────────────
    await auditLogger.logEvent("cortex.start", {
      invocationId,
      cortexSessionId,
      data: { invocationId, agentId, walletAddress, startedAt: new Date().toISOString() },
      payload: { agentId, walletAddress, ephemeralWallet: ephemeralWallet.address },
    });

    // ── 4. Instantiate TEE context ────────────────────────────────────────
    const teeCtx = tee.createContext(invocationId);
    const teeAttestation = tee.attest(teeCtx).attestation;

    try {
      // ── 5. Decompose task ──────────────────────────────────────────────
      const steps = await decomposer.decompose(task, { maxSteps });
      logger.info("Cortex: task decomposed", { invocationId, stepCount: steps.length });

      // ── 6. Execute steps (route → TEE → x402 if external) ─────────────
      let aggregatedResult = "";
      let totalUsage = { input_tokens: 0, output_tokens: 0 };
      let totalSpent = 0;

      for (const [i, step] of steps.entries()) {
        logger.info(`Cortex: executing step ${i + 1}/${steps.length}`, {
          invocationId,
          step: step.slice(0, 80),
        });

        // Marketplace routing: find best subscribed specialist agent
        const route = await discovery.routeTask(step, walletAddress);
        if (!route.isDefault) {
          logger.info("Cortex: marketplace routing to specialist", {
            invocationId, agentId: route.agentId,
          });
        }

        const { result, usage, paymentReceipt } = await tee.run(teeCtx, () =>
          executor.execute(step, {
            context: aggregatedResult,
            agentId: route.agentId,
            endpointUrl: route.endpointUrl,
            wallet: ephemeralWallet,
          })
        );

        aggregatedResult = aggregatedResult
          ? `${aggregatedResult}\n\n${result}`
          : result;

        totalUsage.input_tokens += usage.input_tokens;
        totalUsage.output_tokens += usage.output_tokens;
        if (paymentReceipt) totalSpent += paymentReceipt.amountMicroAlgo || 0;

        await auditLogger.logEvent("agent.execute", {
          invocationId,
          cortexSessionId,
          data: { step, resultLength: result.length, usage },
          teeAttestation,
          payload: {
            stepIndex: i,
            agentId: route.agentId,
            isDefault: route.isDefault,
            tokens: usage,
            paymentTxId: paymentReceipt?.txId || null,
          },
        });
      }

      // ── 7. Update cortex_sessions.spent ───────────────────────────────
      await this._updateSpent(cortexSessionId, ephemeralWallet.spent);

      // ── 8. Record infra cost ───────────────────────────────────────────
      const cost = await costTracker.record({
        invocationId,
        cortexSessionId,
        walletAddress,
        model: model || process.env.HERMES_MODEL || "nous-hermes2",
        usage: totalUsage,
      });

      await this._complete(invocationId, aggregatedResult, cost);

      await auditLogger.logEvent("cortex.complete", {
        invocationId,
        cortexSessionId,
        data: { invocationId, totalTokens: totalUsage, costCredits: cost.credits, spent: ephemeralWallet.spent },
        teeAttestation,
        payload: { costCredits: cost.credits, tokens: totalUsage, microAlgoSpent: ephemeralWallet.spent },
      });

      await this._terminateCortexSession(cortexSessionId, "completed");

      logger.info("Cortex: session completed", {
        invocationId,
        costCredits: cost.credits,
        microAlgoSpent: ephemeralWallet.spent,
        tokens: totalUsage,
      });

      return { result: aggregatedResult, cost, usage: totalUsage, spent: ephemeralWallet.spent };

    } catch (err) {
      logger.error("Cortex: session failed", { invocationId, error: err.message });

      await auditLogger.logEvent("cortex.fail", {
        invocationId,
        cortexSessionId,
        data: { invocationId, error: err.message },
        payload: { error: err.message },
      });

      await this._updateSpent(cortexSessionId, ephemeralWallet.spent);
      await this._terminateCortexSession(cortexSessionId, "error");
      await this._fail(invocationId, err.message);
      throw err;

    } finally {
      // ── CRITICAL: destroy TEE context and zero wallet key ──────────────
      tee.destroyContext(teeCtx);
      walletLib.destroyWallet(ephemeralWallet);
      logger.info("Cortex: TEE destroyed + wallet key zeroed — session fully wiped", { invocationId });
    }
  }

  async _createCortexSession(cortexSessionId, invocationId, authSessionId, walletAddress, ephemeralWalletAddr, spendingLimit) {
    try {
      await db.query(
        `INSERT INTO cortex_sessions
           (id, auth_session_id, wallet_address, tee_context_id, spending_limit)
         VALUES ($1, $2, $3, $4, $5)`,
        [cortexSessionId, authSessionId, walletAddress, ephemeralWalletAddr,
         spendingLimit / 1_000_000]  // store as ALGO, not microALGO
      );
      await db.query(
        `UPDATE invocations SET cortex_session_id = $1 WHERE id = $2`,
        [cortexSessionId, invocationId]
      );
    } catch (err) {
      logger.warn("Cortex: failed to persist session record", { error: err.message });
    }
  }

  async _updateSpent(cortexSessionId, spentMicroAlgo) {
    try {
      await db.query(
        `UPDATE cortex_sessions SET spent = $1 WHERE id = $2`,
        [spentMicroAlgo / 1_000_000, cortexSessionId]
      );
    } catch (err) {
      logger.warn("Cortex: failed to update spent amount", { error: err.message });
    }
  }

  async _terminateCortexSession(cortexSessionId, reason) {
    try {
      await db.query(
        `UPDATE cortex_sessions
           SET terminated_at = now(), memory_wiped = true, termination_reason = $1
         WHERE id = $2`,
        [reason, cortexSessionId]
      );
    } catch (err) {
      logger.warn("Cortex: failed to update session termination", { error: err.message });
    }
  }

  async _updateStatus(invocationId, status) {
    await db.query("UPDATE invocations SET status = $1 WHERE id = $2", [status, invocationId]);
  }

  async _complete(invocationId, result, cost) {
    await db.query(
      `UPDATE invocations
         SET status = 'completed', result = $1, cost_credits = $2, completed_at = now()
       WHERE id = $3`,
      [result, cost.credits, invocationId]
    );
  }

  async _fail(invocationId, error) {
    await db.query(
      `UPDATE invocations
         SET status = 'failed', error = $1, completed_at = now()
       WHERE id = $2`,
      [error, invocationId]
    );
  }
}

module.exports = new Cortex();
