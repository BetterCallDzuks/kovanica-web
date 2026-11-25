# Kovanica Ecosystem Domain, Subdomain, Route & Link Map

> Exhaustive inventory of all domains, subdomains, internal routes, `/api/*` endpoints, and external links across `kovanica-web`, `kovanica-apps`, `kovanica-playground`, and live `https://kovanica.online` (live probes recorded `2026-11-25T05:29–05:32Z`; updated for **M1-A** on `kovanica-web` branch `feat/reorganize-simplify-web-ux`).

## Status Legend

| Classification | Meaning |
|---|---|
| `OK` | Resolves and behaves as intended across code and live targets. |
| `FIXED_IN_M1A` | Previously broken, missing, or inconsistent in `kovanica-web` and resolved in M1-A (local repo commit on `feat/reorganize-simplify-web-ux`; live deployment pending PR/deploy). |
| `BROKEN` | Live target returns HTTP 404, DNS NXDOMAIN (`curl (6)`), TLS SAN mismatch (`curl (60)`), or client/server contract failure. |
| `MISSING_TARGET` | Referenced internal route, `/api/*` endpoint, cross-subdomain nav target, or GitHub release/org target does not exist or is unreachable (orphaned). |
| `PLACEHOLDER` | Disabled, stub, example, or pre-launch target (`mainnet.kovanica.online`, `pool.kovanica.online`, `relay*.kovanica.online`, `indexer.kovanica.online`, `/nft`). |
| `INCONSISTENT` | Points to wrong subdomain, old GitHub org (`KovanicaDAG` vs `BetterCallDzuks`), wrong TLD (`.org` vs `.online`), or diverges across surfaces. |

---

## 1. Live `kovanica.online` Domains, Subdomains & Edge Probes

| Target | Live Probe (`2026-11-25`) | Type | Status | Remediation & Ownership |
|---|---|---|---|---|
| `https://kovanica.online/` | `200` (`HomeLanding`) | Apex Domain | `OK` | **M1-C**: Streamline `HomeLanding` hierarchy while preserving `#09090b`, `#F2A900`, `Fraunces`. |
| `https://www.kovanica.online/` | `301` → `https://kovanica.online/` | Subdomain Redirect | `OK` | Edge redirect to apex works. |
| `https://testnet.kovanica.online/` | `200` (`HomeTestnet`) | Primary Testnet Portal | `OK` | **M1-C**: Categorize `QUICK` grid to surface DeFi/RWA/Tools in 1 click. |
| `https://mainnet.kovanica.online/` | `curl (60)` TLS SAN mismatch | Mainnet Launching Gate | `BROKEN` (live TLS) / `PLACEHOLDER` (1.1.2027) | `FIXED_IN_M1A` (UI clarity): Added `SURFACE_STATUS.mainnet` (`"Mainnet (Launching)"`) in `surfaces.ts`, updated `mainnet-launching.tsx`, `network.ts`, `source-switch.tsx`. **Out-of-Scope (DNS/TLS)**: Edge TLS SAN provisioning. |
| `https://explorer.kovanica.online/` | `200` serves `/` `HomeTestnet` instead of `/explorer` | Subdomain Host | `INCONSISTENT` → `FIXED_IN_M1A` (app routing) | `FIXED_IN_M1A`: Added `"explorer"` role in `host.ts` + `/` → `/explorer` redirect in `__root.tsx`; added `SURFACE.explorer = "https://testnet.kovanica.online/explorer"` (kept `LIVE_EXPLORER = "https://explorer.kovanica.online"` in `networkConstants.ts` / `upstream.server.ts` as server proxy origin). |
| `https://wallet.kovanica.online/` | `302` → `https://testnet.kovanica.online/wallet/` | Subdomain Host | `OK` (redirect) / `INCONSISTENT` (vs `wallet-web`) | `FIXED_IN_M1A`: Added `"wallet"` role in `host.ts` + `/` → `/wallet` redirect in `__root.tsx`; added `SURFACE.wallet = "https://testnet.kovanica.online/wallet"`. **M2**: Cross-link `kovanica-apps/wallet-web`. |
| `https://map.kovanica.online/` | `200` serves `/` `HomeTestnet` instead of `/map` | Subdomain Host | `INCONSISTENT` → `FIXED_IN_M1A` (app routing) | `FIXED_IN_M1A`: Added `"map"` role in `host.ts` + `/` → `/map` redirect in `__root.tsx`. |
| `https://faucet.kovanica.online/` | `200` serves `/` `HomeTestnet` instead of `/faucet` | Subdomain Host | `INCONSISTENT` → `FIXED_IN_M1A` (app routing) | `FIXED_IN_M1A`: Added `"faucet"` role in `host.ts` + `/` → `/faucet` redirect in `__root.tsx`. |
| `https://api.kovanica.online/` | `curl (6)` DNS NXDOMAIN | Dead Subdomain | `BROKEN` → `FIXED_IN_M1A` (code refs) | `FIXED_IN_M1A`: Replaced `api.kovanica.online` links/eyebrows/specs in `surfaces.ts`, `network.ts`, `rpc-spec.ts`, `docs-view.tsx`, `api-reference-view.tsx`, `mainnet-launching.tsx` with `https://testnet.kovanica.online/api-reference` and `https://rpc-testnet.kovanica.online/rpc` (kept `hostRoleFromHost` `"api"` match in `host.ts` for security-header tests). **Out-of-Scope (DNS/TLS)**: DNS record provisioning. |
| `https://docs.kovanica.online/` | `307` → `/docs` (`200`) | Docs Subdomain | `OK` | `FIXED_IN_M1A`: Updated sidebar API link label and `BetterCallDzuks/kovanica-l1` text in `docs-view.tsx`. **M1-C**: Layout audit. |
| `https://playground.kovanica.online/` | `307` → `/playground` (`200`) | Built-in Playground | `INCONSISTENT` (distinct from `kovanica-playground` repo) | `FIXED_IN_M1A`: Added `SURFACE.playground` and updated `playground-onboarding.tsx` wallet link + `snippets.tsx` / `api-console.tsx`. **M1-B**: Add ecosystem links in `PlaygroundChrome`. **M3**: Cross-link standalone `kovanica-playground`. |
| `https://dash.kovanica.online/` | `307` → `/dash` (`200`) | Dashboard Subdomain | `OK` | `FIXED_IN_M1A`: Updated "Open wallet" CTA in `dashboard.tsx:393` to `SURFACE.wallet`. |
| `https://rpc-testnet.kovanica.online/rpc` | `POST /rpc` `200` JSON-RPC 2.0 (Chain 2); `GET /` `404` | Public Testnet RPC | `OK` (`POST /rpc`) | `FIXED_IN_M1A`: Standardized `rpc-spec.ts`, `surfaces.ts` (`rpcTestnet`), `contract-inspector-panel.tsx`, `dry-run.ts` to `https://rpc-testnet.kovanica.online/rpc`. **M2/M3**: Align `wallet-web`, `browser-extension`, `kovanica-playground`. |
| `https://rpc.kovanica.online/` & `/rpc` | `GET /` serves Testnet HTML; `POST /rpc` `404` | Mainnet RPC (Pre-launch) | `INCONSISTENT` / `BROKEN` | **Out-of-Scope (DNS/TLS/L1)**: Mainnet RPC opens at `1.1.2027`; keep preset labeled Mainnet / Read-only. |
| `https://apps.kovanica.online/` | `curl (6)` DNS NXDOMAIN | Unprovisioned Subdomain | `MISSING_TARGET` | **Out-of-Scope (DNS/TLS)**: Not provisioned; not linked in `kovanica-web`. |
| `https://pool.kovanica.online/` | `curl (6)` DNS NXDOMAIN | Example Stratum Pool | `PLACEHOLDER` / `BROKEN` (DNS) | `FIXED_IN_M1A` (UX note): Kept test-compatible `pool.kovanica.online:3333` defaults in `miner-command.ts`; added explicit placeholder note in `miner-command-builder.tsx` when `mode === "stratum"`. **Out-of-Scope (DNS/TLS)**. |
| `https://seed1.kovanica.online/` | P2P TCP `:8000` live; HTTPS `/` `404` | P2P Bootstrap Seed | `OK` (TCP P2P) | Preserved `seed1.kovanica.online:8000`. |
| `https://seed2.kovanica.online/` | `curl (6)` DNS NXDOMAIN | Secondary Seed | `MISSING_TARGET` | Referenced only in test fixtures; **Out-of-Scope (DNS/TLS)**. |
| `https://relay1.kovanica.online/`, `relay2.kovanica.online` | `curl (6)` DNS NXDOMAIN | Relay Placeholders | `PLACEHOLDER` | `FIXED_IN_M1A` (`.org` → `.online`): `ledger/engine.ts:73-74` normalized from `.kovanica.org` to `.kovanica.online` (`dry-run.ts` already `.online`). |
| `https://indexer.kovanica.online/` | `curl (6)` DNS NXDOMAIN | Optional Indexer URL | `PLACEHOLDER` | **M2**: Clarify optional placeholder in `kovanica-apps/wallet-web`. |
| `https://kovanica.online/download/install.sh` | `302` → `404` (`KovanicaDAG/v0.3.0-node`) | Download Redirect | `BROKEN` → `FIXED_IN_M1A` (code) | `FIXED_IN_M1A`: `src/routes/download/$.ts` now redirects `install.sh` to `https://raw.githubusercontent.com/BetterCallDzuks/kovanica-l1/main/node/scripts/install.sh` and node archive paths to `https://github.com/BetterCallDzuks/kovanica-l1/releases`. *(Note: `kovanica-l1/node/scripts/install.sh:50` still has `REPO="KovanicaDAG/kovanica-l1"` — **Out-of-Scope (L1)**.)* |
| `https://testnet.kovanica.online/download/install.sh` | Static nginx file (`200`) bypassing Nitro | Static Edge File | `INCONSISTENT` | **Out-of-Scope (DNS/TLS)**: Static VPS nginx file; Nitro `/download/$` fixed in M1-A. |
| `https://kovanica.online/sitemap.xml` | `404` | Sitemap | `MISSING_TARGET` | **Out-of-Scope (Ops/SEO)**. |
| `https://kovanica.online/robots.txt` | `200` | Robots | `OK` | Served at edge. |
| `https://kovanica.online/{swap,pools,rwa}` | `200` on apex without testnet redirect | Apex vs Testnet Parity | `INCONSISTENT` | **M1-B**: Unify `<Shell>` chrome and ecosystem navigation across all app routes. |

---

## 2. `kovanica-web` External Links, Endpoints, Host Routing & Tailwind v4 Fixes

| Target / Pattern | Source (`File:Line`) | Baseline Status | M1-A Resolution / Current Status |
|---|---|---|---|
| `https://github.com/KovanicaDAG` | `landing-chrome.tsx:38,84`, `cta-row.tsx:10`, `about.ts:25` | `BROKEN` (`404`) | `FIXED_IN_M1A`: Updated to `SURFACE.github` / `https://github.com/BetterCallDzuks`. |
| `KovanicaDAG/kovanica-l1` prose & spec | `docs-view.tsx:326`, `networkConstants.ts:468`, `api/spec.ts:164` | `INCONSISTENT` | `FIXED_IN_M1A`: Updated to `BetterCallDzuks/kovanica-l1` and accurate `/download/install.sh` + Releases wording. |
| `/download/$` (`KovanicaDAG` + missing `v0.3.0-node` release) | `routes/download/$.ts:5-16` | `BROKEN` (`404`) | `FIXED_IN_M1A`: `install.sh` → `BetterCallDzuks/kovanica-l1/main/node/scripts/install.sh`; Linux x64/arm64 + genesis → `BetterCallDzuks/kovanica-l1/releases`. |
| `GET /api/download/install.sh` | `networkConstants.ts:381`, `api/spec.ts:76` | `MISSING_TARGET` | `FIXED_IN_M1A`: Fixed to `GET /download/install.sh`. |
| `https://x.com/KovanicaDAG`, `https://x.com/BetterCallDzuks` | `landing-chrome.tsx:68,76`, `about.ts:35,36`, `mainnet-launching.tsx:78,81` | `OK` | Preserved (`HTTP 200`). |
| `seed1.kovanica.online:8000` | `public-config.ts:12`, `docs-view.tsx:333`, `api/spec.ts:150`, `network-view.tsx:213`, `roadmap-view.tsx:194` | `OK` | Preserved (TCP P2P seed). |
| `https://api.kovanica.online` links/eyebrows | `surfaces.ts:13`, `network.ts:52`, `docs-view.tsx:109-112`, `api-reference-view.tsx:94`, `mainnet-launching.tsx:75-76` | `BROKEN` (NXDOMAIN) | `FIXED_IN_M1A`: `SURFACE.api` & `API_PUBLIC` → `https://testnet.kovanica.online/api-reference`; `docs-view.tsx` label → `API Reference →`; `api-reference-view.tsx` eyebrow → `API Reference · kovanica-testnet`; `mainnet-launching.tsx` footer label → `api reference`. |
| `https://api.kovanica.online/rpc` | `lib/api/rpc-spec.ts:26` | `BROKEN` (NXDOMAIN) | `FIXED_IN_M1A`: `DEFAULT_TESTNET_RPC_URL` → `https://rpc-testnet.kovanica.online/rpc`. |
| `https://testnet.kovanica.online/rpc` | `contract-inspector-panel.tsx:229`, `contracts/dry-run.ts:1182,1232,1472` | `INCONSISTENT` | `FIXED_IN_M1A`: Updated to `DEFAULT_TESTNET_RPC_URL` / `"https://rpc-testnet.kovanica.online/rpc"`. |
| `LIVE_EXPLORER = "https://explorer.kovanica.online"` | `networkConstants.ts:5,20-21`, `upstream.server.ts:2,19` | `OK` (proxy origin) | Intentionally preserved (`fetchUpstream` appends `/api/...` to `LIVE_EXPLORER`). |
| `https://testnet.kovanica.online` ("Open wallet") | `dashboard.tsx:393`, `playground-onboarding.tsx:40` | `INCONSISTENT` | `FIXED_IN_M1A`: Updated to `SURFACE.wallet` (`https://testnet.kovanica.online/wallet`). |
| `https://explorer.kovanica.online/api/*` | `playground/snippets.tsx:14,17,20,25,30,43,52` | `INCONSISTENT` | `FIXED_IN_M1A`: Updated to `https://testnet.kovanica.online/api/...` and replaced `/api/network`, `/api/tx/:id`, `/api/block/:id` with implemented endpoints. |
| `https://relay1.kovanica.org`, `relay2.kovanica.org`, `dev@kovanica.org` | `ledger/engine.ts:73-74`, `trezor-provider.ts:107` | `INCONSISTENT` (`.org`) | `FIXED_IN_M1A`: Updated to `.online` (`relay1.kovanica.online`, `relay2.kovanica.online`, `dev@kovanica.online`). |
| `stratum+tls://pool.kovanica.online:3333` | `miner-command.ts:39,47,198`, `miner-command-builder.tsx:296,307` | `PLACEHOLDER` / `BROKEN` (DNS) | `FIXED_IN_M1A`: Kept test-compatible `MINER_NETWORK_SPECS` defaults; added explicit Stratum placeholder note in `miner-command-builder.tsx`. |
| `Host` port normalization | `src/lib/host.ts:9,33` | `INCONSISTENT` (edge case) | `FIXED_IN_M1A`: Strip optional `:port` and trailing `.` in `networkFromHost` and `hostRoleFromHost`. |
| `SURFACE` missing keys | `src/lib/surfaces.ts:8-26` | `INCONSISTENT` | `FIXED_IN_M1A`: Added `playground`, `explorer`, `wallet`, `pools`, `rpcTestnet`, `github`, and `SURFACE_STATUS.mainnet`. |
| Unshaded Tailwind v4 tokens (`emerald`, `purple`, `amber`, `violet`) & `bg-surface-1` | 17 files (`swap.tsx`, `pools.tsx`, `rwa.tsx`, `rwa-manage.tsx`, `rwa-issue.tsx`, `ecosystem-tools.tsx`, `multi-asset-view.tsx`, `wallet-view.tsx`, `asset-picker.tsx`, `ipfs-upload.tsx`, `explorer/rwa.$assetId.tsx`, `wallet/nft.$assetId.tsx`, `wallet/collection.$collectionId.tsx`, `atomic-swap-view.tsx`, `snippets.tsx`, `api-console.tsx`, `playground-onboarding.tsx`) | `BROKEN` (0 CSS generated) | `FIXED_IN_M1A`: Replaced all 17 files with valid shaded Tailwind v4 palette classes (`*-400`, `*-500/*`, `*-600`) and `@theme` `bg-surface`. |
| `https://api.ipfs.io/api/v0/add`, `ipfs.io/ipfs/...`, `cloudflare-ipfs.com`, `gateway.pinata.cloud` | `ipfs-upload.tsx`, `rwa/metadata.ts`, `explorer/rwa.$assetId.tsx` | `OK` | Preserved (CSP-allowed). |
| `https://kovanica.online` Trezor `appUrl` | `trezor-provider.ts:108` | `OK` | Preserved. |
| `vendor/kovanica-sdk-wasm/package.json:9` (`github.com/KovanicaDAG/kovanica`) | Vendored WASM metadata | `INCONSISTENT` | **Out-of-Scope (SDK/Vendor)**. |

---

## 3. `kovanica-web` Internal Routes (37 Routes)

All app, DeFi, RWA, wallet, mining, docs, and pricing routes now wrap in the unified `<Shell>` (`src/components/layout/shell.tsx`) with **5 pure function tabs** (`Explore · Trade · Assets · Wallet · Build`), contextual sub-navigation on Trade/Assets/Wallet routes, and zero orphaned routes (`tests/m1bc-shell-and-routes.test.ts`).

| Route Path | File | Chrome | Nav Group & Status | Notes |
|---|---|---|---|---|
| `/` | `routes/index.tsx` | Role-based (`LandingChrome` / `PlaygroundChrome` / `Shell`) | `DEPLOYED` | `HomeLanding` (apex) & `HomeTestnet` (reuses `NAV_GROUPS`). |
| `/explorer` | `routes/explorer.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Collapsible telemetry strip + all 8 tabs & drawers. |
| `/explorer/rwa/$assetId` | `routes/explorer/rwa.$assetId.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Deep-linked from `/rwa`. |
| `/network` | `routes/network.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Peers, seeds & sync telemetry. |
| `/pool` | `routes/pool.tsx` | `Shell` | **Explore** (`DEPLOYED` — PR #34) | **Stratum V1 TLS Mining Pool** (`MinerCommandBuilder` + Stratum TLS spec + pool fee badge). |
| `/map` | `routes/map.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Global origin pulse choropleth. |
| `/dash` | `routes/dash.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Network overview dashboard. |
| `/roadmap` | `routes/roadmap.tsx` | `Shell` | **Explore** (`DEPLOYED`) | Protocol milestones & RFCs. |
| `/swap` | `routes/swap.tsx` | `Shell` | **Trade** (`DEPLOYED`) | Native AMM Swap + Wave A batch + configurable interface fee row. |
| `/pools` | `routes/pools.tsx` | `Shell` | **Trade** (`DEPLOYED` — PR #34) | **AMM Liquidity Pools** (add/remove liquidity + on-chain KVP-102 `PoolView` quote calculator). |
| `/wallet/dex` | `routes/wallet/dex.tsx` | `Shell` (via parent `wallet.tsx`) | **Trade** (`DEPLOYED`) | On-chain orderbook DEX. |
| `/wallet/atomic-swap` | `routes/wallet/atomic-swap.tsx` | `Shell` (via parent `wallet.tsx`) | **Trade** (`DEPLOYED`) | Cross-chain HTLC swaps. |
| `/rwa` | `routes/rwa.tsx` | `Shell` | **Assets** (`DEPLOYED`) | Public KVP-106 RWA Registry linking into `/explorer/rwa/$assetId`. |
| `/wallet/rwa-issue` | `routes/wallet/rwa-issue.tsx` | `Shell` (via parent `wallet.tsx`) | **Assets** (`DEPLOYED`) | Deterministic KVP-106 issuance (`/api/rwa/derive`) + SPA `<Link to="/wallet">`. |
| `/wallet/rwa-manage` | `routes/wallet/rwa-manage.tsx` | `Shell` (via parent `wallet.tsx`) | **Assets** (`DEPLOYED`) | Allowlist, freeze & coupon scheduler. |
| `/multi-asset` | `routes/multi-asset.tsx` | `Shell` | **Assets** (`DEPLOYED`) | KVP-102 token balances & transfers. |
| `/nft` | `routes/nft.tsx` | `Shell` | **Assets** (`DEPLOYED`) | KVP-106 non-fungible assets. |
| `/wallet/token-listings` | `routes/wallet/token-listings.tsx` | `Shell` (via parent `wallet.tsx`) | **Assets** (`DEPLOYED`) | Token registry submissions. |
| `/wallet/collection/$collectionId` | `routes/wallet/collection.$collectionId.tsx` | `Shell` (via parent `wallet.tsx`) | **Assets** (`DEPLOYED`) | KVP-106 collection detail. |
| `/wallet/nft/$assetId` | `routes/wallet/nft.$assetId.tsx` | `Shell` (via parent `wallet.tsx`) | **Assets** (`DEPLOYED`) | KVP-106 NFT detail. |
| `/wallet` | `routes/wallet.tsx` | `Shell` | **Wallet** (`DEPLOYED`) | PRO-21 vault, hardware & sends (parent layout for `/wallet/*` with `ShellContext` guard). |
| `/faucet` | `routes/faucet.tsx` | `Shell` | **Wallet** (`DEPLOYED`) | Testnet KVNC faucet + PRO-21 pre-flight guard + zero-cookie `<SponsorSlot>`. |
| `/wallet/airdrops` | `routes/wallet/airdrops.tsx` | `Shell` (via parent `wallet.tsx`) | **Wallet** (`DEPLOYED`) | Batch token distribution. |
| `/wallet/coinjoin` | `routes/wallet/coinjoin.tsx` | `Shell` (via parent `wallet.tsx`) | **Wallet** (`DEPLOYED`) | Collaborative privacy rounds. |
| `/wallet/ecosystem-tools` | `routes/wallet/ecosystem-tools.tsx` | `Shell` (via parent `wallet.tsx`) | **Wallet** (`DEPLOYED`) | Scheduler, bridge & passkeys. |
| `/multisig` | `routes/multisig.tsx` | `Shell` | **Build** (`DEPLOYED`) | M-of-N shared custody. |
| `/htlc` | `routes/htlc.tsx` | `Shell` | **Build** (`DEPLOYED`) | Hash Time-Locked Contracts. |
| `/vaults` | `routes/vaults.tsx` | `Shell` | **Build** (`DEPLOYED`) | Time-locked vaults (CLTV / CSV). |
| `/stealth` | `routes/stealth.tsx` | `Shell` | **Build** (`DEPLOYED`) | KVP-103 one-time addresses. |
| `/docs` | `routes/docs.tsx` | `Shell` | **Build** (`DEPLOYED`) | Protocol specs, CLI cheatsheet & ecosystem services links. |
| `/api-reference` | `routes/api-reference.tsx` | `Shell` | **Build** (`DEPLOYED`) | JSON-RPC 2.0 & HTTP contract. |
| `/playground`, `/playground/api-console`, `/playground/snippets` | `routes/playground*.tsx` | `PlaygroundChrome` | **Build** (`DEPLOYED`) | Onboarding, API console, snippets + Ecosystem Switcher. |
| `/pricing` | `routes/pricing.tsx` | `Shell` | **Build** (`DEPLOYED` — PR #35) | Services & Pricing hub (6 non-token revenue streams) + `POST /api/inquiries` intake + `<SponsorSlot>`. |
| `/api/$` | `routes/api/$.ts` | Server handler | `DEPLOYED` | Includes `/api/rwa/derive`, `/api/supply`, `/api/submit_tx`, and `/api/inquiries`. |
| `/download/$` | `routes/download/$.ts` | Server handler | `DEPLOYED` | `BetterCallDzuks/kovanica-l1` + `Object.hasOwn` prototype guard. |

---

## 4. `/api/*` & Legacy Endpoint Audit (`dispatch.server.ts` vs Callers & `endpoints.ts`)

### 4.1 Implemented & M1-A Added Handlers (`src/lib/api/dispatch.server.ts`)

| Endpoint | Method | Source Support | Behavior / Notes | Status |
|---|---|---|---|---|
| `/api/spec` | `GET` | `testnet`, `mainnet`, `local` | Returns plain-text protocol spec (`GET /download/install.sh` + `BetterCallDzuks/kovanica-l1` fixed). | `OK` (`FIXED_IN_M1A`) |
| `/api/inquiries` | `POST` | `testnet`, `mainnet`, `local` | **Added in PR #35**: Validated, honeypot-protected, rate-limited lead intake for RPC tiers, RWA SaaS, verified listings, sponsorships & enterprise support; persists to `KOVANICA_INQUIRIES_FILE` (`data/inquiries.jsonl`). `405` on non-POST. | `DEPLOYED` |
| `/api/health` | `GET` | `testnet` | Liveness probe against `rpcOrigin()/health`. | `OK` |
| `/api/head`, `/api/bootstrap`, `/api/state`, `/api/utxos`, `/api/history`, `/api/fee_estimate` | `GET` | `testnet`, `local` | Live JSON-RPC proxy (`testnet`) or in-memory node (`local`); `mainnet` returns `503`. | `OK` |
| `/api/supply` | `GET` | `testnet`, `local` | **Added in M1-A**: Queries `kovanica_syncStatus` + `probeHealth()` on `testnet` (returns live `blocks` + canonical supply constants with `null` for unexposed `circulating`/`burned`/`native_minted`; `502`/`503` when `kovanica_syncStatus` RPC itself fails or returns `503`, and `200` with `health.state: "stalled"` / `health.status: 503` when `/health` is `503` while `kovanica_syncStatus` returns `200`, matching `/api/head`, `/api/bootstrap`, and `/api/state`; `405` on non-GET) and `localState().node` on `local`. `mainnet` returns `503`. | `FIXED_IN_M1A` |
| `/api/fee_schedule`, `/api/base_fee`, `/api/storage_deposit` | `GET` | `testnet` | Proxies `kovanica_getFeeSchedule`, `kovanica_getBaseFee`, `kovanica_getStorageDeposit` with canonical constant fallback. | `OK` |
| `/api/contract_call`, `/api/contract_storage`, `/api/contract_receipt` | `POST` | `testnet`, `local` | Read-only Wasmi contract simulation / storage / receipt inspection (`405` on non-POST). | `OK` |
| `/api/rwa/derive` | `POST` | `testnet`, `local` | **Added in M1-A**: Exact KVP-106 `blake3("kvp106:rwa:v1" \|\| issuer32 \|\| 0x00 \|\| asset_class \|\| 0x00 \|\| unique_id \|\| u32_le(version))` matching `kovanica-l1/crates/kovanica-rwa/src/lib.rs:39-54` (untrimmed `unique_id` bytes and mixed query + JSON body support). Returns `{ asset_id, asset_id_kvnc }`; validates inputs (`400`), `405` on non-POST, `403` on `mainnet`. | `FIXED_IN_M1A` |
| `/api/rwa/registry`, `/api/rwa/list`, `/api/rwa/compliance/{id}`, `/api/rwa/mint`, `/api/rwa/{id}` | `GET`/`POST` | `testnet` | RWA registry, compliance lookup, prepared mint, detail lookup. | `OK` |
| `/api/collection/{id}`, `/api/nft/{id}` | `GET` | `testnet` | KVP-106 collection and NFT detail lookups (`400`/`404`/`501`/`502`/`503`). | `OK` |
| `/api/tokens`, `/api/pools`, `/api/token_prepare`, `/api/token_submit` | `GET`/`POST` | `testnet` | KVP-102 tokens, AMM pools, token transfer prepare/submit. | `OK` |
| `/api/faucet`, `/api/prepare`, `/api/submit` | `GET`/`POST` (`testnet`), `POST`-only (`local`) | `testnet`, `local` | Faucet dispense and native prepare/submit (`mainnet` `403`). On `local`, only `POST` is wired (`GET /api/faucet?source=local`, `GET /api/prepare?source=local`, and `GET /api/submit?source=local` return `404`). | `OK` |
| `/api/submit_tx` | `POST` | `testnet`, `local` | **Added in M1-A**: Accepts `{ tx_hex }`, validates non-empty even-length hex (`400`), forwards to `kovanica_sendRawTransaction([cleanHex])` on `testnet` (maps public RPC `401` → `403`) or `localSubmitTx(cleanHex)` on `local` (decodes native transfer or queues raw tx in local mempool), `405` on non-POST, `403` on `mainnet`. | `FIXED_IN_M1A` |
| `/api/origins`, `/api/p2p`, `/api/blocks`, `/api/produce`, `/api/mine`, `/api/mining`, `/api/miner`, `/api/reset`, `/api/origin` | `GET`/`POST` | `local` (`403` for `reset`/`mine`/`mining` on `testnet`) | Local mock playground / node operations (`testnet` falls through to `local` for `origins`/`p2p`/`blocks`/`produce`/`origin` when not blocked). | `OK` (local) |

### 4.2 Legacy & Unimplemented `/api/*` Endpoints (Left Unstubbed in M1-A)

All 21 legacy protocol endpoints below (plus `/api/rtc` and unimplemented `endpoints.ts` catalog entries) have **no** underlying L1 node HTTP/RPC handlers and are intentionally left unstubbed in `dispatch.server.ts` (no fake handlers or unsafe key custody invented):

| Endpoint | Caller / Reference (`File:Line`) | Current `dispatch.server.ts` Behavior | Classification | Notes |
|---|---|---|---|---|
| `GET /api/dex/tokens` | `token-listings-view.tsx:47` | `404 not found` | `MISSING_TARGET` | Legacy DEX price/volume indexer absent on L1; AMM moved to `/swap` & `/pools`. |
| `POST /api/dex/trade` | `token-listings-view.tsx:67` | `400 unknown action dex` | `MISSING_TARGET` | Legacy DEX order endpoint absent on L1. |
| `POST /api/htlc/prepare` | `dex-view.tsx:142`, `atomic-swap-view.tsx:194,282` | `400 unknown action htlc` | `MISSING_TARGET` | L1 uses contract calls (`htlc_create`) via Wasmi, not legacy script REST. |
| `POST /api/htlc/finalize` | `dex-view.tsx:153,196,241`, `atomic-swap-view.tsx:211,294,334,373,415`, `token-listings-view.tsx:76` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC script finalizer absent. |
| `POST /api/htlc/spend` | `dex-view.tsx:185,231`, `atomic-swap-view.tsx:323,362,405` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC spend builder absent. |
| `POST /api/htlc/status` | `atomic-swap-view.tsx:234,253` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC status scanner absent. |
| `POST /api/htlc/create` | `lib/protocol/htlc.ts:39` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC helper absent. |
| `POST /api/htlc/redeem` | `lib/protocol/htlc.ts:82` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC helper (note: posts `receiver_secret_hex`). |
| `POST /api/htlc/refund` | `lib/protocol/htlc.ts:101` | `400 unknown action htlc` | `MISSING_TARGET` | Legacy HTLC helper (note: posts `sender_secret_hex`). |
| `POST /api/vault/create` | `lib/protocol/vaults.ts:42` | `400 unknown action vault` | `MISSING_TARGET` | Legacy vault REST absent (L1 uses Wasmi `kovanica-vault`). |
| `GET /api/vault/status` | `lib/protocol/vaults.ts:70` | `404 not found` | `MISSING_TARGET` | Legacy vault status REST absent. |
| `POST /api/vault/claim` | `lib/protocol/vaults.ts:79` | `400 unknown action vault` | `MISSING_TARGET` | Legacy vault claim REST absent (note: optional `beneficiary_secret_hex`). |
| `POST /api/stealth/create` | `lib/protocol/stealth.ts:36` | `400 unknown action stealth` | `MISSING_TARGET` | Legacy stealth REST absent. |
| `POST /api/stealth/derive` | `lib/protocol/stealth.ts:58` | `400 unknown action stealth` | `MISSING_TARGET` | Legacy stealth derive REST absent. |
| `POST /api/stealth/probe` | `lib/protocol/stealth.ts:86` | `400 unknown action stealth` | `MISSING_TARGET` | Legacy stealth probe REST absent. |
| `POST /api/airdrop/prepare-claim` | `airdrops-view.tsx:155` | `400 unknown action airdrop` | `MISSING_TARGET` | Legacy Merkle airdrop prepare REST absent. |
| `POST /api/airdrop/finalize-claim` | `airdrops-view.tsx:167` | `400 unknown action airdrop` | `MISSING_TARGET` | Legacy Merkle airdrop finalize REST absent. |
| `POST /api/coinjoin/prepare` | `coinjoin-view.tsx:91` | `400 unknown action coinjoin` | `MISSING_TARGET` | Legacy CoinJoin coordinator REST absent. |
| `POST /api/coinjoin/submit` | `coinjoin-view.tsx:115` | `400 unknown action coinjoin` | `MISSING_TARGET` | Legacy CoinJoin submit REST absent. |
| `POST /api/multisig/create`, `/build`, `/sign`, `/combine`, `/submit` | `lib/wallet/multisig.ts:43,66,109,118`, `lib/api/endpoints.ts:81-85` | `400 unknown action multisig` | `MISSING_TARGET` | Legacy multisig REST absent (L1 uses Wasmi `kovanica-multisig`; `sign` in `endpoints.ts:83` has no client caller). |
| `GET`/`POST /api/rtc` | `lib/multiplayer/p2p.ts:141,195,451` | `404` / `400 unknown action rtc` | `MISSING_TARGET` | WebRTC signaling handler absent. |
| `GET /api/block/{id}`, `/api/tx/{id}`, `/api/address/{addr}`, `/api/light_proof`, `/api/light_sync` | `lib/api/endpoints.ts:14-21,44-45,100` | `404 not found` | `MISSING_TARGET` | Cataloged in `endpoints.ts` (`PLAYGROUND_ENDPOINTS` includes `/api/block/{id}`) without `dispatch.server.ts` handlers; `snippets.tsx` & `api-console.tsx` dead `/api/network`, `/api/tx/:id`, `/api/block/:id` refs were replaced in M1-A. |

---

## 5. `kovanica-apps` (`wallet-web`, `browser-extension`, `console-desktop`) — Parallel M2 Branch (`feat/simplify-ux-and-links`)

> Tracked on parallel M2 branch `feat/simplify-ux-and-links` per `PROJECT.md`; baseline survey findings below remain outside M1-A `kovanica-web` verification scope.

| Target / Pattern | Source (`File:Line`) | Status | Planned Remediation |
|---|---|---|---|
| `http://127.0.0.1:8545` default `rpcUrl` for Chain 2 `testnet` | `wallet-web/src/lib/networks.ts:37` | `INCONSISTENT` | **M2**: Align public Testnet default to `https://rpc-testnet.kovanica.online/rpc` (`local` as explicit preset). |
| `https://explorer.kovanica.online/tx/${hash}` | `wallet-web/src/components/activity/ActivityList.tsx:197,296` | `INCONSISTENT` | **M2**: Make explorer link chain-aware with `target="_blank" rel="noreferrer"`. |
| `https://indexer.kovanica.online/logs` | `wallet-web/src/components/shell/WalletApp.tsx:406` | `PLACEHOLDER` | **M2**: Move to Advanced/Settings with clear placeholder label. |
| Zero cross-subdomain links in `wallet-web` | `wallet-web/src/components/shell/WalletApp.tsx` | `MISSING_TARGET` | **M2**: Add Ecosystem Switcher (`kovanica.online`, `testnet.kovanica.online`, `playground.kovanica.online`, `docs.kovanica.online`, `/swap`, `/pools`, `/rwa`). |
| `https://testnet-rpc.kovanica.online/rpc`, `wss://testnet-rpc.kovanica.online/ws`, `https://testnet.explorer.kovanica.online` | `browser-extension/src/core/networks.ts:46-51` | `INCONSISTENT` | **M2**: Align to `https://rpc-testnet.kovanica.online/rpc`, `wss://rpc-testnet.kovanica.online/ws`, `https://testnet.kovanica.online/explorer`. |
| `https://rpc.kovanica.online/rpc`, `wss://rpc.kovanica.online/ws` | `wallet-web/src/lib/networks.ts:28`, `browser-extension/src/core/networks.ts:34-39`, `console-desktop/src/networks.ts:28` | `PLACEHOLDER` / `BROKEN` (live `/rpc` 404) | **M2**: Keep Mainnet preset labeled as pre-launch / read-only. **Out-of-Scope (DNS/TLS/L1)**. |
| `https://github.com/BetterCallDzuks/kovanica-l1` | `kovanica-apps/README.md:8-9` | `OK` | Valid. |
| `https://rpc-testnet.kovanica.online/rpc` | `console-desktop/src/networks.ts:22` | `OK` | Valid. |

---

## 6. `kovanica-playground` — Parallel M3 Branch (`feat/simplify-playground-and-links`)

> Tracked on parallel M3 branch `feat/simplify-playground-and-links` per `PROJECT.md`; baseline survey findings below remain outside M1-A `kovanica-web` verification scope.

| Target / Pattern | Source (`File:Line`) | Status | Planned Remediation |
|---|---|---|---|
| `https://github.com/KovanicaDAG/kovanica` | `kovanica-playground/src/App.tsx:1034` | `BROKEN` (`404`) | **M3**: Update to `https://github.com/BetterCallDzuks/kovanica-playground`. |
| `http://127.0.0.1:8545/rpc` only (no public RPC presets) | `kovanica-playground/src/App.tsx:40,527,532` | `INCONSISTENT` | **M3**: Add one-click preset for `https://rpc-testnet.kovanica.online/rpc` alongside local default. |
| `https://relay1.kovanica.org`, `relay2.kovanica.org` | `src/wallet-interop.ts:838`, `WalletContractConsole.tsx:122` | `PLACEHOLDER` / `INCONSISTENT` | **M3**: Update `.org` → `.online` placeholder relays. |
| `https://primary-rpc.example/rpc`, `ipfs://QmExample` | `WalletContractConsole.tsx:2629`, `WaveARwaStudio.tsx:37` | `PLACEHOLDER` | **M3**: Keep explicit example placeholders with clear labels. |
| Zero cross-subdomain nav links | `kovanica-playground/src/App.tsx` | `MISSING_TARGET` | **M3**: Add Ecosystem Switcher linking `kovanica.online`, `testnet.kovanica.online`, `wallet.kovanica.online`, `docs.kovanica.online`, `/api-reference`. |
| `kovanica-sdk v0.7.0` / old SHA in docs | `kovanica-playground/README.md:62,73,147,168,171` | `INCONSISTENT` | **M3**: Sync README to pinned `v0.9.0` (`d1e757d4644583be5e2fca236bf826209f813b1a`). |

---

## 7. Canonical Ecosystem Link Policy & Milestone Ownership

### Canonical Public Endpoints
- **Apex Landing**: `https://kovanica.online`
- **Testnet Portal**: `https://testnet.kovanica.online`
- **Testnet Explorer / Wallet / Map / Faucet**: `https://testnet.kovanica.online/{explorer,wallet,map,faucet}` (hostnames `explorer.*`, `wallet.*`, `map.*`, `faucet.*` redirect `/` cleanly to their routes)
- **Public Testnet JSON-RPC**: `https://rpc-testnet.kovanica.online/rpc`
- **Mainnet Gate**: `https://mainnet.kovanica.online` (`SURFACE_STATUS.mainnet`: `Mainnet (Launching)` until `1.1.2027`)
- **Docs**: `https://docs.kovanica.online`
- **API Reference**: `https://testnet.kovanica.online/api-reference`
- **Built-in Playground**: `https://playground.kovanica.online`
- **Dashboard**: `https://dash.kovanica.online`
- **GitHub Org & Repos**: `https://github.com/BetterCallDzuks` (`kovanica-l1`, `kovanica-sdk`, `kovanica-web`, `kovanica-apps`, `kovanica-playground`)
- **X / Social**: `https://x.com/KovanicaDAG`, `https://x.com/BetterCallDzuks`
- **P2P Seed**: `seed1.kovanica.online:8000`

### Milestone Ownership Summary
| Owner | Scope |
|---|---|
| **M1-A** (`kovanica-web`, completed here) | Branch `feat/reorganize-simplify-web-ux`, `docs/domain-and-link-map.md`, `surfaces.ts`, `host.ts` (roles + `:port` stripping), `__root.tsx` redirects, `network.ts`, `networkConstants.ts`, `api/spec.ts`, `rpc-spec.ts`, `download/$.ts`, `KovanicaDAG` → `BetterCallDzuks` fixes, `api.kovanica.online` → `/api-reference` & `rpc-testnet.kovanica.online/rpc`, `mainnet-launching.tsx` & `source-switch.tsx` launching labels, `contract-inspector-panel.tsx` & `dry-run.ts` RPC URLs, `.org` → `.online` (`engine.ts`, `trezor-provider.ts`), `dashboard.tsx` & `playground-onboarding.tsx` `/wallet` CTAs, `miner-command-builder.tsx` Stratum placeholder note, 17-file Tailwind v4 shade/`bg-surface` fixes, `POST /api/rwa/derive`, `GET /api/supply`, `POST /api/submit_tx`, `snippets.tsx` & `api-console.tsx` alignment, M1-A unit tests. |
| **M1-B** (`kovanica-web`, completed) | Unified `<Shell>` across `/wallet/*` (removed `!isExact` bypass), `/swap`, `/pools`, `/rwa`, `/multi-asset`, `/stealth`, `/nft`, `/faucet`, `/api-reference`; 4-bucket IA navigation (`Explore`, `Trade & RWA`, `Wallet & Tools`, `Contracts & Docs`) + Ecosystem Switcher (`surfaces.ts`); persistent Wallet & DeFi sub-nav strip; `/pool` (Stratum Mining Pool) vs `/pools` (AMM Liquidity Pools) disambiguation; `rwa-issue.tsx` SPA `<Link to="/wallet">`; replaced `pool.kovanica.online` placeholder with RFC 2606 `stratum.example.com:3333` and `/api/supply` playground snippet/preset with `/api/base_fee`. |
| **M1-C** (`kovanica-web`, completed) | Page layout simplification (`HomeLanding` strip downloads + tightened grids, `HomeTestnet` categorized 1-click surface groups, `ExplorerView` collapsible telemetry & drawers strip above `DagCanvas`, `PlaygroundChrome` Ecosystem Switcher); `/rwa` links into `/explorer/rwa/$assetId`; zero orphaned routes; automated `tests/m1bc-shell-and-routes.test.ts` verifying `<Shell>` wrapping, zero banned links, zero orphaned routes, and preserved design tokens. |
| **M2** (`kovanica-apps`, merged in PR #24) | `wallet-web` & `browser-extension` RPC presets, chain-aware explorer links, Ecosystem Switcher, IA simplification. |
| **M3** (`kovanica-playground`, merged in PR #24) | `App.tsx` GitHub org fix, public RPC preset, `.org` → `.online` relays, `WalletContractConsole.tsx` sub-tabs, `WaveARwaStudio.tsx` dark tokens, `README.md` SDK version sync. |
| **Follow-up PRs (#33–#35, merged & deployed)** | PR #33: Standardized 5 pure function tabs (`Explore · Trade · Assets · Wallet · Build`) shared by `Shell` and `HomeTestnet`. PR #34: `/pool` renders Stratum Mining Pool (`MinerCommandBuilder`) and `/pools` hosts AMM Liquidity Pools + on-chain KVP-102 `PoolView`. PR #35: `/pricing` Services & Pricing hub, `POST /api/inquiries` intake, configurable Swap/Pool fees, and zero-cookie `<SponsorSlot>`. |
| **Out-of-Scope (DNS/TLS/L1/Vendor)** | Edge TLS SAN for `mainnet.kovanica.online`, DNS provisioning (`api.`, `apps.`, `pool.`, `seed2.`, `relay*.`, `indexer.`), nginx static `/download/install.sh`, `kovanica-l1/node/scripts/install.sh:50` (`KovanicaDAG`), `kovanica-l1` `v*-node` release tags, `vendor/kovanica-sdk-wasm/package.json`. |
