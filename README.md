# kovanica-web

Public web application, BlockDAG Explorer, Wallet, Mining Pool portal, Faucet, and API Reference for the **Kovanica (KVNC)** Layer-1 blockchain — live at **[kovanica.online](https://kovanica.online)** (TanStack Start + Vite + Nitro 3).

> [!IMPORTANT]
> **Live Network Boundaries & Visual DNA:**
> - **Canonical Networks:** Mainnet (Chain ID `1`, frozen tag `1-f35df34c92001436`, launching `1.1.2027`, read-only pre-launch) and live Testnet (Chain ID `2`, frozen tag `2-24cdb5fadd98b207`, Hybrid PoW + GHOSTDAG `K=5`, `4s` target block time, `KovanicaHash`, zero stake on consensus).
> - **Brand Tokens (`src/styles.css`):** Ink (`--color-bg`), Paper (`--color-fg`), and Kovanica Copper/Gold (`--color-gold`).
> - **Zero Committed Secrets:** Runtime configuration is injected exclusively via environment variables (`KOVANICA_*`, `GROK_AUTH_*`, `GROK_PREVIEW_CLIENT_SECRET`); never commit hosts, IPs, ports, keys, or `.env` files.

---

## Features

1. **BlockDAG Explorer (`/explorer`):**
   - **Live DAG Visualization & Streaming:** Interactive GHOSTDAG canvas, WebSocket live head/leader stream with bounded exponential backoff & HTTP fallback, and `LiveDagDrawer` with real-time **Fee Pressure & 1.2x Buffered Fee** pill (`low` / `normal` / `elevated` / `congested`).
   - **Inline TxCard Bincode Decoder & Deep-Links:** Inline decoded Wasmi contract call arguments with 1-click **Decode Receipt Logs** and **Inspect Contract** links.
   - **Offline Universal Raw Wire Tx Decoder:** Decodes both native **Transfer** (`196` bytes, variant `0`) and Wasmi **Call** (variant `6`) raw wire transactions completely offline with PRO-21 address formatting and recognized contract argument decoding.
   - **Contract Inspector & Event Log Timeline:** Collapsible **Recent Contract Events** timeline (`kovanica_getLogs`) with topic/text filtering, inline Bincode decoding, and 1-click inspector deep-links.
   - **PRO-21 Address Checksum & Payload Inspector:** Validates 29-bit BLAKE3 checksums for `kvnc…dag` and `tknc…dag`, displays canonical Mainnet/Testnet forms + raw 32-byte payload hex, and provides 1-click copy.
   - **KovanicaHash Miner & Stratum TLS Command Builder:** Collapsible shell-safe `kovanica mine` CLI generator supporting Stratum TLS and Solo RPC modes across Testnet and Mainnet.
   - **Diagnostics Drawer & RPC Latency Sparkline:** Rolling 20-sample RPC latency ring buffer (`p50` / `p95` / `max` + SVG sparkline), sync-lag classification, and canonical network tag verification.

2. **Ecosystem Surfaces (`/faucet`, `/network`, `/pool`, `/api-reference`, `/wallet`, `/docs`):**
   - **Testnet Faucet (`/faucet`):** Fixed testnet dispense with live client-side **PRO-21 Pre-Flight Guard** (`2-24cdb5fadd98b207`), legacy 64-hex rejection on Chain 2, and cooldown countdown (`KOVANICA_FAUCET_URL` unset reports unavailable honestly).
   - **Network Status (`/network`):** Canonical Mainnet & Testnet identities, frozen consensus constants (`KovanicaHash`, `GHOSTDAG K=5`, `4s`), and ecosystem service readiness strip.
   - **Mining Pool Portal (`/pool`):** Frozen emission & Stratum TLS v1 operational spec strip (`2.5 KVNC`, `8,200,000` blocks/era, `3/4` decay, `3/4 burn / 1/4 miner`, adaptive VarDiff, graceful `client.reconnect` drain).
   - **API Reference (`/api-reference`):** Canonical HTTP identity headers (`X-Kovanica-Chain-Id`, `X-Kovanica-Network-Tag`, `X-Kovanica-Rpc-Version`), `kovanica_mempoolStats` fee-percentile schema, and copyable JSON-RPC 2.0 batch `curl -i` quick-reference.
   - **Web Wallet & Assets (`/wallet`, `/download`, `/docs`):** Browser wallet powered by vendored `@kovanica/sdk-wasm` (`vendor/kovanica-sdk-wasm`), release downloads, and in-app release notes (`src/lib/content/whats-new.ts`).

---

## Chain ID Registry

| Network | Chain ID | Canonical Network Tag | Address Policy | Live Status |
| :--- | :---: | :--- | :--- | :--- |
| **Mainnet** | `1` | `1-f35df34c92001436` | Strict PRO-21 (`kvnc…dag`) | Pre-launch (`1.1.2027`, read-only) |
| **Testnet** | `2` | `2-24cdb5fadd98b207` | Strict PRO-21 (`kvnc…dag` / `tknc…dag`) | **Live** (`v0.3.0-node`) |
| **Devnet** | `3` | Ephemeral `3-<16 hex>` | PRO-21 + legacy 64-hex | Local development only |

---

## Quick Start & Verification

```bash
# 1. Install dependencies from lockfile
npm ci

# 2. Run local development server
npm run dev

# 3. Run typecheck, strict lint (0 warnings), unit + Playwright E2E tests, and build
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
| **[BetterCallDzuks/kovanica-sdk](https://github.com/BetterCallDzuks/kovanica-sdk)** | Official TypeScript SDK (`v0.5.0`) — browser & Node.js client, failover transport, facades, offline codecs & air-gap envelopes |
| **[BetterCallDzuks/kovanica-web](https://github.com/BetterCallDzuks/kovanica-web)** | Public site, BlockDAG Explorer, Faucet, Pool portal & API Reference (`kovanica.online`) |
| **[BetterCallDzuks/kovanica-apps](https://github.com/BetterCallDzuks/kovanica-apps)** | Client apps — `wallet-web`, `console-desktop`, `node-desktop`, `desktop`, Android & iOS |
| **[BetterCallDzuks/kovanica-playground](https://github.com/BetterCallDzuks/kovanica-playground)** | Interactive developer RPC console & 7 `kovanica-sdk v0.5.0` studios |

Governance rules and full-scope plan: [`docs/AGENT-RULES.md`](https://github.com/BetterCallDzuks/kovanica-l1/blob/main/docs/AGENT-RULES.md) and [`docs/PLAN-FULL-SCOPE.md`](https://github.com/BetterCallDzuks/kovanica-l1/blob/main/docs/PLAN-FULL-SCOPE.md).
