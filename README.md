# kovanica-web

Public web application, BlockDAG Explorer, Wallet, AMM DEX, KVP-106 RWA Portal, Stratum Mining Pool, Faucet, API Reference, and Ecosystem Services hub for the **Kovanica (KVNC)** Layer-1 blockchain — live at **[kovanica.online](https://kovanica.online)** (TanStack Start + Vite + Nitro 3).

> [!IMPORTANT]
> **Live Network Boundaries & Visual DNA:**
> - **Canonical Networks:** Mainnet (Chain ID `1`, frozen tag `1-f35df34c92001436`, launching `1.1.2027`, read-only pre-launch) and live Testnet (Chain ID `2`, frozen tag `2-24cdb5fadd98b207`, Hybrid PoW + GHOSTDAG `K=5`, `4s` target block time, `KovanicaHash`, zero stake on consensus).
> - **Brand Tokens (`src/styles.css`):** Ink (`--color-bg` `#09090b`), Surface (`#121214` / `#1a1a1e`), Paper (`--color-fg` `#f2f1ee`), Kovanica Gold (`--color-gold` `#F2A900`), Teal (`#2fbaa4`), Blue (`#8aa0b4`), and `Fraunces` / `IBM Plex Sans` / `IBM Plex Mono`.
> - **Zero Committed Secrets & Zero Tracking Cookies:** Runtime configuration is injected exclusively via environment variables (`KOVANICA_*`, `VITE_*`); never commit hosts, IPs, ports, keys, or `.env` files. Zero third-party ad scripts or tracking cookies.

---

## Navigation & Surfaces (5 Pure Function Tabs)

All app surfaces share the unified `<Shell>` (`src/components/layout/shell.tsx`) with a single-source-of-truth `NAV_GROUPS` taxonomy (shared with `HomeTestnet`), contextual section sub-nav on Trade/Assets/Wallet routes, and a cross-subdomain **Ecosystem Switcher**:

| Tab | Routes | Purpose |
| :--- | :--- | :--- |
| **Explore** | `/explorer`, `/network`, `/pool`, `/map`, `/dash`, `/roadmap` | Live BlockDAG Explorer (left-to-right multi-lane card graph with plain-English legend/tooltips + 8 tabs & drawers), peer/sync telemetry, **Stratum V1 TLS Mining Pool** (`MinerCommandBuilder`), Origins Map, Dashboard, Roadmap |
| **Trade** | `/swap`, `/pools`, `/wallet/dex`, `/wallet/atomic-swap` | Native AMM Swap (Wave A 1-tx batch + Wave B fee telemetry), **AMM Liquidity Pools** (add/remove liquidity + on-chain KVP-102 `PoolView` quote calculator), Orderbook DEX, Atomic Swaps |
| **Assets** | `/rwa`, `/wallet/rwa-issue`, `/wallet/rwa-manage`, `/multi-asset`, `/nft`, `/wallet/token-listings` | End-to-end **Create Token (KVP-102)** (`/multi-asset`), **Create Collection & Mint NFT (KVP-106)** (`/nft`), client-signed **Issue RWA (KVP-106)** (`/wallet/rwa-issue`, flexible `https://`/`ipfs://` or inline JSON hash fallback), Public RWA Registry (`/rwa`), Compliance Portal (`/wallet/rwa-manage`), Token Listings |
| **Wallet** | `/wallet`, `/faucet`, `/wallet/airdrops`, `/wallet/coinjoin`, `/wallet/ecosystem-tools` | PRO-21 browser vault (`@kovanica/sdk-wasm`), hardware signing, Testnet Faucet (with PRO-21 pre-flight guard), Airdrops, CoinJoin, Ecosystem Tools (scheduler, bridge, passkeys) |
| **Build** | `/multisig`, `/htlc`, `/vaults`, `/stealth`, `/docs`, `/api-reference`, `/playground`, `/pricing`, `/privacy` | Smart contract consoles, Documentation (`docs.kovanica.online`), JSON-RPC 2.0 API Reference, Built-in Playground (`playground.kovanica.online`), **Pricing & Services** (`/pricing`), and **Privacy Policy** (`/privacy`) |

Full domain, subdomain, route, and API inventory: **[`docs/domain-and-link-map.md`](docs/domain-and-link-map.md)** · Pre-Mainnet `1.1.2027` infrastructure audit & 3-node dress rehearsal runbook: **[`docs/pre-mainnet-2027-infra-prep.md`](docs/pre-mainnet-2027-infra-prep.md)**.

---

## Ecosystem Services, Billing, API Keys & Runtime Configuration

`/pricing` (`src/routes/pricing.tsx`) wires all 6 non-token revenue streams (Managed RPC/Indexer tiers, RWA Issuer SaaS, Swap interface fee disclosure, Official Mining Pool fee, Verified Listings & zero-cookie Sponsorships, and Enterprise Support) to:
- **Self-Serve Billing (`src/lib/api/billing.server.ts`):** `POST /api/billing/checkout` (Stripe Checkout via native `fetch` when `STRIPE_SECRET_KEY` is configured, or deterministic on-chain `USDC`/`KVNC` invoices persisted to `data/invoices.jsonl`), `POST /api/billing/webhook` (HMAC-SHA256 `timingSafeEqual` + 300s replay guard, auto-provisions/revokes API keys), and `GET /api/billing/invoice/:id`.
- **API Key Provisioning & Tiered Rate-Limiting (`src/lib/api/api-keys.server.ts`):** SHA-256 hashed key store (`data/api-keys.jsonl`), admin CRUD (`POST/GET/DELETE /api/keys` gated by `BILLING_ADMIN_TOKEN`), and sliding-window middleware (`X-API-Key` / `Authorization: Bearer kvnc_...`) emitting `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, and `X-RateLimit-Tier` headers with a graceful `300` RPM public fallback.
- **Lead Intake & Admin Digest:** `POST /api/inquiries` (`src/lib/api/inquiries.server.ts`) persists to `data/inquiries.jsonl`; summarize leads via `npm run inquiries:digest` (`scripts/inquiries-digest.mjs` with `--since`, `--format markdown|json`, and default PII redaction).

| Env Variable | Default | Purpose |
| :--- | :--- | :--- |
| `KOVANICA_RPC_URL` | `https://rpc-testnet.kovanica.online` | Upstream Testnet JSON-RPC origin |
| `KOVANICA_FAUCET_URL` | unset | Upstream Testnet faucet dispense endpoint |
| `KOVANICA_INQUIRIES_FILE` | `data/inquiries.jsonl` | Append-only JSONL file storing validated `POST /api/inquiries` leads |
| `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` / `STRIPE_PRICE_*` | unset (on-chain fallback) | Optional Stripe Checkout & HMAC-SHA256 webhook verification |
| `BILLING_TREASURY_ADDRESS` | unset | PRO-21 / treasury address for on-chain `USDC`/`KVNC` invoices (`data/invoices.jsonl`) |
| `BILLING_ADMIN_TOKEN` | unset (fail-closed `503`) | Bearer token gating `POST/GET/DELETE /api/keys` (constant-time comparison) |
| `VITE_SWAP_INTERFACE_FEE_BPS` | `0` (testnet) | Optional front-end swap interface fee in basis points (`0..100` = `0.00%..1.00%`) |
| `VITE_SWAP_FEE_RECIPIENT` | unset | Optional fee recipient address when `VITE_SWAP_INTERFACE_FEE_BPS > 0` |
| `VITE_MINING_POOL_FEE_PCT` | `1.0` | Planned mainnet Stratum mining pool fee percentage (`0%` on testnet) |
| `VITE_SPONSOR_URL` / `VITE_SPONSOR_TEXT` / `VITE_SPONSOR_LABEL` / `VITE_SPONSOR_CTA` | unset (off) | Static, zero-cookie `https://` sponsor banner rendered by `<SponsorSlot>` |
| `VITE_PARTNER_HARDWARE_URL` / `VITE_PARTNER_VPS_URL` | unset (off) | Optional `https://` hardware wallet & node VPS partner links on `/pricing` |

---

## KVP & RFC Standards Registry

> The `001`–`008` numbers belong to the companion **`RFC-001`–`RFC-008`** specs (ordered sequentially below); protocol proposals use **`KVP-101`–`KVP-106`** (plus **`KVP-20`** for fungible DEX pairs and **`PRO-21`** for canonical addresses).

| RFC | KVP | Name | Purpose / Surface |
| :--- | :--- | :--- | :--- |
| **`RFC-001`** | `KVP-101` | Multisig Wallets | M-of-N shared custody, spend proposals & partial signatures (`/multisig`) |
| **`RFC-002`** | `KVP-102` | Native Multi-Asset Tokens | On-chain fungible tokens (`5 KVNC` create), balances, transfers & AMM pools (`/multi-asset`, `/pools`, `/wallet`) |
| **`RFC-003`** | `KVP-103` | Stealth Addresses | Privacy-preserving one-time stealth addresses (`/stealth`) |
| **`RFC-004`** | `KVP-104` | HTLC Atomic Swaps | Hash Time-Locked Contracts with redeem/refund (`/htlc`, `/wallet/atomic-swap`) |
| **`RFC-005`** | `KVP-105` | Time-Lock Vaults | CLTV / CSV vaults & treasury vesting (`/vaults`) |
| **`RFC-006`** | — | Fee Floor & Wave B Base Fee | Atoms/byte fee floor + EIP-1559 dynamic base fee (`/api/fee_estimate`, `/api/base_fee`) |
| **`RFC-007`** | `KVP-106` | Real-World Assets (RWA) & Native NFTs | Institutional RWA (`kvp106:rwa:v1`, allowlist/freeze/coupons; `/rwa`, `/wallet/rwa-issue`, `/wallet/rwa-manage`) & Native NFTs (`/nft`) |
| **`RFC-008`** | — | On-Chain Name Registry | Human-readable name resolution (`NameRegistryClient`; intentionally holds no KVP #) |
| — | **`KVP-20`** | Fungible Contract Token | ERC-20-style `approve`/`transfer`/`transfer_from` for `/swap`, `/pools` (`kovanica-amm`) & wrapped bridge assets |
| — | **`PRO-21`** | Canonical Address Format | 64-char `kvnc` + 57 base32 + `dag` (Ed25519 + 29-bit BLAKE3 checksum) |

---

## Chain ID Registry

| Network | Chain ID | Canonical Network Tag | Address Policy | Live Status |
| :--- | :---: | :--- | :--- | :--- |
| **Mainnet** | `1` | `1-f35df34c92001436` | Strict PRO-21 (`kvnc…dag`) | Pre-launch (`1.1.2027`, read-only) |
| **Testnet** | `2` | `2-24cdb5fadd98b207` | Strict PRO-21 (`kvnc…dag` / `tknc…dag`) | **Live** (`https://rpc-testnet.kovanica.online/rpc`) |
| **Devnet** | `3` | Ephemeral `3-<16 hex>` | PRO-21 + legacy 64-hex | Local development only |

---

## Quick Start & Verification

```bash
# 1. Install dependencies from lockfile
npm ci

# 2. Run local development server
npm run dev

# 3. Run typecheck, strict lint (0 warnings), unit + Playwright tests, and build
npm run typecheck
npx eslint . --max-warnings 0
npm test
npm run build

# 4. Production VPS build (Nitro node-server preset, output in .output/)
npm run build:vps
```

---

## Ecosystem Repositories

| Repository | Role |
| :--- | :--- |
| **[BetterCallDzuks/kovanica-l1](https://github.com/BetterCallDzuks/kovanica-l1)** | Rust Layer-1 node, Hybrid PoW + GHOSTDAG consensus, Wasmi runtime, RPC, Stratum, Faucet, Indexer, Lightnode & CLI |
| **[BetterCallDzuks/kovanica-sdk](https://github.com/BetterCallDzuks/kovanica-sdk)** | Official TypeScript SDK (`v0.9.0`) — browser & Node.js client, failover transport, Wave A–D facades, offline codecs & air-gap envelopes |
| **[BetterCallDzuks/kovanica-web](https://github.com/BetterCallDzuks/kovanica-web)** | Public site, BlockDAG Explorer, AMM DEX, RWA Portal, Mining Pool, Faucet, API Reference & Pricing (`kovanica.online`) |
| **[BetterCallDzuks/kovanica-apps](https://github.com/BetterCallDzuks/kovanica-apps)** | Client apps — `wallet-web`, `browser-extension` (MV3 `window.kovanica`), `console-desktop`, `node-desktop`, `desktop`, Android & iOS |
| **[BetterCallDzuks/kovanica-playground](https://github.com/BetterCallDzuks/kovanica-playground)** | Interactive developer RPC console & 4-group `kovanica-sdk v0.9.0` studios |

Governance rules and full-scope plan: [`docs/AGENT-RULES.md`](https://github.com/BetterCallDzuks/kovanica-l1/blob/main/docs/AGENT-RULES.md) and [`docs/PLAN-FULL-SCOPE.md`](https://github.com/BetterCallDzuks/kovanica-l1/blob/main/docs/PLAN-FULL-SCOPE.md).
