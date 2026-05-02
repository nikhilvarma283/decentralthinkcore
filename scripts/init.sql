-- DecentralThink Core — PostgreSQL schema
-- Sprint 0: baseline tables

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Sessions ────────────────────────────────────────────────────────────────
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_sessions_wallet ON sessions(wallet_address);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ─── Invocations ─────────────────────────────────────────────────────────────
CREATE TABLE invocations (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  session_id      UUID REFERENCES sessions(id) ON DELETE SET NULL,
  agent_id        TEXT NOT NULL,
  task            TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending','running','completed','failed')),
  result          TEXT,                -- encrypted at application layer
  cost_credits    NUMERIC(18,6) DEFAULT 0,
  policy_decision JSONB,              -- OPA evaluation result
  blockchain_txid TEXT,               -- Algorand transaction ID
  started_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at    TIMESTAMPTZ,
  error           TEXT
);

CREATE INDEX idx_invocations_session ON invocations(session_id);
CREATE INDEX idx_invocations_status  ON invocations(status);
CREATE INDEX idx_invocations_agent   ON invocations(agent_id);

-- ─── Vault (encrypted secrets) ───────────────────────────────────────────────
CREATE TABLE vault_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_address   TEXT NOT NULL,
  key_name        TEXT NOT NULL,
  encrypted_value BYTEA NOT NULL,      -- AES-256-GCM via pgcrypto
  iv              BYTEA NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_address, key_name)
);

CREATE INDEX idx_vault_owner ON vault_entries(owner_address);

-- ─── Audit log ───────────────────────────────────────────────────────────────
CREATE TABLE audit_log (
  id              BIGSERIAL PRIMARY KEY,
  invocation_id   UUID REFERENCES invocations(id),
  event           TEXT NOT NULL,
  payload         JSONB DEFAULT '{}',
  blockchain_txid TEXT,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_invocation ON audit_log(invocation_id);
CREATE INDEX idx_audit_event      ON audit_log(event);

-- ─── Cost tracking ───────────────────────────────────────────────────────────
CREATE TABLE cost_ledger (
  id              BIGSERIAL PRIMARY KEY,
  invocation_id   UUID REFERENCES invocations(id),
  wallet_address  TEXT NOT NULL,
  model           TEXT,
  input_tokens    INTEGER DEFAULT 0,
  output_tokens   INTEGER DEFAULT 0,
  cost_usd        NUMERIC(12,8) DEFAULT 0,
  cost_credits    NUMERIC(18,6) DEFAULT 0,
  recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_wallet ON cost_ledger(wallet_address);
