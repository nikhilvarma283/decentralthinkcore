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
 *   - Aggregates results and returns them to the user
 *   - Wipes all memory and revokes all sub-keys on termination
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

class Cortex {
  /**
   * Run a task end-to-end inside an ephemeral session:
   *   decompose → execute steps in TEE → aggregate → persist → wipe
   */
  async run(invocationId, task, options = {}) {
    const {
      sessionId,
      agentId = "cortex-default",
      walletAddress = "anonymous",
      model,
      maxSteps = 5,
    } = options;

    logger.info("Cortex: session starting", { invocationId, agentId, walletAddress });

    // Record a Cortex session in the DB for lifecycle tracking
    const cortexSessionId = uuidv4();
    await this._createCortexSession(cortexSessionId, invocationId, sessionId, walletAddress);

    await this._updateStatus(invocationId, "running");

    // Log session start to blockchain audit trail
    await auditLogger.logEvent("cortex.start", {
      invocationId,
      cortexSessionId,
      data: { invocationId, agentId, walletAddress, startedAt: new Date().toISOString() },
      payload: { agentId, walletAddress },
    });

    // Instantiate a TEE context for this session
    const teeCtx = tee.createContext(invocationId);
    const teeAttestation = tee.attest(teeCtx).attestation;

    try {
      // Decompose complex tasks into ordered steps
      const steps = await decomposer.decompose(task, { maxSteps });

      logger.info("Cortex: task decomposed", {
        invocationId,
        stepCount: steps.length,
      });

      // Execute each step inside the TEE
      let aggregatedResult = "";
      let totalUsage = { input_tokens: 0, output_tokens: 0 };

      for (const [i, step] of steps.entries()) {
        logger.info(`Cortex: executing step ${i + 1}/${steps.length}`, {
          invocationId,
          step: step.slice(0, 80),
        });

        // Query marketplace for the best agent for this step
        const route = await discovery.routeTask(step, walletAddress);
        const resolvedAgentId = route.agentId;

        if (!route.isDefault) {
          logger.info("Cortex: marketplace routing to specialist", {
            invocationId, agentId: resolvedAgentId, step: step.slice(0, 60),
          });
        }

        const { result, usage } = await tee.run(teeCtx, () =>
          executor.execute(step, {
            context: aggregatedResult,
            agentId: resolvedAgentId,
            endpointUrl: route.endpointUrl,
          })
        );

        aggregatedResult = aggregatedResult
          ? `${aggregatedResult}\n\n${result}`
          : result;

        totalUsage.input_tokens += usage.input_tokens;
        totalUsage.output_tokens += usage.output_tokens;

        // Audit each agent execution
        await auditLogger.logEvent("agent.execute", {
          invocationId,
          cortexSessionId,
          data: { step, resultLength: result.length, usage },
          teeAttestation,
          payload: { stepIndex: i, agentId: resolvedAgentId, isDefault: route.isDefault, tokens: usage },
        });
      }

      // Record infrastructure cost
      const cost = await costTracker.record({
        invocationId,
        walletAddress,
        model: model || process.env.HERMES_MODEL || "nous-hermes2",
        usage: totalUsage,
      });

      // Persist completed result
      await this._complete(invocationId, aggregatedResult, cost);

      // Audit session completion
      await auditLogger.logEvent("cortex.complete", {
        invocationId,
        cortexSessionId,
        data: { invocationId, totalTokens: totalUsage, costCredits: cost.credits },
        teeAttestation,
        payload: { costCredits: cost.credits, tokens: totalUsage },
      });

      await this._terminateCortexSession(cortexSessionId, "completed");

      logger.info("Cortex: session completed", {
        invocationId,
        costCredits: cost.credits,
        tokens: totalUsage,
      });

      return { result: aggregatedResult, cost, usage: totalUsage };
    } catch (err) {
      logger.error("Cortex: session failed", {
        invocationId,
        error: err.message,
      });

      await auditLogger.logEvent("cortex.fail", {
        invocationId,
        cortexSessionId,
        data: { invocationId, error: err.message },
        payload: { error: err.message },
      });

      await this._terminateCortexSession(cortexSessionId, "error");
      await this._fail(invocationId, err.message);
      throw err;
    } finally {
      // CRITICAL: destroy TEE context — wipes all in-memory state for this session
      tee.destroyContext(teeCtx);
      logger.info("Cortex: TEE context destroyed, session memory wiped", { invocationId });
    }
  }

  async _createCortexSession(cortexSessionId, invocationId, authSessionId, walletAddress) {
    try {
      await db.query(
        `INSERT INTO cortex_sessions (id, auth_session_id, wallet_address)
         VALUES ($1, $2, $3)`,
        [cortexSessionId, authSessionId, walletAddress]
      );
      // Back-link invocation to this cortex session
      await db.query(
        `UPDATE invocations SET cortex_session_id = $1 WHERE id = $2`,
        [cortexSessionId, invocationId]
      );
    } catch (err) {
      logger.warn("Cortex: failed to persist session record", { error: err.message });
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
