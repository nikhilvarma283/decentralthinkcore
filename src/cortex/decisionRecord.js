/**
 * Decision Record — builds, persists, and seals the immutable audit trail
 * for every Cortex invocation.
 *
 * Every invocation produces exactly one DecisionRecord which accumulates:
 *   - Intake decision (was the task permitted?)
 *   - Decomposition graph (how was it broken down?)
 *   - Anonymization log (what was stripped before external dispatch?)
 *   - Per-agent call records (what went out, what came back — hashes only)
 *   - Assembly summary (how were results merged?)
 *   - Final seal (Algorand txid + TEE attestation)
 *
 * Raw content is NEVER stored. Only:
 *   - Hashes (SHA-256) of inputs/outputs
 *   - Structural metadata (step descriptions, rule names, agent IDs)
 *   - Decision outcomes (permitted/blocked/escalated)
 *
 * This is the evidentiary foundation for:
 *   - Regulatory audits
 *   - Bias/discrimination litigation
 *   - Data governance compliance
 *   - Internal accountability
 */

const { v4: uuidv4 } = require('uuid');
const db = require('../lib/db');
const logger = require('../lib/logger');
const auditLogger = require('../blockchain/auditLogger');
const { hash } = require('./anonymizer');

class DecisionRecord {
  constructor(invocationId, orgId = 'default') {
    this.id = uuidv4();
    this.invocationId = invocationId;
    this.orgId = orgId;
    this.personaSnapshot = null;
    this.policyVersionHash = null;
    this.taskHash = null;
    this.classification = null;
    this.intakeDecision = null;
    this.intakeRule = null;
    this.decompositionGraph = null;
    this.anonymizationLog = [];
    this.agentCalls = [];
    this.assemblySummary = null;
    this.resultHash = null;
    this.teeAttestation = null;
    this.algorandTxid = null;
  }

  // ── Builder methods (called as Cortex executes) ───────────────────────────

  setContext({ personaSnapshot, policyVersionHash, teeAttestation }) {
    this.personaSnapshot = personaSnapshot;
    this.policyVersionHash = policyVersionHash || 'sha256:default-v1-0000000000000000000000000000000000000000000000000000000000';
    this.teeAttestation = teeAttestation;
    return this;
  }

  recordIntake(task, { decision, rule, classification }) {
    this.taskHash = hash(task);
    this.intakeDecision = decision;         // 'permitted' | 'blocked' | 'escalated'
    this.intakeRule = rule || null;
    this.classification = classification;
    return this;
  }

  recordDecomposition(steps, anonymizationLog = []) {
    // Store the DAG structure but never the raw task content
    this.decompositionGraph = steps.map((s) => ({
      id: s.id,
      category: s.classification?.category,
      execution: s.classification?.execution,
      sensitivity: s.classification?.sensitivity,
      parallel: s.parallel,
      deps: s.deps,
      agentCapability: s.agentCapability || null,
      // Store step description only if it's a local step (stays in TEE).
      // External step descriptions are stored as hash only.
      description: s.classification?.execution === 'local'
        ? s.description
        : '[EXTERNAL — stored as hash]',
      descriptionHash: hash(s.description),
    }));

    this.anonymizationLog = anonymizationLog;
    return this;
  }

  recordAgentCall({ agentId, capability, queryHash, responseHash, compliancePassed, costMicroAlgo, durationMs }) {
    this.agentCalls.push({
      id: uuidv4(),
      agentId,
      capability,
      queryHash,
      responseHash: responseHash || null,
      compliancePassed: compliancePassed !== false,
      costMicroAlgo: costMicroAlgo || 0,
      durationMs: durationMs || 0,
      calledAt: new Date().toISOString(),
    });
    return this;
  }

  recordAssembly(summary, result) {
    this.assemblySummary = summary;
    this.resultHash = hash(typeof result === 'string' ? result : JSON.stringify(result));
    return this;
  }

  // ── Persist to DB + seal on Algorand ─────────────────────────────────────

  async seal() {
    // 1. Write decision record to DB
    try {
      await db.query(
        `INSERT INTO decision_records
           (id, invocation_id, org_id, persona_snapshot, policy_version_hash,
            task_hash, classification, intake_decision, intake_rule,
            decomposition_graph, anonymization_log, assembly_summary,
            result_hash, tee_attestation)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
        [
          this.id,
          this.invocationId,
          this.orgId,
          this.personaSnapshot,
          this.policyVersionHash,
          this.taskHash,
          this.classification,
          this.intakeDecision,
          this.intakeRule,
          this.decompositionGraph,
          this.anonymizationLog,
          this.assemblySummary,
          this.resultHash,
          this.teeAttestation,
        ]
      );
    } catch (err) {
      logger.error('DecisionRecord: DB insert failed', { id: this.id, error: err.message });
    }

    // 2. Write individual agent call records to DB
    for (const call of this.agentCalls) {
      try {
        await db.query(
          `INSERT INTO agent_call_records
             (id, decision_record_id, invocation_id, agent_id, capability,
              query_hash, response_hash, compliance_passed, cost_microalgo,
              duration_ms, called_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            call.id,
            this.id,
            this.invocationId,
            call.agentId,
            call.capability,
            call.queryHash,
            call.responseHash,
            call.compliancePassed,
            call.costMicroAlgo,
            call.durationMs,
            call.calledAt,
          ]
        );
      } catch (err) {
        logger.error('DecisionRecord: agent call insert failed', { error: err.message });
      }
    }

    // 3. Seal to Algorand — the on-chain anchor for this entire record
    const sealData = {
      decisionRecordId: this.id,
      invocationId: this.invocationId,
      taskHash: this.taskHash,
      intakeDecision: this.intakeDecision,
      policyVersionHash: this.policyVersionHash,
      resultHash: this.resultHash,
      agentCallCount: this.agentCalls.length,
      sealedAt: new Date().toISOString(),
    };

    const { blockchainTxid } = await auditLogger.logEvent('cortex.decision.sealed', {
      invocationId: this.invocationId,
      data: sealData,
      teeAttestation: this.teeAttestation,
      payload: {
        decisionRecordId: this.id,
        intakeDecision: this.intakeDecision,
        stepCount: this.decompositionGraph?.length || 0,
        agentCallCount: this.agentCalls.length,
        policyVersionHash: this.policyVersionHash,
      },
    });

    // 4. Store Algorand txid back in the decision record
    this.algorandTxid = blockchainTxid;
    try {
      await db.query(
        'UPDATE decision_records SET algorand_txid = $1 WHERE id = $2',
        [blockchainTxid, this.id]
      );
    } catch (err) {
      logger.error('DecisionRecord: failed to update algorand_txid', { error: err.message });
    }

    logger.info('DecisionRecord: sealed', {
      id: this.id,
      invocationId: this.invocationId,
      intakeDecision: this.intakeDecision,
      agentCalls: this.agentCalls.length,
      algorandTxid: blockchainTxid,
    });

    return {
      decisionRecordId: this.id,
      algorandTxid: blockchainTxid,
      taskHash: this.taskHash,
      resultHash: this.resultHash,
    };
  }
}

module.exports = { DecisionRecord };
