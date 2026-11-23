# kovanica-web

Source of the public site **kovanica.online** (TanStack Start + Vite + Nitro 3).

Public copy matches the live testnet: kovanica-testnet chain ID 2, Hybrid PoW + GHOSTDAG, no stake, node tag `v0.3.0-node` (commit `e3fce499`), mainnet launch 1.1.2027. The testnet faucet is the existing `/faucet` route (fixed dispense; an unset `KOVANICA_FAUCET_URL` reports unavailable). Downloads under `/download` redirect to that tag on KovanicaDAG/kovanica-l1.

Brand tokens in `src/styles.css` stay ink (`--color-bg`), paper (`--color-fg`), and copper (`--color-gold`). Public copy does not describe another chain.

Agent rules and the full-scope plan: [docs/AGENT-RULES.md](https://github.com/KovanicaDAG/kovanica-l1/blob/main/docs/AGENT-RULES.md) and [docs/PLAN-FULL-SCOPE.md](https://github.com/KovanicaDAG/kovanica-l1/blob/main/docs/PLAN-FULL-SCOPE.md) in KovanicaDAG/kovanica-l1.

## Develop

```sh
npm ci
npm run dev
```

## Build

```sh
npm run build:vps   # Nitro node-server preset, output in .output/
```

`@kovanica/sdk-wasm` is vendored as a prebuilt wasm-pack package in
`vendor/kovanica-sdk-wasm` (built from the Kovanica SDK `kovanica-wasm` bindings).

Runtime configuration comes from environment variables (`KOVANICA_*`, `GROK_AUTH_*`,
`GROK_PREVIEW_CLIENT_SECRET`); never commit hosts, IPs, ports, keys or secrets.

## Recent Explorer & Ecosystem Surface Additions

- **Inline TxCard Bincode Decoder**: Decodes raw Bincode transaction payloads directly inside explorer transaction cards.
- **KovanicaHash Miner Command Builder**: Generates copy-ready `kovanica-miner` CLI commands for solo and Stratum mining.
- **Contract Event Log Timeline**: Renders decoded contract event logs in a chronological timeline view.
- **Diagnostics RPC Latency Sparkline**: Tracks rolling RPC round-trip latency in the diagnostics drawer.
- **Offline Universal Transfer+Call Raw Tx Decoder**: Decodes signed/unsigned Transfer and ContractCall raw transactions completely offline.
- **LiveDagDrawer Fee Pressure Pill**: Displays real-time mempool fee pressure tiers inside the Live DAG drawer.
- **PRO-21 Address Checksum Inspector**: Validates and inspects PRO-21 Bech32m address prefixes, payloads, and checksums.
- **Faucet Pre-Flight Guard**: Checks address validity, network alignment, and cooldown state before submitting testnet faucet requests.
- **Network Canonical Readiness Strip**: Surfaces canonical Mainnet (`1-f35df34c92001436`) and Testnet (`2-24cdb5fadd98b207`) identities alongside live ecosystem service readiness on `/network`.
- **Pool Stratum TLS Spec Strip**: Displays frozen KovanicaHash / GHOSTDAG K=5 emission parameters, canonical network tags, and TLS-required Stratum v1 details on `/pool`.
- **API Reference Identity Headers & `kovanica_mempoolStats`**: Documents canonical network identity headers and the `kovanica_mempoolStats` RPC method on `/api-reference`.
