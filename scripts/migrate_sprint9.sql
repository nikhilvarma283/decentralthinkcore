-- Sprint 9 migration — decision records, agent call records, policy versions

-- ── Policy versions ──────────────────────────────────────────────────────────
-- Every change to org rules creates an immutable version.
-- The version_hash is stored in every decision record so you can
-- retrieve the exact rules that governed any past decision.
CREATE TABLE IF NOT EXISTS policy_versions (
  id             UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  org_id         TEXT NOT NULL DEFAULT 'default',
  version_hash   TEXT NOT NULL UNIQUE,  -- SHA-256 of policy content
  policy_content TEXT NOT NULL,         -- OPA rego source at this version
  created_by     TEXT NOT NULL,         -- wallet address of admin who created it
  algorand_txid  TEXT,                  -- on-chain anchor
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_policy_versions_org ON policy_versions(org_id);

-- ── Decision records ─────────────────────────────────────────────────────────
-- One record per invocation. The full audit trail of every Cortex decision.
-- Raw data is NEVER stored here — only hashes and structured metadata.
CREATE TABLE IF NOT EXISTS decision_records (
  id                   UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  invocation_id        UUID REFERENCES invocations(id) ON DELETE SET NULL,
  org_id               TEXT NOT NULL DEFAULT 'default',
  persona_snapshot     JSONB,           -- exact persona at decision time
  policy_version_hash  TEXT,            -- which policy governed this decision
  task_hash            TEXT NOT NULL,   -- SHA-256(original task)
  classification       JSONB,           -- sensitivity, execution zones
  intake_decision      TEXT NOT NULL CHECK (intake_decision IN ('permitted','blocked','escalated')),
  intake_rule          TEXT,            -- which rule triggered the decision
  decomposition_graph  JSONB,           -- DAG of steps with reasoning
  anonymization_log    JSONB,           -- what was stripped and why
  assembly_summary     TEXT,            -- how results were merged (non-sensitive)
  result_hash          TEXT,            -- SHA-256(final result)
  tee_attestation      TEXT,
  algorand_txid        TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_decision_records_invocation ON decision_records(invocation_id);
CREATE INDEX idx_decision_records_org        ON decision_records(org_id);
CREATE INDEX idx_decision_records_policy     ON decision_records(policy_version_hash);

-- ── Agent call records ───────────────────────────────────────────────────────
-- One record per external agent call within an invocation.
-- query_hash and response_hash allow verification without storing content.
CREATE TABLE IF NOT EXISTS agent_call_records (
  id                 UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  decision_record_id UUID REFERENCES decision_records(id) ON DELETE CASCADE,
  invocation_id      UUID REFERENCES invocations(id) ON DELETE SET NULL,
  agent_id           TEXT NOT NULL,
  capability         TEXT,
  query_hash         TEXT NOT NULL,   -- SHA-256(anonymized query sent)
  response_hash      TEXT,            -- SHA-256(raw response received)
  compliance_passed  BOOLEAN,         -- did response pass org rules check
  cost_microalgo     INTEGER DEFAULT 0,
  duration_ms        INTEGER,
  algorand_txid      TEXT,
  called_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_agent_calls_decision    ON agent_call_records(decision_record_id);
CREATE INDEX idx_agent_calls_invocation  ON agent_call_records(invocation_id);
CREATE INDEX idx_agent_calls_agent       ON agent_call_records(agent_id);

-- ── Seed default policy version ──────────────────────────────────────────────
-- The initial org policy. All decisions before admin configures custom rules
-- reference this version hash.
INSERT INTO policy_versions (org_id, version_hash, policy_content, created_by)
VALUES (
  'default',
  'sha256:default-v1-0000000000000000000000000000000000000000000000000000000000',
  'package decentralthink.policy

# Default org policy — all tasks permitted, all data public
# Replace via admin panel (Sprint 10)

default allow = true
default data_classification = "public"
default requires_local_execution = false
default requires_approval = false',
  'system'
) ON CONFLICT (version_hash) DO NOTHING;

-- ── Seed demo agents in marketplace ─────────────────────────────────────────
INSERT INTO marketplace_agents
  (agent_id, name, description, capabilities, pricing_model, price_per_call, endpoint_url, tee_certified, reputation_score)
VALUES
  (
    'demo-flight-search',
    'Flight Search Agent',
    'Searches available flights by route, date and class. Returns options with pricing. Demo agent on Algorand testnet.',
    '["flight-search","travel","information-retrieval"]',
    'pay-per-use',
    0.0005,
    'http://localhost:3000/api/v1/demo/flight',
    false,
    85
  ),
  (
    'demo-hotel-search',
    'Hotel Search Agent',
    'Searches available hotels by location, dates and category. Returns options with pricing. Demo agent on Algorand testnet.',
    '["hotel-search","travel","information-retrieval"]',
    'pay-per-use',
    0.0005,
    'http://localhost:3000/api/v1/demo/hotel',
    false,
    85
  )
ON CONFLICT (agent_id) DO UPDATE SET
  endpoint_url = EXCLUDED.endpoint_url,
  active = true;
