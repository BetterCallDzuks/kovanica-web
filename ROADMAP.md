# Kovanica Web & Protocol Roadmap

This document outlines the architecture, milestone status, and deployment progress for `kovanica-web` and its integration with the Kovanica Layer-1 ecosystem.

---

## 1. Milestone Matrix

### Core Protocol Architecture & Wasmi Smart Contracts
| ID | Milestone | Status | Description |
|---|---|:---:|---|
| `hybrid-consensus` | Hybrid PoW + GHOSTDAG Consensus | **Shipped** | Hybrid Proof-of-Work block admission with GHOSTDAG graph ordering (4s target block interval, GHOSTDAG $k=5$, KovanicaHash PoW). |
| `account-ledger` | Account-Based Ledger & PRO-21 Addresses | **Shipped** | Account-based state model with sequence nonces and canonical PRO-21 addresses (`kvnc...dag`, 64 chars). |
| `wasmi-runtime` | Wasmi Deterministic Execution Runtime | **Shipped** | Sandboxed WebAssembly runtime for deterministic smart contract execution, gas metering, and host storage interop. |
| `contract-multisig` | Multisig Contract (`kovanica-multisig`) | **Shipped** | M-of-N threshold multi-signature Wasmi smart contract supporting partial signature aggregation and activation gating. |
| `contract-htlc` | HTLC Atomic Swaps (`kovanica-htlc`) | **Shipped** | Hashed time-locked Wasmi smart contract for trustless cross-chain atomic swaps and conditional escrow release. |
| `contract-vault` | Time-Lock Vaults & Vesting (`kovanica-vault`) | **Shipped** | Deterministic time-lock vault contract supporting linear treasury vesting schedules and revocable time locks. |
| `contract-token` | Fungible Token Standard (`kovanica-token`) | **Shipped** | CW20-style deterministic WASM token contract with minting, transfers, allowances, and burn capabilities. |
| `contract-name-service` | Decentralized Name Registry (`kovanica-name`) | **Shipped** | CW-style domain name registration, record management, and reverse resolution contract with sub-second lookups. |
| `peer-reputation` | P2P Peer Reputation & InboundGate Ban Scoring | **Shipped** | Sub-second penalty matrix and socket-level IP banning for malformed frames (+50), invalid PoW/target (+100 instant ban), and flood spam (+20). |
| `soak-simulation` | Mempool & Out-of-Gas Soak Simulation (SIM-1) | **Shipped** | Multi-threaded 20-account concurrent stress test achieving 7,113.13 TPS, bounded RSS memory (13.59 MiB), and zero node panics with deterministic gas rollback. |

### Client Applications & Explorer Surfaces
| ID | Milestone | Status | Description |
|---|---|:---:|---|
| `web-explorer` | BlockDAG Explorer | **Shipped** | Interactive DAG canvas ordered by GHOSTDAG $K=5$, zoom and pan controls, and truthful live network telemetry. |
| `web-wallet` | Web Wallet & Signer | **Shipped** | Client-side wallet supporting BIP-39 mnemonic derivation, PRO-21 address generation, and in-browser transaction signing. |
| `web-faucet` | Testnet Faucet | **Shipped** | Automated testnet faucet dispensing 10 KVNC with rate limiting and canonical PRO-21 address verification. |
| `global-search` | Universal Explorer Global Search (PR #24) | **Shipped** | Deep-linking resolver supporting canonical PRO-21 addresses (`kvnc...dag`), Ed25519 public keys, block/tx digests, token symbols, NFT IDs, and RWA certificates. |
| `apps-ecosystem` | Desktop & Mobile Applications (`kovanica-apps`) | **Shipped** | Native cross-platform shell suite: Android node & wallet with Rust FFI, Desktop node controller (`node-desktop`, `console-desktop`), and unified smart contract call dispatcher. |
| `cli-tooling` | Node CLI & Tooling (`kovanica-cli`) | **Shipped** | Full command-line toolkit for node administration, key generation, RPC inspection, and genesis orchestration. |

### SDK & Developer Tooling
| ID | Milestone | Status | Description |
|---|---|:---:|---|
| `rust-crates` | Rust Workspace Crates | **Shipped** | 27 modular crates: `kovanica-types`, `kovanica-crypto`, `kovanica-dag`, `kovanica-consensus`, `kovanica-mempool`, `kovanica-network`, `kovanica-runtime`, `kovanica-node`, `kovanica-rpc`. |
| `ts-packages` | TypeScript SDK Packages | **Shipped** | Modular client libraries: `@kovanica/api-client`, `@kovanica/signer`, `@kovanica/console`, and `@kovanica/web`. |
| `sdk-v030` | TypeScript SDK v0.3.0 Release | **Shipped** | End-to-end typed smart contract encoders and decoders for Name Registry, NFT, and Escrow, BIP-39 HD wallet derivation, and strict 0x prefix enforcement. |
| `playground-v030` | Interactive Contract Playground (`kovanica-playground`) | **Shipped** | Browser-based contract testing environment pinned to SDK v0.3.0 with live Wasmi execution and hybrid PoW consensus visualization. |
| `sdk-wasm` | WASM In-Browser Engine | **Shipped** | Wasm-bindgen client engine for in-browser transaction preparation, BLAKE3 sighash derivation, and zero-knowledge seed protection. |
| `json-rpc` | JSON-RPC 2.0 Interface | **Shipped** | Node-parity RPC endpoints for syncStatus, getLeaderHeader, getBalance, getNonce, sendRawTransaction, and DAG inspection. |

### Mainnet Readiness & Launch Focus Areas
| ID | Milestone | Status | Description |
|---|---|:---:|---|
| `hybrid-testnet-m8` | Canonical `kovanica-testnet` (Chain ID 2) Live Operation | **Shipped** | Live operation of canonical hybrid PoW + GHOSTDAG testnet (network tag `2-24cdb5fadd98b207`). Active 3-node cluster + observer + faucet on `seed1.kovanica.online` with non-compounding DAA. |
| `audit-dossier` | External Security Audit Dossier & Inspection Harness | **In Progress** | Immutable audit archive packaging (`scripts/package-audit-dossier.sh`) and automated reproduction harness (`auditor-reproduce.sh`) prepared for accredited external security firms (reviewing KovanicaHash, Wasmi sandbox, P2P peer scorer). |
| `solo-miner` | Solo Miner Tooling & Stratum Gateway | **In Progress** | Public CPU/GPU solo mining scripts, Stratum mining gateway dispatcher, and local hash-rate telemetry for decentralized mining participation. |
| `ceremony-mainnet` | Mainnet Genesis Ceremony & Premine Lock Verification | **Up Next** | Execution of the final genesis ceremony with the 5 zero-stake bootstrap seed operators, founder premine verification (200,000 KVNC), and frozen genesis bundle sign-off (`1-f35df34c92001436`). |
| `mainnet-readiness` | Mainnet Launch Event (1.1.2027) | **Up Next** | Public launch on `kovanica-mainnet` (chain ID 1) with 90,200,000 KVNC hard cap, 82M mining subsidy budget (8,200,000-block × 3/4 decay eras), and zero stake in consensus. |

---

## 2. Core Protocol Parameters (Canonical Truth)

- **Consensus:** Strictly 100% Hybrid Proof-of-Work + GHOSTDAG (zero stake in consensus path).
- **Target Block Interval:** 4,000 ms (4.0 s).
- **GHOSTDAG $K$:** 5.
- **PoW Algorithm:** KovanicaHash (BLAKE3 + 2 MiB memory scratchpad).
- **Native Coin:** KVNC (9 decimals, $10^9$ base units per KVNC).
- **Hard Cap:** 90,200,000 KVNC.
- **Mining Subsidy Budget:** 82,000,000 KVNC ($8,200,000\text{-block} \times 3/4\text{ decay eras}$).
- **Active Testnet Network Tag:** `2-24cdb5fadd98b207` (Chain ID 2).
- **Frozen Mainnet Network Tag:** `1-f35df34c92001436` (Chain ID 1).
