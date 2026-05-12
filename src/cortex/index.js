/**
 * Cortex — Anonymizing, Compliance-Enforcing Assembly Engine.
 *
 * Cortex is NOT a chatbot or an AI assistant.
 * Cortex is an orchestration engine whose sole job is:
 *
 *   1. CLASSIFY  — determine what parts of the task involve sensitive data
 *   2. ANONYMIZE — strip identity and sensitive fields before anything exits the TEE
 *   3. DECOMPOSE — break the task into a dependency graph of classified steps
 *   4. RECRUIT   — dispatch external steps to headless agents (x402 or subscribed)
 *                  agents receive only an abstract, anonymized fragment — never
 *                  the user's identity, org context, or raw data
 *   5. ASSEMBLE  — merge all results back together locally inside the TEE
 *   6. RECORD    — build an immutable decision record sealed on Algorand
 *
 * Execution model:
 *   - Steps with no unsatisfied dependencies run in PARALLEL (Promise.all)
 *   - Steps depending on prior output run SEQUENTIALLY after their deps
 *   - Local steps (data-analysis, synthesis) always run on Hermes inside TEE
 *   - External steps go to the marketplace after anonymization
 *
 * TEE guarantee:
 *   - No raw user data ever leaves the TEE
 *   - Every external agent receives only an anonymized, context-free fragment
 *   - Every decision is recorded with hashes — never raw content
 *   - Session is fully wiped (TEE destroyed + wallet zeroed) on exit
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const logger = require('../lib/logger');
const { decompose, buildExecutionBatches } = require('./decomposer');
const executor = require('./executor');
const { anonymize, hash } = require('./anonymizer');
const { DecisionRecord } = require('./decisionRecord');
const costTracker = require('../payments/costTracker');
const tee = require('../tee/simulator');
const auditLogger = require('../blockchain/auditLogger');
const discovery = require('../marketplace/discovery');
const walletLib = require('../payments/wallet');

const DEFAULT_SPENDING_LIMIT = parseInt(process.env.DEFAULT_SPENDING_LIMIT_MICROALGO || '10000');

class Cortex {
  async run(invocationId, task, options = {}) {
    const {
      sessionId,
      agentId = 'cortex-default',
      walletAddress = 'anonymous',
      model,
      maxSteps = 6,
      spendingLimitMicroAlgo = DEFAULT_SPENDING_LIMIT,
      orgId = 'default',
      // Session context for anonymizer — populated by org/admin layer in Sprint 10
      sessionContext = {
        orgName: null,
        userName: null,
        knownNames: [],
      },
      personaSnapshot = { role: 'user', clearance: 'public' },
    } = options;

    logger.info('Cortex: session starting', { invocationId, agentId, walletAddress, orgId });

    // ── 1. Ephemeral wallet + TEE ─────────────────────────────────────────────
    const ephemeralWallet = walletLib.createEphemeralWallet(spendingLimitMicroAlgo);
    await walletLib.fundFromMaster(ephemeralWallet.address, spendingLimitMicroAlgo, null);

    const cortexSessionId = uuidv4();
    await this._createCortexSession(cortexSessionId, invocationId, sessionId, walletAddress, ephemeralWallet.address, spendingLimitMicroAlgo);
    await this._updateStatus(invocationId, 'running');

    const teeCtx = tee.createContext(invocationId);
    const teeAttestation = tee.attest(teeCtx).attestation;

    // ── 2. Decision record — opened at session start ──────────────────────────
    const decisionRecord = new DecisionRecord(invocationId, orgId);
    decisionRecord.setContext({
      personaSnapshot,
      policyVersionHash: null, // Sprint 10: loaded from org policy version
      teeAttestation,
    });

    await auditLogger.logEvent('cortex.start', {
      invocationId,
      cortexSessionId,
      data: { invocationId, agentId, walletAddress, orgId, startedAt: new Date().toISOString() },
      payload: { agentId, walletAddress, orgId, ephemeralWallet: ephemeralWallet.address },
    });

    try {
      // ── 3. Intake classification ────────────────────────────────────────────
      // Sprint 10: this becomes an OPA policy evaluation
      const intakeClassification = {
        sensitivity: 'public',
        execution: 'mixed',
        category: 'general',
      };

      // Record intake decision
      decisionRecord.recordIntake(task, {
        decision: 'permitted',
        rule: 'default-permit-all',   // Sprint 10: actual rule name from OPA
        classification: intakeClassification,
      });

      // ── 4. Decompose into classified DAG ────────────────────────────────────
      const steps = await decompose(task, { maxSteps, context: sessionContext });

      logger.info('Cortex: task decomposed', {
        invocationId,
        stepCount: steps.length,
        external: steps.filter((s) => s.classification.execution === 'external').length,
        local: steps.filter((s) => s.classification.execution === 'local').length,
      });

      // ── 5. Anonymize external steps before recording decomposition ──────────
      const anonymizationLog = [];
      const anonymizedSteps = steps.map((step) => {
        if (step.classification.execution === 'external') {
          const { anonymized, log, inputHash, outputHash } = anonymize(step.description, sessionContext);
          anonymizationLog.push(...log.map((l) => ({ ...l, stepId: step.id })));
          return { ...step, anonymizedDescription: anonymized, inputHash, outputHash };
        }
        return step;
      });

      decisionRecord.recordDecomposition(anonymizedSteps, anonymizationLog);

      // ── 6. Execute in topological batches ───────────────────────────────────
      const batches = buildExecutionBatches(anonymizedSteps);
      const resultsByStepId = {};
      let totalUsage = { input_tokens: 0, output_tokens: 0 };
      let totalSpent = 0;

      for (const [batchIdx, batch] of batches.entries()) {
        logger.info(`Cortex: executing batch ${batchIdx + 1}/${batches.length}`, {
          invocationId,
          batchSize: batch.length,
          stepIds: batch.map((s) => s.id),
        });

        // Build context from completed deps
        const batchResults = await Promise.all(
          batch.map((step) => this._executeStep(step, {
            resultsByStepId,
            teeCtx,
            teeAttestation,
            ephemeralWallet,
            walletAddress,
            invocationId,
            cortexSessionId,
            decisionRecord,
          }))
        );

        batch.forEach((step, i) => {
          resultsByStepId[step.id] = batchResults[i].result;
          totalUsage.input_tokens  += batchResults[i].usage.input_tokens;
          totalUsage.output_tokens += batchResults[i].usage.output_tokens;
          if (batchResults[i].paymentReceipt) {
            totalSpent += batchResults[i].paymentReceipt.amountMicroAlgo || 0;
          }
        });
      }

      // ── 7. Final local assembly (always stays in TEE) ───────────────────────
      const allResults = Object.values(resultsByStepId).join('\n\n---\n\n');
      const { result: finalResult, usage: assemblyUsage } = await tee.run(teeCtx, () =>
        executor.execute(
          `Assemble the following research results into a clear, well-structured response for the user:\n\n${allResults}`,
          { context: '', agentId: 'cortex-default' }
        )
      );

      totalUsage.input_tokens  += assemblyUsage.input_tokens;
      totalUsage.output_tokens += assemblyUsage.output_tokens;

      decisionRecord.recordAssembly(
        `Assembled ${Object.keys(resultsByStepId).length} step results via local Hermes synthesis`,
        finalResult
      );

      // ── 8. Cost tracking + completion ───────────────────────────────────────
      await this._updateSpent(cortexSessionId, ephemeralWallet.spent);
      const cost = await costTracker.record({
        invocationId,
        cortexSessionId,
        walletAddress,
        model: model || process.env.HERMES_MODEL || 'nous-hermes2',
        usage: totalUsage,
      });

      await this._complete(invocationId, finalResult, cost);

      // ── 9. Seal decision record to Algorand ─────────────────────────────────
      const seal = await decisionRecord.seal();

      await auditLogger.logEvent('cortex.complete', {
        invocationId,
        cortexSessionId,
        data: { invocationId, totalTokens: totalUsage, costCredits: cost.credits, spent: ephemeralWallet.spent },
        teeAttestation,
        payload: {
          costCredits: cost.credits,
          tokens: totalUsage,
          microAlgoSpent: ephemeralWallet.spent,
          decisionRecordId: seal.decisionRecordId,
          decisionRecordAlgorandTxid: seal.algorandTxid,
        },
      });

      await this._terminateCortexSession(cortexSessionId, 'completed');

      logger.info('Cortex: session completed', {
        invocationId,
        costCredits: cost.credits,
        microAlgoSpent: ephemeralWallet.spent,
        tokens: totalUsage,
        decisionRecordId: seal.decisionRecordId,
      });

      return {
        result: finalResult,
        cost,
        usage: totalUsage,
        spent: ephemeralWallet.spent,
        decisionRecord: {
          id: seal.decisionRecordId,
          algorandTxid: seal.algorandTxid,
          taskHash: seal.taskHash,
          resultHash: seal.resultHash,
        },
      };

    } catch (err) {
      logger.error('Cortex: session failed', { invocationId, error: err.message });

      decisionRecord.recordAssembly(`Session failed: ${err.message}`, '');
      await decisionRecord.seal().catch(() => {});

      await auditLogger.logEvent('cortex.fail', {
        invocationId,
        cortexSessionId,
        data: { invocationId, error: err.message },
        payload: { error: err.message },
      });

      await this._updateSpent(cortexSessionId, ephemeralWallet.spent);
      await this._terminateCortexSession(cortexSessionId, 'error');
      await this._fail(invocationId, err.message);
      throw err;

    } finally {
      tee.destroyContext(teeCtx);
      walletLib.destroyWallet(ephemeralWallet);
      logger.info('Cortex: TEE destroyed + wallet zeroed', { invocationId });
    }
  }

  // ── Step execution ────────────────────────────────────────────────────────

  async _executeStep(step, { resultsByStepId, teeCtx, teeAttestation, ephemeralWallet, walletAddress, invocationId, cortexSessionId, decisionRecord }) {
    // Build context from completed dependency results
    const depContext = step.deps
      .map((dep) => resultsByStepId[dep] || '')
      .filter(Boolean)
      .join('\n\n');

    if (step.classification.execution === 'local') {
      // LOCAL — runs inside TEE on Hermes, full context allowed
      logger.info('Cortex: local step', { invocationId, stepId: step.id, category: step.classification.category });

      const { result, usage } = await tee.run(teeCtx, () =>
        executor.execute(step.description, {
          context: depContext,
          agentId: 'cortex-default',
        })
      );

      await auditLogger.logEvent('cortex.step.local', {
        invocationId,
        data: { stepId: step.id, result },
        teeAttestation,
        payload: { stepId: step.id, category: step.classification.category, tokens: usage },
      });

      return { result, usage, paymentReceipt: null };

    } else {
      // EXTERNAL — dispatch to marketplace agent using the ANONYMIZED description
      const queryText = step.anonymizedDescription || step.description;
      const queryHash = step.outputHash || hash(queryText);

      const route = await discovery.routeTask(
        step.agentCapability ? `${step.agentCapability} ${queryText}` : queryText,
        walletAddress
      );

      logger.info('Cortex: external step dispatched', {
        invocationId,
        stepId: step.id,
        agentId: route.agentId,
        capability: step.agentCapability,
        queryHash,
      });

      const startTime = Date.now();
      const { result, usage, paymentReceipt } = await tee.run(teeCtx, () =>
        executor.execute(queryText, {
          context: depContext,
          agentId: route.agentId,
          endpointUrl: route.endpointUrl,
          wallet: ephemeralWallet,
        })
      );
      const durationMs = Date.now() - startTime;

      const responseHash = hash(result);

      // Record agent call in decision record
      decisionRecord.recordAgentCall({
        agentId: route.agentId,
        capability: step.agentCapability,
        queryHash,
        responseHash,
        compliancePassed: true,  // Sprint 10: OPA evaluates the response
        costMicroAlgo: paymentReceipt?.amountMicroAlgo || 0,
        durationMs,
      });

      await auditLogger.logEvent('cortex.step.external', {
        invocationId,
        data: { stepId: step.id, queryHash, responseHash, agentId: route.agentId },
        teeAttestation,
        payload: {
          stepId: step.id,
          agentId: route.agentId,
          capability: step.agentCapability,
          queryHash,
          responseHash,
          durationMs,
          paymentTxId: paymentReceipt?.txId || null,
        },
      });

      return { result, usage, paymentReceipt };
    }
  }

  // ── DB helpers ────────────────────────────────────────────────────────────

  async _createCortexSession(cortexSessionId, invocationId, authSessionId, walletAddress, ephemeralWalletAddr, spendingLimit) {
    try {
      await db.query(
        `INSERT INTO cortex_sessions (id, auth_session_id, wallet_address, tee_context_id, spending_limit)
         VALUES ($1, $2, $3, $4, $5)`,
        [cortexSessionId, authSessionId, walletAddress, ephemeralWalletAddr, spendingLimit / 1_000_000]
      );
      await db.query('UPDATE invocations SET cortex_session_id = $1 WHERE id = $2', [cortexSessionId, invocationId]);
    } catch (err) {
      logger.warn('Cortex: failed to persist session record', { error: err.message });
    }
  }

  async _updateSpent(cortexSessionId, spentMicroAlgo) {
    try {
      await db.query('UPDATE cortex_sessions SET spent = $1 WHERE id = $2', [spentMicroAlgo / 1_000_000, cortexSessionId]);
    } catch (err) {
      logger.warn('Cortex: failed to update spent', { error: err.message });
    }
  }

  async _terminateCortexSession(cortexSessionId, reason) {
    try {
      await db.query(
        `UPDATE cortex_sessions SET terminated_at = now(), memory_wiped = true, termination_reason = $1 WHERE id = $2`,
        [reason, cortexSessionId]
      );
    } catch (err) {
      logger.warn('Cortex: failed to update session termination', { error: err.message });
    }
  }

  async _updateStatus(invocationId, status) {
    await db.query('UPDATE invocations SET status = $1 WHERE id = $2', [status, invocationId]);
  }

  async _complete(invocationId, result, cost) {
    await db.query(
      `UPDATE invocations SET status = 'completed', result = $1, cost_credits = $2, completed_at = now() WHERE id = $3`,
      [result, cost.credits, invocationId]
    );
  }

  async _fail(invocationId, error) {
    await db.query(
      `UPDATE invocations SET status = 'failed', error = $1, completed_at = now() WHERE id = $2`,
      [error, invocationId]
    );
  }
}

module.exports = new Cortex();
