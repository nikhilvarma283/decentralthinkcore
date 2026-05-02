const { v4: uuidv4 } = require("uuid");
const db = require("../lib/db");
const logger = require("../lib/logger");
const decomposer = require("./decomposer");
const executor = require("./executor");
const costTracker = require("../payments/costTracker");
const tee = require("../tee/simulator");

class HermesOrchestrator {
  /**
   * Run a task end-to-end:
   *   decompose → execute steps → aggregate → persist
   */
  async run(invocationId, task, options = {}) {
    const { sessionId, agentId = "hermes-default", maxSteps = 5 } = options;

    logger.info("Hermes: starting task", { invocationId, agentId });

    await this._updateStatus(invocationId, "running");

    const teeCtx = tee.createContext(invocationId);

    try {
      // Decompose complex tasks into steps; simple tasks run as-is
      const steps = await decomposer.decompose(task, { maxSteps });

      logger.info("Hermes: decomposed task", {
        invocationId,
        stepCount: steps.length,
      });

      // Execute each step inside the TEE context
      let aggregatedResult = "";
      let totalUsage = { input_tokens: 0, output_tokens: 0 };

      for (const [i, step] of steps.entries()) {
        logger.info(`Hermes: executing step ${i + 1}/${steps.length}`, {
          invocationId,
          step: step.slice(0, 80),
        });

        const { result, usage } = await tee.run(teeCtx, () =>
          executor.execute(step, {
            context: aggregatedResult,
            agentId,
          })
        );

        aggregatedResult = aggregatedResult
          ? `${aggregatedResult}\n\n${result}`
          : result;

        totalUsage.input_tokens += usage.input_tokens;
        totalUsage.output_tokens += usage.output_tokens;
      }

      // Record costs
      const cost = await costTracker.record({
        invocationId,
        walletAddress: options.walletAddress || "anonymous",
        model: options.model || process.env.DEFAULT_MODEL,
        usage: totalUsage,
      });

      // Persist completed invocation
      await this._complete(invocationId, aggregatedResult, cost);

      logger.info("Hermes: task completed", {
        invocationId,
        costCredits: cost.credits,
        tokens: totalUsage,
      });

      return { result: aggregatedResult, cost, usage: totalUsage };
    } catch (err) {
      logger.error("Hermes: task failed", {
        invocationId,
        error: err.message,
      });
      await this._fail(invocationId, err.message);
      throw err;
    } finally {
      tee.destroyContext(teeCtx);
    }
  }

  async _updateStatus(invocationId, status) {
    await db.query(
      "UPDATE invocations SET status = $1 WHERE id = $2",
      [status, invocationId]
    );
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

module.exports = new HermesOrchestrator();
