# DecentralThink Core

Blockchain-protected TEE for agentic AI. Run AI agents with cryptographic audit trails, policy enforcement, and encrypted data vaults.

## Architecture

```
REST API (Express)
      ↓
Hermes Orchestrator  (task decomposition)
      ↓
TEE Simulator (Gramine SGX) + OPA Policies
      ↓
PostgreSQL Vault (AES-256)  +  Algorand (immutable audit)
```

## Quick Start

```bash
# 1. Clone and configure
cp .env.example .env
# Edit .env — set VAULT_ENCRYPTION_KEY, ANTHROPIC_API_KEY, ALGORAND_MNEMONIC

# 2. Launch full stack
docker-compose up --build

# 3. Verify
curl http://localhost:3000/health
```

Expected response:
```json
{
  "status": "ok",
  "version": "0.1.0",
  "checks": { "api": "ok", "database": "ok", "opa": "ok" },
  "timestamp": "..."
}
```

## Directory Structure

```
decentralthink-core/
├── src/
│   ├── api/          Express routes
│   ├── orchestrator/ Hermes agent wrapper
│   ├── tee/          Gramine SGX simulation
│   ├── blockchain/   Algorand integration
│   ├── policy/       OPA/Rego policies
│   ├── vault/        PostgreSQL AES-256 encryption
│   ├── auth/         SIWE (Sign-In With Ethereum)
│   ├── payments/     Per-invocation cost tracking
│   └── lib/          Shared utilities (logger, db)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/
│   ├── init.sql      PostgreSQL schema
│   └── healthcheck.sh
├── infra/            Terraform (AWS ECS)
├── sdks/
│   ├── js/           JavaScript SDK
│   └── python/       Python SDK
├── docs/
├── Dockerfile
└── docker-compose.yml
```

## Development

```bash
npm install
npm run dev          # nodemon hot-reload
npm test             # all tests
npm run test:unit    # unit only
```

## Roadmap

| Sprint | Weeks | Focus |
|--------|-------|-------|
| 0 | 1–2 | Repo scaffold, Docker, DB schema ✅ |
| 1 | 3–6 | Express API, Hermes orchestration |
| 2 | 7–10 | SIWE auth, PostgreSQL vault |
| 3 | 11–14 | Algorand blockchain audit trail |
| 4 | 15–18 | OPA/Rego policy engine |
| 5 | 19–22 | Production hardening, AWS ECS |
| 6 | 23–26 | JS + Python SDKs, documentation |

## Environment Variables

See [.env.example](.env.example) for all configuration options with descriptions.

## Security

- All vault data encrypted with AES-256-GCM before storage
- Every agent invocation logged immutably to Algorand
- OPA policies evaluated before execution
- Non-root Docker user, Helmet headers, rate limiting enabled by default
