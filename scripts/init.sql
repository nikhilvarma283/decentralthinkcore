-- DecentralThink Core — PostgreSQL schema
-- Patent-aligned: user-sovereign vault, Cortex sessions, blockchain audit

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ─── Auth sessions (SIWE) ────────────────────────────────────────────────────
CREATE TABLE sessions (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  wallet_address  TEXT NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at      TIMESTAMPTZ NOT NULL,
  revoked_at      TIMESTAMPTZ,
  metadata        JSONB DEFAULT '{}'
);

CREATE INDEX idx_sessions_wallet  ON sessions(wallet_address);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ─── Cortex sessions (ephemeral orchestration lifecycle) ─────────────────────
-- Per patent Component 3: every Cortex instantiation and termination is recorded.
-- Memory wipe is confirmed here. No task data stored — only lifecycle metadata.
CREATE TABLE cortex_sessions (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  auth_session_id     UUID REFERENCES sessions(id) ON DELETE SET NULL,
  wallet_address      TEXT NOT NULL,
  tee_context_id      TEXT,                    -- TEE enclave ID
  tee_attestation     TEXT,                    -- remote attestation proof (Sprint 3)
  spending_limit      NUMERIC(18,6) DEFAULT 0, -- user-defined budget for this session
  spent               NUMERIC(18,6) DEFAULT 0,
  instantiated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  terminated_at       TIMESTAMPTZ,
  memory_wiped        BOOLEAN DEFAULT false,    -- confirmed by TEE on termination
  termination_reason  TEXT                     -- 'completed' | 'timeout' | 'error'
);

CREATE INDEX idx_cortex_wallet ON cortex_sessions(wallet_address);

-- ─── Invocations ─────────────────────────────────────────────────────────────
CREATE TABLE invocations (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cortex_session_id UUID REFERENCES cortex_sessions(id) ON DELETE SET NULL,
  auth_session_id   UUID REFERENCES sessions(id) ON DELETE SET NULL,
  agent_id          TEXT NOT NULL,
  task              TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'pending'
                      CHECK (status IN ('pending','running','completed','failed')),
  result            TEXT,                -- encrypted client-side before storage
  cost_credits      NUMERIC(18,6) DEFAULT 0,
  policy_decision   JSONB,              -- OPA evaluation result
  blockchain_txid   TEXT,               -- Algorand audit chain transaction
  started_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at      TIMESTAMPTZ,
  error             TEXT
);

CREATE INDEX idx_invocations_cortex ON invocations(cortex_session_id);
CREATE INDEX idx_invocations_status ON invocations(status);
CREATE INDEX idx_invocations_agent  ON invocations(agent_id);

-- ─── Sovereign Vault ─────────────────────────────────────────────────────────
-- Server is a BLIND storage layer. encrypted_value is AES-256-GCM ciphertext
-- produced CLIENT-SIDE. The server never holds decryption keys.
CREATE TABLE vault_entries (
  id              UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  owner_address   TEXT NOT NULL,
  key_name        TEXT NOT NULL,
  encrypted_value BYTEA NOT NULL,   -- client-encrypted ciphertext only
  iv              BYTEA NOT NULL,   -- GCM IV (96-bit)
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (owner_address, key_name)
);

CREATE INDEX idx_vault_owner ON vault_entries(owner_address);

-- ─── Sub-key grants (Cortex → Agent) ────────────────────────────────────────
-- Tracks temporary sub-keys provisioned to agents for specific vault entries.
-- The sub-key itself is NEVER stored here — only the grant metadata.
CREATE TABLE subkey_grants (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  cortex_session_id UUID REFERENCES cortex_sessions(id) ON DELETE CASCADE,
  vault_key_name    TEXT NOT NULL,
  agent_id          TEXT NOT NULL,
  granted_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at        TIMESTAMPTZ NOT NULL,
  revoked_at        TIMESTAMPTZ           -- set when Cortex revokes the sub-key
);

CREATE INDEX idx_subkey_grants_cortex ON subkey_grants(cortex_session_id);

-- ─── Blockchain audit log ────────────────────────────────────────────────────
-- Records cryptographic PROOFS only — no raw data, no PII.
-- Every agent action, data access, and payment is logged here,
-- then anchored to the Algorand blockchain.
CREATE TABLE audit_log (
  id                BIGSERIAL PRIMARY KEY,
  invocation_id     UUID REFERENCES invocations(id),
  cortex_session_id UUID REFERENCES cortex_sessions(id),
  event             TEXT NOT NULL,           -- 'cortex.start' | 'agent.execute' | 'vault.access' | etc.
  data_hash         TEXT,                    -- SHA-256 of data involved (NOT the data)
  tee_attestation   TEXT,                    -- TEE attestation proof at time of event
  payload           JSONB DEFAULT '{}',      -- non-sensitive metadata only
  blockchain_txid   TEXT,                    -- Algorand transaction anchoring this record
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_audit_invocation ON audit_log(invocation_id);
CREATE INDEX idx_audit_event      ON audit_log(event);
CREATE INDEX idx_audit_cortex     ON audit_log(cortex_session_id);

-- ─── Cost / payment ledger ───────────────────────────────────────────────────
-- Infrastructure cost metering. In Sprint 5 this becomes the hierarchical
-- wallet ledger (Master → Cortex → Agent payments via HTTP 402).
CREATE TABLE cost_ledger (
  id                BIGSERIAL PRIMARY KEY,
  invocation_id     UUID REFERENCES invocations(id),
  cortex_session_id UUID REFERENCES cortex_sessions(id),
  wallet_address    TEXT NOT NULL,
  model             TEXT,
  input_tokens      INTEGER DEFAULT 0,
  output_tokens     INTEGER DEFAULT 0,
  cost_usd          NUMERIC(12,8) DEFAULT 0,
  cost_credits      NUMERIC(18,6) DEFAULT 0,
  recorded_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_cost_wallet ON cost_ledger(wallet_address);

-- ─── Agent marketplace (ZK Marketplace — Sprint 4) ───────────────────────────
-- Agents register capabilities here. In Sprint 4 these become
-- cryptographic commitments; for now we store plaintext capabilities.
CREATE TABLE marketplace_agents (
  id                UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  agent_id          TEXT UNIQUE NOT NULL,
  name              TEXT NOT NULL,
  description       TEXT,
  capabilities      JSONB DEFAULT '[]',      -- array of capability strings
  pricing_model     TEXT DEFAULT 'pay-per-use',
  price_per_call    NUMERIC(12,8) DEFAULT 0,
  endpoint_url      TEXT,
  tee_certified     BOOLEAN DEFAULT false,
  reputation_score  NUMERIC(5,2) DEFAULT 0,
  registered_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  active            BOOLEAN DEFAULT true
);

CREATE INDEX idx_marketplace_active ON marketplace_agents(active);
