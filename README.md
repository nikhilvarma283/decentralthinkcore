# DecentralThink Core

**Built by [Nikhil Varma](https://decentralthink.com)**

DecentralThink Core is a patent-pending, privacy-sovereign infrastructure layer for agentic AI. It provides a cryptographically auditable, policy-enforced execution environment where AI agents run without the platform ever seeing user data — the server is architecturally blind by design.

> *"Like AWS is to web apps — one secure, auditable, privacy-preserving agent execution layer as the substrate for an entire ecosystem of vertical products."*

---

## What It Does

- **Sovereign Vault** — Users hold their master encryption key, derived client-side from a wallet signature (HKDF). The server stores only ciphertext and is never provisioned the decryption key.
- **Ephemeral Cortex** — A session-scoped orchestration agent (powered by Nous Research Hermes, running on-premises via Ollama) that decomposes tasks, executes agents, and wipes all state + keys on session end.
- **Blockchain Audit Chain** — Every agent action, data access, and payment is recorded as a cryptographic hash on Algorand. Immutable audit trail without raw data exposure.
- **Zero-Knowledge Marketplace** — Agents post capabilities as cryptographic commitments. Users discover agents via ZK proofs. No user identity exposed during matching.
- **Hierarchical Payment System** — HTTP 402 micro-payments: Master Wallet → Ephemeral Cortex Wallet (session-budget-limited) → Agent Wallets. Payments are cryptographically tied to task completion proofs.
- **Policy Engine** — OPA/Rego policies evaluated before every agent execution. Builders define what agents can and cannot do at the deployment level.

---

## Architecture

```
Client (wallet signature → HKDF master key)
           │
           ▼
    REST API  (Express + SIWE auth)
           │
           ▼
  Ephemeral Cortex  (task decomposition + orchestration)
           │
     ┌─────┴──────┐
     ▼            ▼
 TEE Simulator   OPA Policy Engine
 (Gramine SGX)   (Rego rules)
     │
     ├── Sovereign Vault (PostgreSQL — blind AES-256 storage)
     ├── Hermes LLM (Nous Research, on-prem via Ollama)
     ├── ZK Marketplace (agent registry + subscriptions)
     └── Algorand Audit Chain (hashes only, never raw data)

Payments: HTTP 402 — Master → Cortex wallet → Agent wallet
```

### The 3-Layer Product Stack

| Layer | Description |
|---|---|
| **Layer 1 — Core** (this repo) | TEE container, Sovereign Vault, Ephemeral Cortex, ZK Marketplace, Blockchain Audit, Hierarchical Payments |
| **Layer 2 — Builder Interface** (roadmap) | Shopify-style UI: configure blockchain, subscribe to agents, deploy smart contracts, set user permission rules |
| **Layer 3 — Vertical Products** (roadmap) | Healthcare AI, GoHighLevel competitor, executive recruiting, DeFi agents — all built on Layer 2 using Layer 1 |

---

## Quick Start

### Prerequisites

- Docker & Docker Compose
- Node.js ≥ 20
- An Ethereum-compatible wallet (for SIWE auth)
- Algorand testnet account ([faucet](https://testnet.algoexplorer.io/dispenser))

### 1. Clone and Configure

```bash
git clone https://github.com/nikhilvarma283/decentralthinkcore.git
cd decentralthinkcore
cp .env.example .env
```

Edit `.env` — the required fields are:

```env
SESSION_SECRET=<64-char random string>
ALGORAND_MNEMONIC=<25-word mnemonic from funded testnet account>
```

Everything else has working defaults for local development.

### 2. Launch Full Stack

```bash
docker compose up --build
```

This starts:
- DecentralThink Core API on port 3000
- Ollama + Hermes model (first run downloads ~4GB)
- PostgreSQL on port 5432
- OPA policy engine on port 8181

### 3. Verify

```bash
curl http://localhost:3000/health
```

```json
{
  "status": "ok",
  "version": "0.1.0",
  "checks": { "api": "ok", "database": "ok", "opa": "ok" },
  "timestamp": "..."
}
```

---

## API Reference

All endpoints under `/api/v1/`. Authentication via SIWE (Sign-In With Ethereum).

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check — no auth required |
| `/api/v1/auth/nonce` | GET | Get SIWE nonce |
| `/api/v1/auth/verify` | POST | Verify wallet signature, create session |
| `/api/v1/invoke` | POST | Invoke a Cortex agent task |
| `/api/v1/vault` | GET/POST | Read/write to Sovereign Vault |
| `/api/v1/audit` | GET | Query Algorand audit trail |
| `/api/v1/marketplace` | GET | Discover agents (ZK marketplace) |
| `/api/v1/marketplace/subscribe` | POST | Subscribe to an agent |
| `/api/v1/payments` | GET | Payment history and wallet balances |
| `/api/v1/builder` | POST | Builder deployment configuration |
| `/api/v1/messaging` | POST | Inter-user secure messaging |

---

## Directory Structure

```
decentralthink-core/
├── src/
│   ├── api/
│   │   ├── health.js             Health check endpoint
│   │   └── v1/                   Versioned API routes
│   │       ├── agent.js          Agent management
│   │       ├── audit.js          Blockchain audit queries
│   │       ├── auth.js           SIWE authentication
│   │       ├── builder.js        Builder interface
│   │       ├── invoke.js         Cortex task invocation
│   │       ├── marketplace.js    ZK agent marketplace
│   │       ├── messaging.js      Inter-user secure messaging
│   │       ├── payments.js       x402 payment endpoints
│   │       └── vault.js          Sovereign Vault CRUD
│   ├── auth/                     SIWE session management
│   ├── blockchain/               Algorand audit chain
│   ├── cortex/                   Ephemeral Cortex orchestrator
│   │   ├── decomposer.js         Task decomposition
│   │   ├── executor.js           Agent execution inside TEE
│   │   └── index.js
│   ├── marketplace/              ZK agent registry
│   │   ├── discovery.js          Agent discovery
│   │   ├── registry.js           Agent registration
│   │   └── subscriptions.js      Builder subscriptions
│   ├── middleware/               Rate limiting, auth guards
│   ├── payments/                 HTTP 402 / x402 system
│   │   ├── costTracker.js        Per-invocation cost metering
│   │   ├── wallet.js             Hierarchical wallet management
│   │   ├── x402Client.js         x402 payment client
│   │   ├── x402Middleware.js     Express 402 middleware
│   │   └── x402Verifier.js       Payment receipt verification
│   ├── policy/                   OPA/Rego policy definitions
│   ├── tee/                      TEE simulation (Gramine SGX)
│   ├── vault/                    Sovereign Vault (blind storage)
│   └── lib/                      Logger, DB pool, shared utils
├── sdks/
│   ├── js/                       JavaScript/TypeScript SDK
│   └── python/                   Python SDK
├── tests/
│   ├── unit/
│   ├── integration/
│   └── e2e/
├── scripts/
│   ├── init.sql                  PostgreSQL schema
│   └── pull-model.sh             Hermes model pull script
├── ghost/                        Ghost CMS deployment (decentralthink.com)
├── infra/                        Infrastructure-as-code
├── Dockerfile
├── docker-compose.yml            Development stack
└── docker-compose.prod.yml       Production stack (Traefik + VPS)
```

---

## Environment Variables

See [`.env.example`](.env.example) for all options with descriptions. Key variables:

| Variable | Required | Description |
|---|---|---|
| `SESSION_SECRET` | Yes | Random secret for SIWE session signing |
| `ALGORAND_MNEMONIC` | Yes | 25-word mnemonic for audit chain signing |
| `OLLAMA_URL` | Yes | Ollama endpoint (default: `http://ollama:11434`) |
| `HERMES_MODEL` | No | Model to use (default: `nous-hermes2`) |
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `X402_VERIFY_MODE` | No | `simulate` (dev) or `submit` (prod) |

---

## Production Deployment

The repo includes production Docker Compose configs with Traefik labels for automatic HTTPS.

```bash
# DecentralThink Core API at core.decentralthink.com
cp .env.prod.example .env.prod
# Edit .env.prod with production values
docker compose -f docker-compose.prod.yml up -d --build

# Ghost CMS at decentralthink.com
cd ghost
cp .env.example .env
# Edit .env with SMTP and DB passwords
docker compose up -d
```

---

## Development

```bash
npm install
npm run dev              # nodemon hot-reload on src/
npm test                 # full test suite
npm run test:unit        # unit tests only
npm run test:integration
npm run lint
```

---

## Security Model

| Guarantee | How |
|---|---|
| Server never sees user data | Master key derived client-side via HKDF from wallet signature — server is a blind ciphertext store |
| Every action is auditable | Cryptographic hashes + TEE attestation proofs on Algorand — never raw data |
| Agents can't exceed permissions | OPA/Rego policies evaluated before every execution |
| Sessions are ephemeral | Cortex memory wiped + keys revoked on session end |
| Payments are trustless | HTTP 402 receipts cryptographically tied to task completion |

---

## Roadmap

| Sprint | Status | Focus |
|---|---|---|
| 0 — Scaffold | ✅ Done | Repo, Docker, DB schema |
| 1 — Core API | ✅ Done | Express API, Hermes orchestration, TEE simulator |
| 2 — Auth + Vault | ✅ Done | SIWE auth, Sovereign Vault, blind storage |
| 3 — Audit Chain | ✅ Done | Algorand blockchain audit trail |
| 4 — ZK Marketplace | ✅ Done | Agent registry, ZK discovery, subscriptions |
| 5 — Payments | ✅ Done | x402 hierarchical payment system |
| 6 — Builder Interface | ✅ Done | Shopify-style deployment layer |
| 7 — Secure Messaging | ✅ Done | Inter-user encrypted messaging |
| 8 — Production | 🔄 In Progress | VPS deployment, Ghost CMS, x402 textbook paywall |
| 9 — Layer 2 UI | 🔜 Planned | Graphical builder interface |
| 10 — SDKs | 🔜 Planned | JS + Python SDK documentation |

---

## Patent Notice

DecentralThink Core implements architecture described in a provisional patent filed February 18, 2026. The six core components — Sovereign Vault, TEE Network, Ephemeral Cortex, Zero-Knowledge Marketplace, Blockchain Audit Chain, and Hierarchical Payment System — constitute the patent-pending claims.

---

## Builder

**Nikhil Varma**
Founder, DecentralThink
[decentralthink.com](https://decentralthink.com)

*DecentralThink Core is the foundational infrastructure layer. All Layer 3 vertical products — healthcare AI, GoHighLevel alternatives, DeFi agents — inherit its privacy and sovereignty guarantees by architecture.*

---

## License

Proprietary — All rights reserved. Contact [decentralthink.com](https://decentralthink.com) for licensing inquiries.
